import { NextRequest, NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { deleteObject } from "@/lib/storage/r2";

/**
 * DELETE /api/streams/[roomCode]/archive/[archiveId]
 * Body: { reason?: string }
 *
 * Hosts use this to delete their own recording from R2. Admins can
 * delete any. The R2 object is hard-deleted; the database row is
 * soft-deleted (status='deleted', deleted_at populated) so the audit
 * trail survives — useful for support requests like "where did my
 * recording go?".
 *
 * Idempotency: deleting an already-deleted archive returns 200 with
 * `alreadyDeleted: true`. R2 itself is idempotent on DELETE.
 *
 * Security model:
 *   - Auth required (401 if not signed in).
 *   - Owner-only OR admin (403 otherwise).
 *   - Service-role client used for the actual writes so RLS doesn't
 *     have to expose UPDATE on stream_archives to authenticated users.
 */
export async function DELETE(
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

  // Body is optional. Reason is captured into delete_reason for audit.
  let reason: string | undefined;
  try {
    const body = (await req.json()) as { reason?: string };
    if (body.reason) reason = String(body.reason).slice(0, 500);
  } catch {
    /* no body — treat as host-initiated delete with no note */
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
    .select("id, host_id, stream_id, object_key, bucket, status, deleted_at")
    .eq("id", archiveId)
    .maybeSingle();
  if (lookupErr) {
    return NextResponse.json({ error: lookupErr.message }, { status: 500 });
  }
  if (!archive) {
    return NextResponse.json({ error: "Archive not found." }, { status: 404 });
  }
  if (archive.stream_id !== streamId) {
    return NextResponse.json(
      { error: "archiveId does not belong to streamId." },
      { status: 400 },
    );
  }

  // Idempotent — already gone.
  if (archive.deleted_at || archive.status === "deleted") {
    return NextResponse.json({ ok: true, alreadyDeleted: true });
  }

  // ─── ownership check ─────────────────────────────────────────────
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

  // ─── delete the R2 object first ──────────────────────────────────
  // We delete the object BEFORE flipping the row, so a failure leaves
  // the row in a recoverable "still exists, can retry" state. If the
  // object doesn't exist (e.g. an upload that never finished), R2
  // returns 204 anyway and we still soft-delete the row.
  const r2 = await deleteObject({ objectKey: archive.object_key });
  if (!r2.ok) {
    console.error(
      `[archive/delete] R2 delete failed for ${archive.object_key}: ${r2.error}`,
    );
    return NextResponse.json(
      {
        error: r2.error ?? "Failed to delete archive from storage.",
        retry: true,
      },
      { status: 502 },
    );
  }

  // ─── soft-delete the row ─────────────────────────────────────────
  const { data: updated, error: updErr } = await admin
    .from("stream_archives")
    .update({
      status: "deleted",
      deleted_at: new Date().toISOString(),
      deleted_by: user.id,
      delete_reason: reason ?? (isAdmin && archive.host_id !== host.id ? "admin" : "host"),
      // Null out the public_url so the dashboard can't accidentally
      // show a broken video player tile.
      public_url: null,
    })
    .eq("id", archive.id)
    .select()
    .single();
  if (updErr) {
    // Object is already gone from R2 but the row update failed. Log
    // hard so an operator can fix manually.
    console.error(
      `[archive/delete] CRITICAL: R2 object ${archive.object_key} was deleted but DB update failed: ${updErr.message}`,
    );
    return NextResponse.json({ error: updErr.message }, { status: 500 });
  }

  // Also clear streams.recording_url if it was pointing to this object,
  // so the dashboard immediately reflects the deletion.
  await admin
    .from("streams")
    .update({ recording_url: null })
    .eq("id", streamId);

  console.info(
    `[archive/delete] ${user.email ?? user.id} deleted archive ${archive.id} (${archive.object_key})`,
  );

  return NextResponse.json({ ok: true, archive: updated });
}
