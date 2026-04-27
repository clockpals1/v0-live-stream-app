import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAiConfig } from "@/lib/ai/config";
import { processAutomationRule } from "@/lib/ai/automation-jobs";
import { runAgentTask } from "@/lib/ai/agent";

/**
 * POST /api/cron/ai/daily-jobs
 *
 * Background automation cron — runs enabled AI automation rules for all hosts.
 *
 * AUTHENTICATION
 * --------------
 * Bearer CRON_SECRET header (env var). Set this in your Cloudflare Worker
 * environment and in Cloudflare Cron Trigger secret header.
 *
 * SCHEDULING (Cloudflare)
 * -----------------------
 * Add in wrangler.toml or Cloudflare dashboard:
 *   [triggers]
 *   crons = ["0 7 * * *"]   # daily at 07:00 UTC
 *
 * WHAT IT DOES
 * ------------
 * 1. Loads ai_config (checks agent_mode_enabled)
 * 2. Queries ai_automation_rules WHERE enabled=true AND schedule IN ('daily','weekly')
 *    AND (last_run_at IS NULL OR last_run_at < NOW() - interval)
 * 3. For each rule:
 *    a. "daily_content_ideas" → generates N content ideas for the host
 *    b. "weekly_summary"      → generates a weekly performance summary
 *    c. "affiliate_campaign"  → generates campaign copy for configured product
 *    d. "post_stream_recap"   → skipped here (triggered by stream.status='ended')
 * 4. God-mode rules run via lib/ai/agent.runAgentTask()
 * 5. Writes results to ai_generated_assets
 * 6. Creates host_notifications entries so hosts see new assets in their dashboard
 * 7. Updates rule.last_run_at, rule.run_count
 *
 * RATE LIMITS
 * -----------
 * Processes at most MAX_RULES_PER_RUN rules per invocation to stay within
 * Groq's 6,000 tokens/minute free tier across hosts.
 */

const MAX_RULES_PER_RUN = 20;

export async function POST(req: NextRequest) {
  // Auth — CRON_SECRET or Cloudflare CF-Access header
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = req.headers.get("authorization") ?? "";
    const cfCron = req.headers.get("x-cloudflare-cron");
    const isCloudflare = cfCron === "1";
    if (!isCloudflare && auth !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }
  }

  const admin = createAdminClient();
  const startedAt = Date.now();

  // Load AI config
  const cfg = await getAiConfig(admin);
  if (!cfg) {
    return NextResponse.json({ skipped: true, reason: "ai_config table missing." });
  }

  if (!cfg.agent_mode_enabled) {
    return NextResponse.json({ skipped: true, reason: "Agent mode is disabled in AI Configuration." });
  }

  // Query due rules — daily (>23h ago) or weekly (>6.5d ago)
  const now = new Date();
  const dailyCutoff = new Date(now.getTime() - 23 * 60 * 60 * 1000).toISOString();
  const weeklyCutoff = new Date(now.getTime() - 6.5 * 24 * 60 * 60 * 1000).toISOString();
  const isMonday = now.getUTCDay() === 1;

  type RuleRow = {
    id: string;
    host_id: string;
    rule_type: string;
    label: string;
    schedule: string;
    config: Record<string, unknown>;
    last_run_at: string | null;
    run_count: number;
  };

  const { data: rules, error: rulesErr } = await admin
    .from("ai_automation_rules")
    .select("id, host_id, rule_type, label, schedule, config, last_run_at, run_count")
    .eq("enabled", true)
    .in("schedule", ["daily", "weekly"])
    .neq("rule_type", "post_stream_recap") // triggered separately
    .or([
      `schedule.eq.daily,last_run_at.is.null`,
      `schedule.eq.daily,last_run_at.lt.${dailyCutoff}`,
      isMonday ? `schedule.eq.weekly,last_run_at.is.null` : undefined,
      isMonday ? `schedule.eq.weekly,last_run_at.lt.${weeklyCutoff}` : undefined,
    ].filter(Boolean).join(","))
    .order("last_run_at", { ascending: true, nullsFirst: true })
    .limit(MAX_RULES_PER_RUN)
    .returns<RuleRow[]>();

  if (rulesErr) {
    console.error("[cron/ai/daily-jobs] rules query failed:", rulesErr.message);
    return NextResponse.json({ error: rulesErr.message }, { status: 500 });
  }

  if (!rules || rules.length === 0) {
    return NextResponse.json({ processed: 0, message: "No rules due to run." });
  }

  const outcomes: Array<{ ruleId: string; ok: boolean; error?: string }> = [];

  for (const rule of rules) {
    try {
      const result = await processRule({ rule, cfg, admin });
      outcomes.push({ ruleId: rule.id, ok: result.ok, error: result.error });

      // Update rule tracking
      await admin
        .from("ai_automation_rules")
        .update({
          last_run_at: new Date().toISOString(),
          run_count: rule.run_count + 1,
          next_run_at: rule.schedule === "daily"
            ? new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
            : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        })
        .eq("id", rule.id);

      // Notify the host
      if (result.ok && result.assetCount > 0) {
        await admin.from("host_notifications").insert({
          host_id: rule.host_id,
          type: "ai_assets_ready",
          title: `AI ${rule.rule_type.replace(/_/g, " ")} complete`,
          message: `${result.assetCount} new asset${result.assetCount !== 1 ? "s" : ""} ready in your AI Studio.`,
          metadata: { rule_id: rule.id, asset_count: result.assetCount },
        }).maybeSingle();
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      outcomes.push({ ruleId: rule.id, ok: false, error: msg });
      console.error(`[cron/ai/daily-jobs] rule ${rule.id} failed:`, msg);
    }
  }

  const duration = Date.now() - startedAt;
  const succeeded = outcomes.filter((o) => o.ok).length;

  console.log(`[cron/ai/daily-jobs] done — ${succeeded}/${rules.length} rules OK in ${duration}ms`);

  return NextResponse.json({
    processed: rules.length,
    succeeded,
    failed: rules.length - succeeded,
    duration_ms: duration,
    outcomes,
  });
}

// ─── Rule processor ───────────────────────────────────────────────────────

async function processRule(opts: {
  rule: { id: string; host_id: string; rule_type: string; label: string; config: Record<string, unknown>; schedule: string; run_count: number; last_run_at: string | null };
  cfg: Awaited<ReturnType<typeof getAiConfig>>;
  admin: ReturnType<typeof createAdminClient>;
}): Promise<{ ok: boolean; assetCount: number; error?: string }> {
  const { rule, cfg, admin } = opts;
  if (!cfg) return { ok: false, assetCount: 0, error: "AI config not found" };

  // Known rule types are handled by the shared processor
  const knownTypes = [
    "daily_content_ideas", "weekly_summary", "affiliate_campaign",
    "short_video_autopilot", "evergreen_repurpose",
  ];

  if (knownTypes.includes(rule.rule_type)) {
    return processAutomationRule(rule, admin, cfg);
  }

  // Unknown / god-mode rule — run full agentic chain
  const agentResult = await runAgentTask({
    hostId: rule.host_id,
    goal: {
      description: (rule.config.goal as string) ?? rule.rule_type,
      niche:        rule.config.niche        as string,
      platform:     rule.config.platform     as string,
      tone:         rule.config.tone         as string,
      productName:  rule.config.product_name as string,
    },
    ruleId:   rule.id,
    supabase: admin,
  });

  return {
    ok:         agentResult.ok,
    assetCount: agentResult.assetsCreated.length,
    error:      agentResult.error,
  };
}
