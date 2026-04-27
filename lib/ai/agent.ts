/**
 * AI Automation Hub — God-mode multi-step agentic executor.
 *
 * God-mode chains multiple AI tasks in sequence, feeding each step's
 * output into the next as context. The agent:
 *   1. Plans — asks the LLM what steps to take for a given goal
 *   2. Executes — runs each subtask, storing the result
 *   3. Synthesises — combines outputs into a final deliverable
 *   4. Persists — writes each asset to ai_generated_assets
 *
 * This is NOT an "autonomous web-browsing" agent — it orchestrates the
 * existing prompt builders (lib/ai/prompts.ts) into compound workflows
 * designed for creator business outcomes.
 *
 * EXAMPLE GOD-MODE WORKFLOW: "Complete weekly content pack"
 *   Step 1  → generate 7 content ideas for the host's niche
 *   Step 2  → pick the top 3 and write stream scripts for each
 *   Step 3  → write caption + hashtag pack per script (for TikTok/IG)
 *   Step 4  → write short video script for the #1 idea
 *   Step 5  → write affiliate campaign copy if rule.config has a product
 *   Final   → synthesise a "this week's content plan" summary
 *
 * SAFETY
 * ------
 * - agent_max_steps enforced from ai_config (default 5, max 20)
 * - agent_auto_publish=false by default — human reviews before posting
 * - Each step writes to ai_generated_assets immediately; partial runs
 *   are still recoverable if the chain fails mid-way
 * - All errors are returned (never thrown); the cron route decides retry
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { getAiConfig } from "@/lib/ai/config";
import { generateText } from "@/lib/ai/provider";
import { getPromptForTask, type TaskType } from "@/lib/ai/prompts";

// ─── Public types ─────────────────────────────────────────────────────────

export interface AgentGoal {
  /** Natural-language description of what to produce. */
  description: string;
  /** Host's niche/context for the LLM planner. */
  niche?: string;
  /** Platform the content is optimised for. */
  platform?: string;
  /** Tone preference. */
  tone?: string;
  /** Optional product for affiliate campaign steps. */
  productName?: string;
  /** Force a specific list of steps instead of LLM-planned steps. */
  forcedSteps?: AgentStepDef[];
}

export interface AgentStepDef {
  taskType: TaskType;
  topic: string;
  useContextFromStep?: number; // inject output of step N as additional context
}

export interface AgentStepResult {
  stepNumber: number;
  taskType: TaskType;
  topic: string;
  content: string;
  assetId: string | null;
  tokensUsed: number;
  provider: string;
  model: string;
  error?: string;
}

export interface AgentRunResult {
  ok: boolean;
  goal: string;
  steps: AgentStepResult[];
  finalSummary: string;
  assetsCreated: string[];
  totalTokens: number;
  error?: string;
}

// ─── Core executor ────────────────────────────────────────────────────────

export async function runAgentTask(opts: {
  hostId: string;
  goal: AgentGoal;
  ruleId?: string;
  supabase: SupabaseClient; // admin client
}): Promise<AgentRunResult> {
  const { hostId, goal, supabase } = opts;

  // Load ai_config to get max_steps + provider prefs
  const cfg = await getAiConfig(supabase);
  const maxSteps = cfg?.agent_max_steps ?? 5;

  // Determine steps — use forced list or plan via LLM
  let steps: AgentStepDef[];
  if (goal.forcedSteps && goal.forcedSteps.length > 0) {
    steps = goal.forcedSteps.slice(0, maxSteps);
  } else {
    const planned = await planSteps({ goal, maxSteps, cfg });
    if (!planned.ok) {
      return {
        ok: false,
        goal: goal.description,
        steps: [],
        finalSummary: "",
        assetsCreated: [],
        totalTokens: 0,
        error: `Planning failed: ${planned.error}`,
      };
    }
    steps = planned.steps;
  }

  // Execute each step
  const results: AgentStepResult[] = [];
  const assetsCreated: string[] = [];
  let totalTokens = 0;
  let contextAccumulator = "";

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const stepNum = i + 1;

    // Build the topic, optionally injecting context from a previous step
    let enrichedTopic = step.topic;
    if (step.useContextFromStep !== undefined && step.useContextFromStep > 0) {
      const prevStep = results[step.useContextFromStep - 1];
      if (prevStep?.content) {
        enrichedTopic = `${step.topic}\n\nContext from previous step:\n${prevStep.content.slice(0, 500)}`;
      }
    } else if (contextAccumulator && i > 0) {
      enrichedTopic = `${step.topic}\n\nPrevious outputs summary:\n${contextAccumulator.slice(0, 400)}`;
    }

    const input: Record<string, unknown> = {
      topic: enrichedTopic,
      niche: goal.niche,
      platform: goal.platform,
      tone: goal.tone,
    };
    if (step.taskType === "affiliate_campaign" && goal.productName) {
      input.productName = goal.productName;
    }

    const prompts = getPromptForTask(step.taskType, input);
    if (!prompts) {
      results.push({
        stepNumber: stepNum,
        taskType: step.taskType,
        topic: step.topic,
        content: "",
        assetId: null,
        tokensUsed: 0,
        provider: "",
        model: "",
        error: `No prompt builder for task type: ${step.taskType}`,
      });
      continue;
    }

    const genResult = await generateText({
      systemPrompt: prompts.systemPrompt,
      userPrompt: prompts.userPrompt,
      config: cfg,
      maxTokens: 1200,
      temperature: 0.72,
    });

    if (!genResult.ok) {
      results.push({
        stepNumber: stepNum,
        taskType: step.taskType,
        topic: step.topic,
        content: "",
        assetId: null,
        tokensUsed: 0,
        provider: genResult.provider,
        model: genResult.model,
        error: genResult.error,
      });
      // Continue — partial runs are still valuable
      continue;
    }

    totalTokens += genResult.tokensUsed;
    contextAccumulator += `\n[Step ${stepNum} — ${step.taskType}]: ${genResult.content.slice(0, 200)}\n`;

    // Persist asset
    const { data: assetRow } = await supabase
      .from("ai_generated_assets")
      .insert({
        host_id: hostId,
        asset_type: taskTypeToAssetType(step.taskType),
        title: `[Agent] ${step.taskType} — ${step.topic.slice(0, 60)}`,
        content: genResult.content,
        platform: goal.platform ?? null,
        metadata: {
          agent_run: true,
          step_number: stepNum,
          goal: goal.description.slice(0, 120),
          provider: genResult.provider,
          model: genResult.model,
          tokens_used: genResult.tokensUsed,
          rule_id: opts.ruleId ?? null,
        },
      })
      .select("id")
      .maybeSingle();

    const assetId = assetRow?.id ?? null;
    if (assetId) assetsCreated.push(assetId);

    results.push({
      stepNumber: stepNum,
      taskType: step.taskType,
      topic: step.topic,
      content: genResult.content,
      assetId,
      tokensUsed: genResult.tokensUsed,
      provider: genResult.provider,
      model: genResult.model,
    });
  }

  // Generate a final summary of the run
  const successfulSteps = results.filter((r) => !r.error);
  const finalSummary = successfulSteps.length > 0
    ? `Agent completed ${successfulSteps.length}/${steps.length} steps. ${assetsCreated.length} assets saved.`
    : "Agent run produced no successful steps.";

  return {
    ok: successfulSteps.length > 0,
    goal: goal.description,
    steps: results,
    finalSummary,
    assetsCreated,
    totalTokens,
  };
}

// ─── LLM Planner ─────────────────────────────────────────────────────────

interface PlanResult {
  ok: boolean;
  steps: AgentStepDef[];
  error?: string;
}

const VALID_TASK_TYPES = new Set<TaskType>([
  "script_gen", "caption_gen", "hashtag_gen", "title_gen",
  "content_ideas", "affiliate_campaign", "short_video_script",
]);

async function planSteps(opts: {
  goal: AgentGoal;
  maxSteps: number;
  cfg: Awaited<ReturnType<typeof getAiConfig>>;
}): Promise<PlanResult> {
  const { goal, maxSteps, cfg } = opts;

  const systemPrompt = `You are an AI workflow planner for a content creator automation system.
Given a creator's goal, output a JSON array of up to ${maxSteps} task steps.
Each step: { "taskType": "<type>", "topic": "<specific topic for this step>" }
Valid taskTypes: script_gen, caption_gen, hashtag_gen, title_gen, content_ideas, affiliate_campaign, short_video_script
Rules:
- Maximum ${maxSteps} steps
- Be specific with topics — include the niche and platform context
- Order steps logically (ideas → scripts → captions → hashtags)
- Output ONLY valid JSON array, no markdown, no explanation`;

  const userPrompt = `Goal: ${goal.description}
Niche: ${goal.niche ?? "general creator"}
Platform: ${goal.platform ?? "generic"}
Tone: ${goal.tone ?? "casual"}
${goal.productName ? `Product: ${goal.productName}` : ""}

Output the step plan as a JSON array.`;

  const result = await generateText({
    systemPrompt,
    userPrompt,
    config: cfg,
    maxTokens: 512,
    temperature: 0.3, // Low temp for planning — we want consistent JSON
  });

  if (!result.ok) return { ok: false, steps: [], error: result.error };

  // Parse the JSON plan
  try {
    const raw = result.content.trim().replace(/^```json?\n?/, "").replace(/\n?```$/, "");
    const parsed = JSON.parse(raw) as Array<{ taskType?: string; topic?: string }>;

    const steps: AgentStepDef[] = parsed
      .filter((s) => s.taskType && VALID_TASK_TYPES.has(s.taskType as TaskType) && s.topic)
      .slice(0, maxSteps)
      .map((s) => ({
        taskType: s.taskType as TaskType,
        topic: s.topic!,
      }));

    if (steps.length === 0) {
      return { ok: false, steps: [], error: "Planner returned no valid steps." };
    }
    return { ok: true, steps };
  } catch (err) {
    return { ok: false, steps: [], error: `Plan JSON parse error: ${String(err)}` };
  }
}

// ─── Utility ──────────────────────────────────────────────────────────────

function taskTypeToAssetType(t: TaskType): string {
  const map: Record<TaskType, string> = {
    script_gen: "script",
    caption_gen: "caption",
    hashtag_gen: "hashtags",
    title_gen: "title",
    content_ideas: "content_ideas",
    affiliate_campaign: "campaign_copy",
    short_video_script: "short_video_script",
    weekly_summary: "summary",
    post_stream_recap: "summary",
  };
  return map[t] ?? t;
}
