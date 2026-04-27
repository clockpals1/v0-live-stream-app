import { NextRequest, NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { presignUpload, getR2Config } from "@/lib/storage/r2";
import { isEntitled, getEffectivePlan } from "@/lib/billing/entitlements";

/**
 * POST /api/streams/[streamId]/archive/start
 * Body: { contentType?: string }
 *
 * Mints a presigned PUT URL for the browser to upload the recording
 * directly to R2. Creates a stream_archives row in 'pending' status
 * for the matching upload.
 *
 * The host's plan must have cloud_archive enabled. The stream must
 * belong to the calling host (admins skip the ownership check).
 *
 * Returns:
 *   {
 *     archiveId, uploadUrl, headers, expiresIn,
 *     publicUrl: string | null,
 *     objectKey, bucket
 *   }
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ roomCode: string }> },
) {
  // Folder is named [roomCode] for routing-tree consistency with the
  // sibling /api/streams/[roomCode]/route.ts; the value is actually a
  // stream UUID at this nested path. We rename it for clarity locally.
  const { roomCode: streamId } = await params;
  if (!streamId) {
    return NextResponse.json({ error: "Missing streamId." }, { status: 400 });
  }

  let body: { contentType?: string };
  try {
    body = (await req.json()) as { contentType?: string };
  } catch {
    body = {};
  }
  const contentType = (body.contentType || "video/webm").trim();

  // ─── auth ────────────────────────────────────────────────────────
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const admin = createAdminClient();
  const { data: host, error: hostErr } = await admin
    .from("hosts")
    .select("id, role, is_admin")
    .eq("user_id", user.id)
    .maybeSingle();
  if (hostErr || !host) {
    return NextResponse.json(
      { error: "No host profile found." },
      { status: 404 },
    );
  }

  // ─── plan gate ───────────────────────────────────────────────────
  if (!(await isEntitled(supabase, user.id, "cloud_archive"))) {
    return NextResponse.json(
      {
        error:
          "Cloud archive is not included in your current plan. Upgrade to enable it.",
        code: "feature_not_in_plan",
        feature: "cloud_archive",
      },
      { status: 402 },
    );
  }

  // ─── stream lookup + ownership ───────────────────────────────────
  const { data: stream, error: streamErr } = await admin
    .from("streams")
    .select("id, host_id, title, room_code")
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

  // ─── verify R2 configuration ─────────────────────────────────────
  let cfg;
  try {
    cfg = getR2Config();
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Storage not configured.";
    console.error("[archive/start] R2 not configured:", msg);
    return NextResponse.json({ error: msg }, { status: 503 });
  }

  // ─── per-archive retention ────────────────────────────────────────
  // The host's effective plan tells us how many days this recording
  // is allowed to live in R2 before the cron deletes it. Snapshot the
  // value AT UPLOAD TIME — a later plan downgrade must not retroactively
  // shrink the retention window of already-paid-for archives.
  let deleteAfterAt: string | null = null;
  try {
    const eff = await getEffectivePlan(admin, user.id);
    const retentionDays = eff.plan?.features?.retention_days;
    // Admin/null/0 → keep forever. Anything > 0 → set the column.
    if (typeof retentionDays === "number" && retentionDays > 0) {
      const ms = retentionDays * 24 * 60 * 60 * 1000;
      deleteAfterAt = new Date(Date.now() + ms).toISOString();
    }
  } catch (e) {
    // If plan lookup fails we default to NULL (keep forever) rather
    // than a short window — never accidentally schedule a delete.
    console.warn("[archive/start] retention lookup failed:", e);
  }

  // ─── create archive row first so its id keys the object path ─────
  const { data: archive, error: insertErr } = await admin
    .from("stream_archives")
    .insert({
      stream_id: stream.id,
      host_id: stream.host_id,
      provider: "r2",
      bucket: cfg.bucket,
      // Will be replaced after we compute the key below — but Supabase
      // requires it on insert. Set a placeholder now, update right after.
      object_key: `pending/${crypto.randomUUID()}`,
      content_type: contentType,
      status: "pending",
      title: stream.title ?? null,
      delete_after_at: deleteAfterAt,
    })
    .select("id")
    .single();

  if (insertErr || !archive) {
    const msg = insertErr?.message ?? "Failed to create archive row.";
    console.error("[archive/start] insert failed:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  // ─── compute the final object key + presign ──────────────────────
  const ext = contentType.includes("mp4")
    ? "mp4"
    : contentType.includes("webm")
      ? "webm"
      : "bin";
  const objectKey = `hosts/${stream.host_id}/streams/${stream.id}/${archive.id}.${ext}`;

  // Update the row with the real key.
  const { error: keyErr } = await admin
    .from("stream_archives")
    .update({ object_key: objectKey, status: "uploading" })
    .eq("id", archive.id);
  if (keyErr) {
    console.error("[archive/start] key update failed:", keyErr.message);
    // Continue — the row exists, key still mints fine.
  }

  let presigned;
  try {
    presigned = await presignUpload({ objectKey, contentType });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to sign upload URL.";
    console.error("[archive/start] presign failed:", msg);
    // Mark the archive row failed so it doesn't sit in 'uploading' forever.
    await admin
      .from("stream_archives")
      .update({ status: "failed", failure_reason: msg })
      .eq("id", archive.id);
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  // Persist the public_url eagerly if the bucket is public, so finalize
  // doesn't need to recompute and downstream code can rely on it.
  if (presigned.publicUrl) {
    await admin
      .from("stream_archives")
      .update({ public_url: presigned.publicUrl })
      .eq("id", archive.id);
  }

  return NextResponse.json({
    archiveId: archive.id,
    uploadUrl: presigned.uploadUrl,
    headers: presigned.headers,
    expiresIn: presigned.expiresIn,
    publicUrl: presigned.publicUrl,
    bucket: presigned.bucket,
    objectKey: presigned.objectKey,
  });
}
