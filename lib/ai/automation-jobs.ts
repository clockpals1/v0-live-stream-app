/**
 * lib/ai/automation-jobs.ts
 *
 * Shared automation rule processor. Used by:
 *   - /api/cron/ai/daily-jobs  (batch run for all due rules)
 *   - /api/ai/rules/[id]/run   (single rule "Run now" triggered by user)
 *
 * Keeping this logic in one place means a rule change only needs to be
 * made here, and both the cron and the manual trigger stay in sync.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { generateText } from "@/lib/ai/provider";
import { getPromptForTask } from "@/lib/ai/prompts";
import type { AiConfig } from "@/lib/ai/config";

// ─── Types ────────────────────────────────────────────────────────────────────

export type AutomationRuleRow = {
  id: string;
  host_id: string;
  rule_type: string;
  label: string;
  schedule: string;
  config: Record<string, unknown>;
  last_run_at: string | null;
  run_count: number;
};

export type JobResult = {
  ok: boolean;
  assetCount: number;
  error?: string;
};

// ─── Main processor ───────────────────────────────────────────────────────────

export async function processAutomationRule(
  rule: AutomationRuleRow,
  supabase: SupabaseClient,
  cfg: AiConfig,
): Promise<JobResult> {
  const dailyIdeas = cfg.agent_daily_ideas ?? 5;

  switch (rule.rule_type) {

    // ── Daily content ideas ───────────────────────────────────────────────
    case "daily_content_ideas": {
      const niche    = (rule.config.niche    as string) ?? "content creation";
      const platform = (rule.config.platform as string) ?? "generic";
      const tone     = (rule.config.tone     as string) ?? "casual";

      const prompts = getPromptForTask("content_ideas", { topic: niche, platform, tone } as Parameters<typeof getPromptForTask>[1]);
      if (!prompts) return { ok: false, assetCount: 0, error: "No prompt for content_ideas" };

      const result = await generateText({
        systemPrompt: prompts.systemPrompt.replace("7 content ideas", `${dailyIdeas} content ideas`),
        userPrompt:   prompts.userPrompt,
        config: cfg,
        maxTokens: 800,
        temperature: 0.8,
      });
      if (!result.ok) return { ok: false, assetCount: 0, error: result.error };

      await supabase.from("ai_generated_assets").insert({
        host_id:    rule.host_id,
        asset_type: "content_ideas",
        title:      `Daily ideas — ${fmtDate()}`,
        content:    result.content,
        platform:   platform !== "generic" ? platform : null,
        metadata:   { rule_id: rule.id, auto: true, provider: result.provider, model: result.model },
      });

      return { ok: true, assetCount: 1 };
    }

    // ── Weekly performance summary ────────────────────────────────────────
    case "weekly_summary": {
      const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const { data: streams } = await supabase
        .from("streams")
        .select("title, viewer_count")
        .eq("host_id", rule.host_id)
        .gte("created_at", since)
        .order("viewer_count", { ascending: false });

      const streamCount   = streams?.length ?? 0;
      const totalViewers  = streams?.reduce((s, r) => s + (r.viewer_count ?? 0), 0) ?? 0;
      const topTitle      = streams?.[0]?.title ?? "untitled stream";

      const prompts = getPromptForTask("weekly_summary", {
        streamCount, totalViewers,
        topStreamTitle: topTitle,
        subscriberGrowth: 0,
        periodLabel: "last 7 days",
      } as Parameters<typeof getPromptForTask>[1]);
      if (!prompts) return { ok: false, assetCount: 0, error: "No prompt for weekly_summary" };

      const result = await generateText({
        systemPrompt: prompts.systemPrompt,
        userPrompt:   prompts.userPrompt,
        config: cfg, maxTokens: 400, temperature: 0.6,
      });
      if (!result.ok) return { ok: false, assetCount: 0, error: result.error };

      await supabase.from("ai_generated_assets").insert({
        host_id:    rule.host_id,
        asset_type: "summary",
        title:      `Weekly summary — ${fmtDate()}`,
        content:    result.content,
        metadata:   { rule_id: rule.id, auto: true, stream_count: streamCount, total_viewers: totalViewers },
      });

      return { ok: true, assetCount: 1 };
    }

    // ── Affiliate campaign copy ───────────────────────────────────────────
    case "affiliate_campaign": {
      const productName = (rule.config.product_name as string) ?? "";
      if (!productName) return { ok: false, assetCount: 0, error: "No product_name in rule config" };

      const prompts = getPromptForTask("affiliate_campaign", {
        topic:              productName,
        productName,
        productDescription: (rule.config.product_description as string) ?? "",
        niche:              (rule.config.niche               as string) ?? "",
        tone:               (rule.config.tone                as string) ?? "casual",
      } as Parameters<typeof getPromptForTask>[1]);
      if (!prompts) return { ok: false, assetCount: 0, error: "No prompt for affiliate_campaign" };

      const result = await generateText({
        systemPrompt: prompts.systemPrompt,
        userPrompt:   prompts.userPrompt,
        config: cfg, maxTokens: 900, temperature: 0.7,
      });
      if (!result.ok) return { ok: false, assetCount: 0, error: result.error };

      await supabase.from("ai_generated_assets").insert({
        host_id:    rule.host_id,
        asset_type: "campaign_copy",
        title:      `Affiliate campaign — ${productName}`,
        content:    result.content,
        metadata:   { rule_id: rule.id, auto: true, product: productName },
      });

      return { ok: true, assetCount: 1 };
    }

    // ── Short video autopilot (NEW) ───────────────────────────────────────
    case "short_video_autopilot": {
      const niche             = (rule.config.niche              as string) ?? "content creation";
      const platform          = (rule.config.platform           as string) ?? "tiktok";
      const tone              = (rule.config.tone               as string) ?? "energetic";
      const monetizationAngle = (rule.config.monetization_angle as string) ?? "organic";
      const videoLength       = (rule.config.video_length       as string) ?? "60";

      const prompts = getPromptForTask("short_video_script", {
        topic: `Create a compelling short video about: ${niche}`,
        platform,
        tone,
        niche,
        videoLength,
        monetizationAngle,
      } as Parameters<typeof getPromptForTask>[1]);
      if (!prompts) return { ok: false, assetCount: 0, error: "No prompt for short_video_script" };

      const result = await generateText({
        systemPrompt: prompts.systemPrompt,
        userPrompt:   prompts.userPrompt,
        config: cfg, maxTokens: 700, temperature: 0.75,
      });
      if (!result.ok) return { ok: false, assetCount: 0, error: result.error };

      await supabase.from("ai_generated_assets").insert({
        host_id:    rule.host_id,
        asset_type: "short_video_script",
        title:      `Auto short video — ${niche} — ${fmtDate()}`,
        content:    result.content,
        platform:   platform !== "generic" ? platform : null,
        metadata:   { rule_id: rule.id, auto: true, provider: result.provider, model: result.model, niche },
      });

      return { ok: true, assetCount: 1 };
    }

    // ── Evergreen content repurposer (NEW) ────────────────────────────────
    case "evergreen_repurpose": {
      const niche = (rule.config.niche as string) ?? "";
      const tone  = (rule.config.tone  as string) ?? "casual";

      // Find the most valuable recent asset — starred first, then most recent
      const { data: assets } = await supabase
        .from("ai_generated_assets")
        .select("id, title, content, asset_type, created_at")
        .eq("host_id", rule.host_id)
        .is("archived_at", null)
        .in("asset_type", ["short_video_script", "script", "campaign_copy", "content_ideas"])
        .order("is_starred", { ascending: false })
        .order("created_at",  { ascending: false })
        .limit(5);

      if (!assets || assets.length === 0) {
        return { ok: false, assetCount: 0, error: "No source assets to repurpose yet — generate some content first" };
      }

      const source = assets[0];
      const snippet = source.content.slice(0, 600).replace(/\n{3,}/g, "\n\n");

      const systemPrompt = `You are a professional content repurposing strategist for creators and business owners.
Given a piece of existing content, you generate 3 high-quality repurposed variations that extend its reach and revenue potential.

Output format — use these exact section labels, each followed by a colon and the content:

NEW HOOK: [A completely new opening hook that grabs attention in a different way]
CAPTION VARIANT: [A repurposed social caption for the same topic, different angle]
TOPIC ANGLE: [A new content idea that expands on this topic — 1-2 sentences]

Rules:
- Each variation must feel fresh and distinct, not a minor rewording
- Write for a ${tone} tone${niche ? ` in the ${niche} niche` : ""}
- The hook should be under 15 words
- The caption should be ready to post (no meta-commentary)
- No markdown, no asterisks, no numbered lists`;

      const userPrompt = `Repurpose this content into 3 fresh variations:

Type: ${source.asset_type.replace(/_/g, " ")}
Title: ${source.title ?? "Untitled"}
Content:
${snippet}`;

      const result = await generateText({
        systemPrompt,
        userPrompt,
        config: cfg, maxTokens: 500, temperature: 0.8,
      });
      if (!result.ok) return { ok: false, assetCount: 0, error: result.error };

      await supabase.from("ai_generated_assets").insert({
        host_id:    rule.host_id,
        asset_type: "campaign_copy",
        title:      `Evergreen repurpose — ${fmtDate()}`,
        content:    result.content,
        metadata:   {
          rule_id:       rule.id,
          auto:          true,
          provider:      result.provider,
          source_asset:  source.id,
          source_title:  source.title,
        },
      });

      return { ok: true, assetCount: 1 };
    }

    default:
      return { ok: false, assetCount: 0, error: `Unknown rule_type: ${rule.rule_type}` };
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(): string {
  return new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
