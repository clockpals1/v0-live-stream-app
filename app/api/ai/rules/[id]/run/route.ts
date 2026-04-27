import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAiConfig } from "@/lib/ai/config";
import { processAutomationRule } from "@/lib/ai/automation-jobs";

/**
 * POST /api/ai/rules/[id]/run
 *
 * Manually triggers a single automation rule immediately ("Run now").
 * Runs the same logic as the cron, updates tracking fields, and
 * creates a host notification identical to the scheduled run.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const supabase = await createClient();
  const { data: { user }, error: authErr } = await supabase.auth.getUser();
  if (authErr || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: host } = await supabase
    .from("hosts").select("id").eq("user_id", user.id).single();
  if (!host) return NextResponse.json({ error: "Host not found" }, { status: 404 });

  const { data: rule } = await supabase
    .from("ai_automation_rules")
    .select("id, host_id, rule_type, label, schedule, config, last_run_at, run_count")
    .eq("id", id)
    .eq("host_id", host.id)
    .single();
  if (!rule) return NextResponse.json({ error: "Rule not found" }, { status: 404 });

  const admin = createAdminClient();
  const cfg = await getAiConfig(admin);
  if (!cfg) {
    return NextResponse.json(
      { error: "AI is not configured — ask your admin to set an API key in AI Settings." },
      { status: 503 },
    );
  }

  const result = await processAutomationRule(
    rule as Parameters<typeof processAutomationRule>[0],
    admin,
    cfg,
  );

  if (!result.ok) {
    return NextResponse.json({ error: result.error ?? "Rule execution failed" }, { status: 500 });
  }

  // Update run tracking
  const nextRunOffset = rule.schedule === "daily"
    ? 24 * 60 * 60 * 1000
    : 7 * 24 * 60 * 60 * 1000;

  await admin.from("ai_automation_rules").update({
    last_run_at: new Date().toISOString(),
    run_count:   (rule.run_count ?? 0) + 1,
    next_run_at: new Date(Date.now() + nextRunOffset).toISOString(),
  }).eq("id", id);

  // Notify host
  if (result.assetCount > 0) {
    await admin.from("host_notifications").insert({
      host_id: host.id,
      type:    "ai_assets_ready",
      title:   `${rule.label} — manual run complete`,
      message: `${result.assetCount} new asset${result.assetCount !== 1 ? "s" : ""} ready in your AI Studio.`,
      metadata: { rule_id: id, asset_count: result.assetCount, manual: true },
    }).maybeSingle();
  }

  return NextResponse.json({
    ok:         true,
    assetCount: result.assetCount,
    last_run_at: new Date().toISOString(),
    run_count:  (rule.run_count ?? 0) + 1,
  });
}
