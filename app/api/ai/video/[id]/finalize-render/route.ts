import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { presignDownload } from "@/lib/storage/r2";

/**
 * POST /api/ai/video/[id]/finalize-render
 *
 * Called by the browser after a successful PUT to R2. Marks the
 * video_renders row as 'ready', writes render_url + render_status
 * back to the video_project, and optionally generates a signed
 * download URL if the bucket is private.
 *
 * Body: { renderId: string; byteSize?: number }
 * Returns: { ok: true, renderId, publicUrl }
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

  let body: { renderId?: string; byteSize?: number } = {};
  try {
    body = await req.json();
  } catch {
    /* defaults */
  }
  const { renderId, byteSize = 0 } = body;
  if (!renderId)
    return NextResponse.json({ error: "renderId is required." }, { status: 400 });

  // Verify render belongs to this project + host
  const { data: render } = await admin
    .from("video_renders")
    .select("id, host_id, project_id, object_key, public_url")
    .eq("id", renderId)
    .eq("project_id", id)
    .eq("host_id", host.id)
    .maybeSingle();
  if (!render)
    return NextResponse.json({ error: "Render record not found." }, { status: 404 });

  // Resolve final URL (public bucket → publicUrl already set; private → sign it)
  let finalUrl: string | null = render.public_url as string | null;
  if (!finalUrl && render.object_key) {
    try {
      // 7-day signed URL — enough for review + publishing
      finalUrl = await presignDownload({
        objectKey: render.object_key as string,
        expiresInSeconds: 60 * 60 * 24 * 7,
      });
    } catch {
      /* leave null if R2 not reachable */
    }
  }

  // Mark render ready
  await admin
    .from("video_renders")
    .update({ status: "ready", byte_size: byteSize, public_url: finalUrl })
    .eq("id", renderId);

  // Fetch current project metadata to merge
  const { data: proj } = await admin
    .from("video_projects")
    .select("metadata")
    .eq("id", id)
    .maybeSingle();

  // Update project: store render URL + advance status to published
  await admin
    .from("video_projects")
    .update({
      render_url: finalUrl,
      render_status: "ready",
      status: "published",
      metadata: {
        ...(proj?.metadata as Record<string, unknown> ?? {}),
        render_id: renderId,
        rendered_at: new Date().toISOString(),
      },
    })
    .eq("id", id);

  return NextResponse.json({ ok: true, renderId, publicUrl: finalUrl });
}
