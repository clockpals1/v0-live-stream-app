import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sanitizeEmailHtml, renderEmailShell } from "@/lib/insider/sanitize";
import {
  isEmailConfigured,
  sendBatch,
  unsubscribeUrl,
} from "@/lib/insider/email";

/**
 * POST /api/insider/broadcast
 *
 * Authenticated host endpoint. Composes a sanitized HTML email and fans
 * it out to the host's active subscribers via Resend.
 *
 * Body: { subject: string, html_body: string }
 *
 * Flow:
 *   1. Auth: resolve current user → host record. Reject anon.
 *   2. Validate subject + body length, sanitize HTML defensively (server
 *      always re-sanitizes — never trust the client).
 *   3. Pull active subscribers for this host via service role (we need
 *      unsubscribe_token, which is a sensitive column we don't expose
 *      to the client).
 *   4. Insert a host_broadcasts row in 'sending' state, fan out via
 *      Resend, then update sent/failed counts and final status.
 *
 * Returns: { broadcast_id, recipient_count, sent_count, failed_count, status }
 */
export async function POST(request: Request) {
  // ─── 1. Auth ────────────────────────────────────────────────────────
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: host } = await supabase
    .from("hosts")
    .select("id, display_name, email")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!host) {
    return NextResponse.json({ error: "Not a registered host" }, { status: 403 });
  }

  // ─── 2. Validate input ─────────────────────────────────────────────
  let body: { subject?: string; html_body?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const subject = (body.subject || "").trim();
  const rawHtml = (body.html_body || "").trim();

  if (subject.length < 2 || subject.length > 200) {
    return NextResponse.json(
      { error: "Subject must be between 2 and 200 characters." },
      { status: 400 },
    );
  }
  if (rawHtml.length < 10) {
    return NextResponse.json(
      { error: "Message body is too short." },
      { status: 400 },
    );
  }
  if (rawHtml.length > 200_000) {
    return NextResponse.json(
      { error: "Message body is too large (max ~200KB)." },
      { status: 400 },
    );
  }

  const cleanHtml = sanitizeEmailHtml(rawHtml);

  // ─── 3. Email service must be configured before we proceed ─────────
  if (!isEmailConfigured()) {
    return NextResponse.json(
      {
        error:
          "Email sending is not configured. Ask the site owner to set " +
          "either SMTP_* env vars (SMTP_HOST, SMTP_PORT, SMTP_USER, " +
          "SMTP_PASS, SMTP_FROM) or Resend env vars (RESEND_API_KEY, " +
          "RESEND_FROM) in the deployment environment.",
        configured: false,
      },
      { status: 503 },
    );
  }

  // ─── 4. Load active subscribers via service role ───────────────────
  let admin;
  try {
    admin = createAdminClient();
  } catch (err) {
    console.error("[insider/broadcast] admin client unavailable:", err);
    return NextResponse.json(
      { error: "Server is misconfigured." },
      { status: 500 },
    );
  }

  const { data: subs, error: subsErr } = await admin
    .from("host_subscribers")
    .select("email, unsubscribe_token")
    .eq("host_id", host.id)
    .eq("is_active", true);

  if (subsErr) {
    console.error("[insider/broadcast] subscriber load failed:", subsErr);
    return NextResponse.json({ error: "Could not load subscribers." }, { status: 500 });
  }

  const recipients = subs ?? [];
  if (recipients.length === 0) {
    return NextResponse.json(
      { error: "You have no active subscribers to send to yet." },
      { status: 400 },
    );
  }

  // ─── 5. Record the broadcast ───────────────────────────────────────
  const { data: broadcast, error: brErr } = await admin
    .from("host_broadcasts")
    .insert({
      host_id: host.id,
      subject,
      html_body: cleanHtml,
      recipient_count: recipients.length,
      status: "sending",
    })
    .select()
    .single();

  if (brErr || !broadcast) {
    console.error("[insider/broadcast] insert failed:", brErr);
    return NextResponse.json({ error: "Could not record the broadcast." }, { status: 500 });
  }

  // ─── 6. Build per-recipient payloads + send ────────────────────────
  const hostName = host.display_name || host.email || "Host";
  const items = recipients.map((r) => ({
    to: r.email,
    subject,
    html: renderEmailShell({
      hostName,
      bodyHtml: cleanHtml,
      unsubscribeUrl: unsubscribeUrl(r.unsubscribe_token),
      recipientEmail: r.email,
    }),
  }));

  const result = await sendBatch(items);

  let finalStatus: "sent" | "partial" | "failed";
  if (result.failed === 0) finalStatus = "sent";
  else if (result.sent === 0) finalStatus = "failed";
  else finalStatus = "partial";

  await admin
    .from("host_broadcasts")
    .update({
      sent_count: result.sent,
      failed_count: result.failed,
      status: finalStatus,
      sent_at: new Date().toISOString(),
    })
    .eq("id", broadcast.id);

  return NextResponse.json({
    broadcast_id: broadcast.id,
    recipient_count: recipients.length,
    sent_count: result.sent,
    failed_count: result.failed,
    status: finalStatus,
    // Surface the first few errors so the host can see what went wrong
    sample_errors: result.errors.slice(0, 5),
  });
}
