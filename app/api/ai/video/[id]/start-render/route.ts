import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { presignUpload } from "@/lib/storage/r2";

/**
 * POST /api/ai/video/[id]/start-render
 *
 * Mints a presigned R2 PUT URL for a browser-direct video upload,
 * creates a video_renders row in 'uploading' state, and returns
 * the upload credentials.
 *
 * The browser then PUTs the assembled video blob directly to R2
 * (no Worker proxy — avoids the 100MB body limit), then calls
 * /api/ai/video/[id]/finalize-render to mark the render complete.
 *
 * Body: { contentType?: string }
 * Returns: { ok, renderId, uploadUrl, headers, publicUrl }
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const admin = createAdminClient();
  const { data: host } = await admin
    .from("hosts")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!host)
    return NextResponse.json({ error: "Host not found." }, { status: 404 });

  let body: { contentType?: string } = {};
  try {
    body = await req.json();
  } catch {
    /* defaults */
  }
  const contentType = body.contentType ?? "video/webm";

  // Verify project ownership
  const { data: project } = await admin
    .from("video_projects")
    .select("id")
    .eq("id", id)
    .eq("host_id", host.id)
    .maybeSingle();
  if (!project)
    return NextResponse.json({ error: "Project not found." }, { status: 404 });

  // Create video_renders row
  const { data: render, error: renderErr } = await admin
    .from("video_renders")
    .insert({
      host_id: host.id,
      project_id: id,
      content_type: contentType,
      status: "uploading",
    })
    .select("id")
    .single();
  if (renderErr || !render)
    return NextResponse.json(
      { error: renderErr?.message ?? "Could not create render record." },
      { status: 500 },
    );

  // Mint presigned PUT URL
  const objectKey = `video-projects/${id}/render-${render.id}.webm`;
  let uploadUrl: string;
  let headers: Record<string, string>;
  let publicUrl: string | null;

  try {
    const signed = await presignUpload({ objectKey, contentType });
    uploadUrl = signed.uploadUrl;
    headers = signed.headers;
    publicUrl = signed.publicUrl;
  } catch (err) {
    // Clean up the dangling render row
    await admin.from("video_renders").delete().eq("id", render.id);
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? err.message
            : "R2 storage is not configured — contact your admin.",
      },
      { status: 500 },
    );
  }

  // Store object key now so finalize-render can look it up
  await admin
    .from("video_renders")
    .update({ object_key: objectKey })
    .eq("id", render.id);

  return NextResponse.json({
    ok: true,
    renderId: render.id,
    uploadUrl,
    headers,
    publicUrl,
  });
}
