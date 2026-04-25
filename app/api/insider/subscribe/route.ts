import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isValidEmail } from "@/lib/insider/sanitize";

/**
 * POST /api/insider/subscribe
 *
 * Public endpoint hit by anonymous viewers from a live-stream page.
 * Body: { host_id: string, email: string, source_room_code?: string }
 *
 * Idempotent: if the (host_id, email) row already exists we re-activate
 * it instead of erroring, so a viewer who previously unsubscribed and
 * returned doesn't see "duplicate" friction.
 *
 * Uses the service-role admin client because there is no anon RLS policy
 * for INSERT — this is the only safe write path. We validate inputs
 * strictly before reaching the DB.
 */
export async function POST(request: Request) {
  let body: { host_id?: string; email?: string; source_room_code?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const hostId = (body.host_id || "").trim();
  const email = (body.email || "").trim().toLowerCase();
  const roomCode = (body.source_room_code || "").trim() || null;

  if (!hostId || !/^[0-9a-f-]{36}$/i.test(hostId)) {
    return NextResponse.json({ error: "Invalid host id" }, { status: 400 });
  }
  if (!isValidEmail(email)) {
    return NextResponse.json(
      { error: "Please enter a valid email address." },
      { status: 400 },
    );
  }

  let admin;
  try {
    admin = createAdminClient();
  } catch (err) {
    console.error("[insider/subscribe] admin client unavailable:", err);
    return NextResponse.json(
      { error: "Server is misconfigured. Please try again later." },
      { status: 500 },
    );
  }

  // Verify the host exists. Without this check, a malicious caller could
  // spam fabricated UUIDs into the table.
  const { data: host, error: hostErr } = await admin
    .from("hosts")
    .select("id, display_name, email")
    .eq("id", hostId)
    .maybeSingle();

  if (hostErr) {
    console.error("[insider/subscribe] host lookup failed:", hostErr);
    return NextResponse.json({ error: "Could not subscribe right now." }, { status: 500 });
  }
  if (!host) {
    return NextResponse.json({ error: "Host not found." }, { status: 404 });
  }

  // Upsert: re-activate if a row already exists for this (host, email).
  const { data: existing } = await admin
    .from("host_subscribers")
    .select("id, is_active")
    .eq("host_id", hostId)
    .eq("email", email)
    .maybeSingle();

  if (existing) {
    if (existing.is_active) {
      return NextResponse.json({
        ok: true,
        alreadySubscribed: true,
        message: "You're already on the list — thanks for being here.",
      });
    }
    const { error: reErr } = await admin
      .from("host_subscribers")
      .update({ is_active: true, unsubscribed_at: null })
      .eq("id", existing.id);
    if (reErr) {
      console.error("[insider/subscribe] reactivate failed:", reErr);
      return NextResponse.json({ error: "Could not subscribe right now." }, { status: 500 });
    }
    return NextResponse.json({
      ok: true,
      reactivated: true,
      message: "Welcome back — you're on the list again.",
    });
  }

  const { error: insertErr } = await admin.from("host_subscribers").insert({
    host_id: hostId,
    email,
    source_room_code: roomCode,
  });

  if (insertErr) {
    console.error("[insider/subscribe] insert failed:", insertErr);
    return NextResponse.json({ error: "Could not subscribe right now." }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    message: "You're in. We'll let you know about future live sessions.",
  });
}
