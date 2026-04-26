import { NextRequest, NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  getValidAccessToken,
  initResumableUpload,
} from "@/lib/integrations/youtube";
import { isEntitled } from "@/lib/billing/entitlements";

/**
 * POST /api/streams/[streamId]/youtube/upload
 * Body: {
 *   contentType: string,
 *   contentLength: number,
 *   title?: string,
 *   description?: string,
 *   privacyStatus?: 'private' | 'unlisted' | 'public',
 *   tags?: string[]
 * }
 *
 * Initiates a YouTube resumable upload session for the host's connected
 * channel and returns the session URL the BROWSER will PUT the bytes
 * to. Mirrors the R2 archive flow for symmetry — the browser does the
 * heavy lifting; the Worker only mints the URL.
 *
 * The session URL itself is the auth — it's a one-shot, signed token
 * Google issues. We never expose the access_token to the client.
 *
 * Plan + ownership gates apply: youtube_upload must be enabled on the
 * host's plan, and the stream must belong to the calling host (admins
 * skip the ownership check).
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ streamId: string }> },
) {
  const { streamId } = await params;
  if (!streamId) {
    return NextResponse.json({ error: "Missing streamId." }, { status: 400 });
  }

  let body: {
    contentType?: string;
    contentLength?: number;
    title?: string;
    description?: string;
    privacyStatus?: "private" | "unlisted" | "public";
    tags?: string[];
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const contentType = (body.contentType ?? "video/webm").trim();
  const contentLength = Number(body.contentLength);
  if (!Number.isFinite(contentLength) || contentLength <= 0) {
    return NextResponse.json(
      { error: "contentLength is required and must be > 0." },
      { status: 400 },
    );
  }

  // ─── auth ────────────────────────────────────────────────────────
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const admin = createAdminClient();
  const { data: host } = await admin
    .from("hosts")
    .select("id, role, is_admin")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!host) {
    return NextResponse.json(
      { error: "No host profile found." },
      { status: 404 },
    );
  }

  // ─── plan gate ───────────────────────────────────────────────────
  if (!(await isEntitled(supabase, user.id, "youtube_upload"))) {
    return NextResponse.json(
      {
        error:
          "YouTube upload is not included in your current plan. Upgrade to enable it.",
        code: "feature_not_in_plan",
        feature: "youtube_upload",
      },
      { status: 402 },
    );
  }

  // ─── stream lookup + ownership ───────────────────────────────────
  const { data: stream, error: streamErr } = await admin
    .from("streams")
    .select("id, host_id, title")
    .eq("id", streamId)
    .maybeSingle();
  if (streamErr || !stream) {
    return NextResponse.json({ error: "Stream not found." }, { status: 404 });
  }
  const isAdmin = host.role === "admin" || host.is_admin === true;
  if (!isAdmin && stream.host_id !== host.id) {
    return NextResponse.json(
      { error: "You do not own this stream." },
      { status: 403 },
    );
  }

  // ─── valid access token (refresh if needed) ──────────────────────
  let tokenBundle;
  try {
    tokenBundle = await getValidAccessToken(admin, stream.host_id);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Token refresh failed.";
    console.error("[youtube/upload] token resolve failed:", msg);
    return NextResponse.json({ error: msg, code: "reconnect_required" }, { status: 401 });
  }
  if (!tokenBundle) {
    return NextResponse.json(
      {
        error: "YouTube is not connected. Connect your channel first.",
        code: "not_connected",
      },
      { status: 412 },
    );
  }

  // ─── init resumable session ──────────────────────────────────────
  let session;
  try {
    session = await initResumableUpload({
      accessToken: tokenBundle.accessToken,
      title: (body.title ?? stream.title ?? "Stream recording").slice(0, 100),
      description: body.description,
      privacyStatus: body.privacyStatus ?? "private",
      tags: body.tags,
      contentType,
      contentLength,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Upload session init failed.";
    console.error("[youtube/upload] init failed:", msg);
    return NextResponse.json({ error: msg }, { status: 502 });
  }

  // Touch last_used_at so the integrations card can render "last used X
  // minutes ago" in the future.
  await admin
    .from("host_integrations")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", tokenBundle.integration.id);

  return NextResponse.json({
    uploadUrl: session.uploadUrl,
    contentType: session.contentType,
    contentLength: session.contentLength,
  });
}
