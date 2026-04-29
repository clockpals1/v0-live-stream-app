import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { generateText, getAvailableTextProvider } from "@/lib/ai/provider";
import { getPromptForTask, type TaskType } from "@/lib/ai/prompts";
import { parseVideoScript } from "@/lib/ai/parse-video-script";

/**
 * POST /api/ai/video/[id]/regenerate
 *
 * Re-runs AI generation for a video project.
 *
 * Body: { fields: "full" | "script" | "scenes" }
 *   "full"   — regenerate everything via AI (hook, concept, script, CTA, caption, scenes)
 *   "script" — regenerate script fields only (hook, concept, script_body, cta, caption), keep scenes
 *   "scenes" — derive scenes from the current script without a new AI call
 */
export async function POST(
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

  const { data: project } = await admin
    .from("video_projects")
    .select("*")
    .eq("id", id)
    .eq("host_id", host.id)
    .maybeSingle();
  if (!project) return NextResponse.json({ error: "Project not found." }, { status: 404 });

  let body: { fields?: string } = {};
  try { body = await req.json(); } catch { /* default to full */ }
  const fields = (body.fields as "full" | "script" | "scenes") ?? "full";

  // ── Scenes-only: re-derive from current script without an AI call ──────────
  if (fields === "scenes") {
    const scriptText = [
      project.hook    ? `HOOK: ${project.hook}` : "",
      project.concept ? `CONCEPT: ${project.concept}` : "",
      project.script_body ? `SCRIPT BODY:\n${project.script_body}` : "",
      project.cta     ? `CTA: ${project.cta}` : "",
      project.caption ? `CAPTION: ${project.caption}` : "",
    ].filter(Boolean).join("\n\n");

    const parsed = parseVideoScript(scriptText, String(project.video_length ?? "30"));
    const scenes = parsed.scenes.length > 0 ? parsed.scenes : (project.scenes ?? []);

    const { data: updated, error } = await admin
      .from("video_projects")
      .update({ scenes, status: "script_ready" })
      .eq("id", id)
      .select("*")
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, project: updated });
  }

  // ── AI-based regeneration (full or script) ─────────────────────────────────
  const meta = (project.metadata ?? {}) as Record<string, unknown>;
  const taskType: TaskType =
    (meta.task_type as TaskType | undefined) ?? "short_video_script";

  const rawTopic = String(project.title ?? "")
    .replace(/^Short Video (Ad )?Project — /i, "")
    .trim();

  const input: Record<string, unknown> = {
    topic:      rawTopic || "short video",
    platform:   project.platform,
    videoLength: String(project.video_length ?? "30"),
    tone:       meta.tone,
    niche:      meta.niche,
    audience:   meta.audience,
    monetAngle: meta.monetization_angle,
  };

  const prompts = getPromptForTask(taskType, input);
  if (!prompts) {
    return NextResponse.json({ error: `No prompt for task type: ${taskType}` }, { status: 400 });
  }

  const provider = await getAvailableTextProvider();
  if (!provider) {
    return NextResponse.json({ error: "No AI provider configured." }, { status: 503 });
  }

  const result = await generateText({
    systemPrompt: prompts.systemPrompt,
    userPrompt:   prompts.userPrompt,
    provider,
    maxTokens:    2500,
    temperature:  0.72,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 502 });
  }

  const parsed = parseVideoScript(result.content, String(project.video_length ?? "30"));

  const updates: Record<string, unknown> = {
    hook:        parsed.hook        || project.hook,
    concept:     parsed.concept     || project.concept,
    script_body: parsed.script_body || project.script_body,
    cta:         parsed.cta         || project.cta,
    caption:     parsed.caption     || project.caption,
  };

  if (fields === "full") {
    updates.scenes = parsed.scenes.length > 0 ? parsed.scenes : project.scenes;
    updates.status = "script_ready";
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
