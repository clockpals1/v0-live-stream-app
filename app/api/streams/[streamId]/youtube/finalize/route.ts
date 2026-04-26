import { NextRequest, NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * POST /api/streams/[streamId]/youtube/finalize
 * Body: { videoId: string }
 *
 * Called by the browser after the resumable PUT to YouTube returns a
 * 200/201 with the video resource. The browser parses the resource
 * JSON to extract its `id` and posts it here so we can persist the
 * link on the streams row. From the dashboard, anyone viewing the
 * stream can then jump straight to the YouTube watch page.
 *
 * The server doesn't independently verify the videoId belongs to the
 * connected channel — YouTube's resumable session URL is single-use
 * and host-bound, so the only way to reach this endpoint with a real
 * id is to have just uploaded a video on the connected channel.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ streamId: string }> },
) {
  const { streamId } = await params;
  if (!streamId) {
    return NextResponse.json({ error: "Missing streamId." }, { status: 400 });
  }

  let body: { videoId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const videoId = body.videoId?.trim();
  if (!videoId || videoId.length > 32) {
    return NextResponse.json(
      { error: "videoId is required." },
      { status: 400 },
    );
  }

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

  const { data: stream } = await admin
    .from("streams")
    .select("id, host_id")
    .eq("id", streamId)
    .maybeSingle();
  if (!stream) {
    return NextResponse.json({ error: "Stream not found." }, { status: 404 });
  }
  const isAdmin = host.role === "admin" || host.is_admin === true;
  if (!isAdmin && stream.host_id !== host.id) {
    return NextResponse.json(
      { error: "You do not own this stream." },
      { status: 403 },
    );
  }

  const { error } = await admin
    .from("streams")
    .update({ youtube_video_id: videoId })
    .eq("id", streamId);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    videoId,
    watchUrl: `https://www.youtube.com/watch?v=${videoId}`,
  });
}
