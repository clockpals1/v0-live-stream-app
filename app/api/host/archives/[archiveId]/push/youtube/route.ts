import { NextRequest, NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getValidAccessToken, initResumableUpload } from "@/lib/integrations/youtube";
import { presignDownload } from "@/lib/storage/r2";
import { isEntitled } from "@/lib/billing/entitlements";
import { checkRateLimit, rateLimitHeaders, POLICY_HEAVY_WRITE } from "@/lib/security/rate-limit";

/**
 * POST /api/host/archives/[archiveId]/push/youtube
 *
 * Mints two URLs the browser needs to push an R2 archive to YouTube:
 *   1. r2Url       — presigned GET URL to download the recording from R2
 *   2. uploadUrl   — YouTube resumable upload session URL
 *
 * The browser fetches from r2Url (streaming download) then PUTs the
 * bytes to uploadUrl. Neither token ever leaves the server in clear
 * text — the presigned R2 URL is HMAC-signed, the YouTube session URL
 * is a single-use Google-signed token.
 *
 * Gates:
 *   - User must own the archive (or be platform admin).
 *   - Plan must include distribution_youtube.
 *   - YouTube must be connected (token present).
 *   - Archive must be status='ready' with an object_key.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ archiveId: string }> },
) {
  const { archiveId } = await params;
  if (!archiveId) {
    return NextResponse.json({ error: "Missing archiveId." }, { status: 400 });
  }

  let body: {
    title?: string;
    description?: string;
    privacyStatus?: "private" | "unlisted" | "public";
    tags?: string[];
  } = {};
  try {
    body = await req.json();
  } catch {
    // body is optional
  }

  // ─── auth ──────────────────────────────────────────────────────────
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const rl = checkRateLimit(`user:${user.id}`, POLICY_HEAVY_WRITE);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Too many requests. Please slow down.", code: "rate_limited" },
      { status: 429, headers: rateLimitHeaders(rl) },
    );
  }

  const admin = createAdminClient();

  // ─── host lookup ───────────────────────────────────────────────────
  const { data: host } = await admin
    .from("hosts")
    .select("id, role, is_admin")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!host) return NextResponse.json({ error: "No host profile." }, { status: 404 });

  // ─── plan gate ─────────────────────────────────────────────────────
  if (!(await isEntitled(supabase, user.id, "distribution_youtube"))) {
    return NextResponse.json(
      { error: "YouTube distribution is not included in your plan.", code: "feature_not_in_plan", feature: "distribution_youtube" },
      { status: 402 },
    );
  }

  // ─── archive lookup + ownership ────────────────────────────────────
  const { data: archive } = await admin
    .from("stream_archives")
    .select("id, host_id, stream_id, object_key, public_url, status, content_type, byte_size, streams(title)")
    .eq("id", archiveId)
    .is("deleted_at", null)
    .maybeSingle();

  if (!archive) return NextResponse.json({ error: "Archive not found." }, { status: 404 });

  const isAdmin = host.role === "admin" || host.is_admin === true;
  if (!isAdmin && archive.host_id !== host.id) {
    return NextResponse.json({ error: "You do not own this archive." }, { status: 403 });
  }
  if (archive.status !== "ready") {
    return NextResponse.json(
      { error: `Archive is not ready (status: ${archive.status}). Wait for the upload to complete.` },
      { status: 409 },
    );
  }
  if (!archive.object_key) {
    return NextResponse.json({ error: "Archive has no stored object key — cannot push." }, { status: 409 });
  }
  const byteSize = Number(archive.byte_size ?? 0);
  if (!byteSize) {
    return NextResponse.json({ error: "Archive byte size is unknown — cannot push." }, { status: 409 });
  }

  // ─── mint R2 presigned GET URL ─────────────────────────────────────
  // 4-hour window — enough for a slow connection to download a large file.
  let r2Url: string;
  try {
    r2Url = archive.public_url
      ? archive.public_url
      : await presignDownload({ objectKey: archive.object_key, expiresInSeconds: 14400 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "R2 not configured.";
    return NextResponse.json({ error: `Could not access recording: ${msg}` }, { status: 502 });
  }

  // ─── get valid YouTube access token ────────────────────────────────
  const hostIdForToken = isAdmin ? archive.host_id : host.id;
  let tokenBundle;
  try {
    tokenBundle = await getValidAccessToken(admin, hostIdForToken);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Token refresh failed.";
    return NextResponse.json({ error: msg, code: "reconnect_required" }, { status: 401 });
  }
  if (!tokenBundle) {
    return NextResponse.json(
      { error: "YouTube is not connected. Connect your channel in Settings → Integrations first.", code: "not_connected" },
      { status: 412 },
    );
  }

  // ─── init YouTube resumable upload session ─────────────────────────
  const streamTitle = (archive as { streams?: { title?: string } | null }).streams?.title ?? "Stream recording";
  let session;
  try {
    session = await initResumableUpload({
      accessToken: tokenBundle.accessToken,
      title: (body.title ?? streamTitle).slice(0, 100),
      description: body.description,
      privacyStatus: body.privacyStatus ?? "private",
      tags: body.tags,
      contentType: archive.content_type ?? "video/webm",
      contentLength: byteSize,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "YouTube session init failed.";
    return NextResponse.json({ error: msg }, { status: 502 });
  }

  await admin
    .from("host_integrations")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", tokenBundle.integration.id);

  return NextResponse.json({
    r2Url,
    uploadUrl: session.uploadUrl,
    contentType: session.contentType,
    contentLength: session.contentLength,
    title: (body.title ?? streamTitle).slice(0, 100),
  });
}
