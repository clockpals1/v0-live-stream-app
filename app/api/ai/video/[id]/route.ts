import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * GET /api/ai/video/[id]
 * Returns the full video project record for the authenticated host.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const admin = createAdminClient();

  const { data: host } = await admin
    .from("hosts")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!host) return NextResponse.json({ error: "Host not found." }, { status: 404 });

  const { data: project, error } = await admin
    .from("video_projects")
    .select("*")
    .eq("id", id)
    .eq("host_id", host.id)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!project) return NextResponse.json({ error: "Project not found." }, { status: 404 });

  return NextResponse.json({ ok: true, project });
}

/**
 * PATCH /api/ai/video/[id]
 * Updates mutable fields on a video project.
 * Allowed fields: title, hook, concept, script_body, cta, caption, scenes, status,
 *                 voiceover_status, render_status, preview_url, render_url, publish_queue_id
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const admin = createAdminClient();

  const { data: host } = await admin
    .from("hosts")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!host) return NextResponse.json({ error: "Host not found." }, { status: 404 });

  // Verify ownership
  const { data: existing } = await admin
    .from("video_projects")
    .select("id")
    .eq("id", id)
    .eq("host_id", host.id)
    .maybeSingle();
  if (!existing) return NextResponse.json({ error: "Project not found." }, { status: 404 });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const ALLOWED = [
    "title", "hook", "concept", "script_body", "cta", "caption",
    "scenes", "status", "voiceover_status", "render_status",
    "preview_url", "render_url", "publish_queue_id",
  ];

  const updates: Record<string, unknown> = {};
  for (const key of ALLOWED) {
    if (key in body) updates[key] = body[key];
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No valid fields to update." }, { status: 400 });
  }

  const { data: updated, error } = await admin
    .from("video_projects")
    .update(updates)
    .eq("id", id)
    .select("*")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, project: updated });
}

/**
 * DELETE /api/ai/video/[id]
 * Archives (soft-deletes) a video project and its linked asset.
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const admin = createAdminClient();

  const { data: host } = await admin
    .from("hosts")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!host) return NextResponse.json({ error: "Host not found." }, { status: 404 });

  const { data: project } = await admin
    .from("video_projects")
    .select("id, asset_id")
    .eq("id", id)
    .eq("host_id", host.id)
    .maybeSingle();
  if (!project) return NextResponse.json({ error: "Project not found." }, { status: 404 });

  const now = new Date().toISOString();

  const { error } = await admin
    .from("video_projects")
    .update({ archived_at: now })
    .eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if (project.asset_id) {
    await admin
      .from("ai_generated_assets")
      .update({ archived_at: now })
      .eq("id", project.asset_id);
  }

  return NextResponse.json({ ok: true });
}
