import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * POST /api/ai/video/[id]/duplicate
 * Creates a copy of a video project owned by the authenticated host.
 * Returns the new project id.
 */
export async function POST(
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

  const { data: source } = await admin
    .from("video_projects")
    .select("*")
    .eq("id", id)
    .eq("host_id", host.id)
    .maybeSingle();
  if (!source) return NextResponse.json({ error: "Project not found." }, { status: 404 });

  const { data: copy, error } = await admin
    .from("video_projects")
    .insert({
      host_id:     source.host_id,
      asset_id:    null,
      title:       `${source.title} (copy)`,
      platform:    source.platform,
      video_length: source.video_length,
      status:      "script_ready",
      hook:        source.hook,
      concept:     source.concept,
      script_body: source.script_body,
      cta:         source.cta,
      caption:     source.caption,
      scenes:      source.scenes ?? [],
      metadata:    source.metadata ?? {},
    })
    .select("id")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, projectId: copy.id });
}
