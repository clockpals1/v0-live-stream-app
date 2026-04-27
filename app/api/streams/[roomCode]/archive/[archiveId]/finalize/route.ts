import { NextRequest, NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendArchiveReady } from "@/lib/email/transactional";

/**
 * POST /api/streams/[streamId]/archive/[archiveId]/finalize
 * Body: { byteSize?: number, success: boolean, failureReason?: string }
 *
 * Called by the browser after the direct R2 PUT either succeeds or
 * fails. Updates the archive row's status + byte_size + completed_at,
 * and (on success) writes the public_url back onto the streams row so
 * the dashboard "Recording available" badge shows up immediately.
 *
 * The host is trusted to report success/failure honestly. Even if a
 * malicious host lies, the only consequence is a stream_archives row
 * marked 'ready' with no actual object — the bucket itself is never
 * exposed for write outside the presigned URL.
 */
export async function POST(
  req: NextRequest,
  {
    params,
  }: {
    params: Promise<{ roomCode: string; archiveId: string }>;
  },
) {
  const { roomCode: streamId, archiveId } = await params;
  if (!streamId || !archiveId) {
    return NextResponse.json(
      { error: "Missing streamId or archiveId." },
      { status: 400 },
    );
  }

  let body: { byteSize?: number; success?: boolean; failureReason?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (typeof body.success !== "boolean") {
    return NextResponse.json(
      { error: "success boolean is required." },
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

  const { data: archive, error: lookupErr } = await admin
    .from("stream_archives")
    .select("id, host_id, stream_id, status, public_url, object_key, bucket")
    .eq("id", archiveId)
    .maybeSingle();
  if (lookupErr || !archive) {
    return NextResponse.json({ error: "Archive not found." }, { status: 404 });
  }
  if (archive.stream_id !== streamId) {
    return NextResponse.json(
      { error: "archiveId does not belong to streamId." },
      { status: 400 },
    );
  }

  // Ownership: only the host who owns the archive (or an admin) can
  // finalize it.
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
  const isAdmin = host.role === "admin" || host.is_admin === true;
  if (!isAdmin && archive.host_id !== host.id) {
    return NextResponse.json(
      { error: "You do not own this archive." },
      { status: 403 },
    );
  }

  if (archive.status === "ready") {
    // Idempotent — already finalised.
    return NextResponse.json({ archive, alreadyFinalized: true });
  }

  // ─── persist ──────────────────────────────────────────────────────
  const patch: Record<string, unknown> = {
    completed_at: new Date().toISOString(),
  };
  if (body.success) {
    patch.status = "ready";
    if (typeof body.byteSize === "number" && body.byteSize > 0) {
      patch.byte_size = body.byteSize;
    }
  } else {
    patch.status = "failed";
    patch.failure_reason = body.failureReason?.slice(0, 500) ?? "Upload failed.";
  }

  const { data: updated, error: updateErr } = await admin
    .from("stream_archives")
    .update(patch)
    .eq("id", archive.id)
    .select()
    .single();
  if (updateErr) {
    console.error("[archive/finalize] update failed:", updateErr.message);
    return NextResponse.json({ error: updateErr.message }, { status: 500 });
  }

  // On success, also reflect onto streams.recording_url for backwards
  // compatibility with existing UI that reads that column.
  if (body.success && archive.public_url) {
    await admin
      .from("streams")
      .update({ recording_url: archive.public_url })
      .eq("id", streamId);
  }

  // ─── Notify host ──────────────────────────────────────────────────
  // Fire-and-forget. Failure to send the email never breaks the
  // finalize response. We only email on success — failed uploads are
  // already surfaced in the UI via the failure_reason column.
  if (body.success) {
    void notifyArchiveReady(admin, {
      hostId: archive.host_id,
      streamId: archive.stream_id,
      byteSize:
        typeof body.byteSize === "number" ? body.byteSize : null,
    });
  }

  return NextResponse.json({ archive: updated });
}

async function notifyArchiveReady(
  admin: ReturnType<typeof createAdminClient>,
  args: { hostId: string; streamId: string; byteSize: number | null },
): Promise<void> {
  try {
    const { data: host } = await admin
      .from("hosts")
      .select("email, display_name")
      .eq("id", args.hostId)
      .maybeSingle();
    if (!host?.email) return;

    const { data: stream } = await admin
      .from("streams")
      .select("title")
      .eq("id", args.streamId)
      .maybeSingle();

    await sendArchiveReady({
      to: host.email,
      displayName: host.display_name ?? host.email,
      streamTitle: stream?.title ?? "Untitled stream",
      streamId: args.streamId,
      byteSize: args.byteSize,
    });
  } catch (e) {
    console.error("[archive/finalize] notifyArchiveReady failed:", e);
  }
}
