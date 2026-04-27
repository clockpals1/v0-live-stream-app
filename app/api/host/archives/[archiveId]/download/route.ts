import { NextRequest, NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { presignDownload } from "@/lib/storage/r2";

/**
 * GET /api/host/archives/[archiveId]/download
 *
 * Returns a short-lived presigned GET URL for a private-bucket archive,
 * or echoes the public_url for public-bucket archives. The host (or
 * platform admin) must own the archive.
 *
 * The client redirects the user to the returned url so the browser
 * handles the actual download — no bytes flow through the Worker.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ archiveId: string }> },
) {
  const { archiveId } = await params;
  if (!archiveId) {
    return NextResponse.json({ error: "Missing archiveId." }, { status: 400 });
  }

  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const admin = createAdminClient();
  const { data: host } = await admin
    .from("hosts")
    .select("id, role, is_admin")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!host) return NextResponse.json({ error: "No host profile." }, { status: 404 });

  const { data: archive } = await admin
    .from("stream_archives")
    .select("id, host_id, object_key, public_url, status")
    .eq("id", archiveId)
    .is("deleted_at", null)
    .maybeSingle();

  if (!archive) return NextResponse.json({ error: "Archive not found." }, { status: 404 });

  const isAdmin = host.role === "admin" || host.is_admin === true;
  if (!isAdmin && archive.host_id !== host.id) {
    return NextResponse.json({ error: "You do not own this archive." }, { status: 403 });
  }
  if (archive.status !== "ready") {
    return NextResponse.json({ error: "Archive is not ready yet." }, { status: 409 });
  }

  // Public bucket — redirect directly.
  if (archive.public_url) {
    return NextResponse.json({ url: archive.public_url });
  }

  // Private bucket — generate presigned URL (2-hour window for large downloads).
  if (!archive.object_key) {
    return NextResponse.json({ error: "Archive has no stored object key." }, { status: 409 });
  }
  try {
    const url = await presignDownload({ objectKey: archive.object_key, expiresInSeconds: 7200 });
    return NextResponse.json({ url });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "R2 not configured.";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
