import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getEffectivePlan } from "@/lib/billing/entitlements";
import { featureEnabled, featureQuota } from "@/lib/billing/plans";
import { generateText, getAvailableTextProvider } from "@/lib/ai/provider";
import { getPromptForTask, type TaskType } from "@/lib/ai/prompts";

/**
 * POST /api/ai/generate
 *
 * Generates AI content for a host. Flow:
 *   1. Auth — requires an authenticated host.
 *   2. Entitlement — host must have ai_content_generation feature.
 *   3. Quota — checks ai_monthly_generations limit (if numeric).
 *   4. Generate — calls Groq or NVIDIA NIM via lib/ai/provider.ts.
 *   5. Persist — writes ai_tasks + ai_generated_assets rows.
 *   6. Return — the generated content + asset id.
 *
 * Request body:
 *   taskType  — one of TaskType values
 *   input     — task-specific context (topic, platform, tone, etc.)
 *   provider  — optional override ("groq" | "nvidia_nim")
 *
 * Response:
 *   { ok: true, content, assetId, tokensUsed, provider, model }
 *   { ok: false, error }
 */
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const admin = createAdminClient();

  // Load host row
  const { data: host } = await admin
    .from("hosts")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!host) {
    return NextResponse.json({ error: "No host profile found." }, { status: 404 });
  }

  // Entitlement check
  const effective = await getEffectivePlan(supabase, user.id);
  if (!effective.isPlatformAdmin && !featureEnabled(effective.plan, "ai_content_generation")) {
    return NextResponse.json(
      { error: "Your plan does not include AI content generation. Upgrade to access this feature." },
      { status: 403 },
    );
  }

  // Monthly quota check (only if plan has a numeric limit)
  const quota = featureQuota(effective.plan, "ai_monthly_generations", null);
  if (quota !== null) {
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const { count } = await admin
      .from("ai_tasks")
      .select("id", { count: "exact", head: true })
      .eq("host_id", host.id)
      .eq("status", "done")
      .gte("created_at", startOfMonth.toISOString());

    if ((count ?? 0) >= quota) {
      return NextResponse.json(
        { error: `Monthly AI generation limit of ${quota} reached. Upgrade for more.` },
        { status: 429 },
      );
    }
  }

  // Parse request body
  let taskType: TaskType;
  let input: Record<string, unknown>;
  let providerOverride: string | undefined;

  try {
    const body = (await req.json()) as {
      taskType?: string;
      input?: Record<string, unknown>;
      provider?: string;
    };
    taskType = (body.taskType as TaskType) ?? "content_ideas";
    input = body.input ?? {};
    providerOverride = body.provider;
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  // Validate task type has a prompt
  const prompts = getPromptForTask(taskType, input);
  if (!prompts) {
    return NextResponse.json(
      { error: `Unsupported task type: ${taskType}` },
      { status: 400 },
    );
  }

  const provider = (providerOverride as "groq" | "nvidia_nim" | undefined) ?? await getAvailableTextProvider();
  if (!provider) {
    return NextResponse.json(
      { error: "No AI provider is configured. Set GROQ_API_KEY or NVIDIA_API_KEY." },
      { status: 503 },
    );
  }

  // Create task row (pending → running)
  const { data: taskRow, error: taskInsertErr } = await admin
    .from("ai_tasks")
    .insert({
      host_id: host.id,
      task_type: taskType,
      status: "running",
      input,
      provider,
      source_type: "manual",
      started_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (taskInsertErr || !taskRow) {
    console.error("[ai/generate] task insert failed:", taskInsertErr?.message);
    return NextResponse.json({ error: "Failed to create task." }, { status: 500 });
  }

  // Call AI provider
  const result = await generateText({
    systemPrompt: prompts.systemPrompt,
    userPrompt: prompts.userPrompt,
    provider,
    maxTokens: 1500,
    temperature: 0.72,
  });

  if (!result.ok) {
    // Mark task as failed
    await admin
      .from("ai_tasks")
      .update({ status: "failed", error: result.error, completed_at: new Date().toISOString() })
      .eq("id", taskRow.id);

    return NextResponse.json({ error: result.error }, { status: 502 });
  }

  // Mark task as done
  await admin
    .from("ai_tasks")
    .update({
      status: "done",
      output: { content: result.content },
      model: result.model,
      tokens_used: result.tokensUsed,
      completed_at: new Date().toISOString(),
    })
    .eq("id", taskRow.id);

  // Persist the generated asset
  const assetType = taskTypeToAssetType(taskType);
  const platform = (input.platform as string) ?? null;

  const { data: assetRow } = await admin
    .from("ai_generated_assets")
    .insert({
      host_id: host.id,
      task_id: taskRow.id,
      asset_type: assetType,
      title: buildAssetTitle(taskType, input),
      content: result.content,
      platform: platform && VALID_PLATFORMS.includes(platform) ? platform : null,
      metadata: {
        tone: input.tone,
        niche: input.niche,
        model: result.model,
        provider: result.provider,
        tokens_used: result.tokensUsed,
      },
    })
    .select("id")
    .single();

  return NextResponse.json({
    ok: true,
    content: result.content,
    assetId: assetRow?.id ?? null,
    tokensUsed: result.tokensUsed,
    provider: result.provider,
    model: result.model,
  });
}

const VALID_PLATFORMS = ["youtube", "tiktok", "instagram", "twitter", "linkedin", "generic"];

function taskTypeToAssetType(taskType: TaskType): string {
  const map: Record<TaskType, string> = {
    script_gen: "script",
    caption_gen: "caption",
    hashtag_gen: "hashtags",
    title_gen: "title",
    content_ideas: "content_ideas",
    affiliate_campaign: "campaign_copy",
    short_video_script: "short_video_script",
    short_video_ad: "short_video_script",
    hook_variants: "campaign_copy",
    ad_copy_full: "campaign_copy",
    weekly_summary: "summary",
    post_stream_recap: "summary",
  };
  return map[taskType] ?? taskType;
}

function buildAssetTitle(taskType: TaskType, input: Record<string, unknown>): string {
  const topic = typeof input.topic === "string" ? input.topic : "";
  const labels: Record<TaskType, string> = {
    script_gen: "Stream Script",
    caption_gen: "Social Caption",
    hashtag_gen: "Hashtag Pack",
    title_gen: "Title Variants",
    content_ideas: "Content Ideas",
    affiliate_campaign: "Campaign Copy",
    short_video_script: "Short Video Script",
    short_video_ad: "Short Video Ad",
    hook_variants: "Hook Variants",
    ad_copy_full: "Ad Creative Pack",
    weekly_summary: "Weekly Summary",
    post_stream_recap: "Stream Recap",
  };
  const label = labels[taskType] ?? taskType;
  return topic ? `${label} — ${topic.slice(0, 60)}` : label;
}
