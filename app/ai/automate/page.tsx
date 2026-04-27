import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getEffectivePlan } from "@/lib/billing/entitlements";
import { featureEnabled } from "@/lib/billing/plans";
import { ensureHostRow } from "@/lib/host/bootstrap";
import { Button } from "@/components/ui/button";
import { RulesManager } from "@/components/ai/automation/rules-manager";
import type { AutomationRule, RulesManagerStats } from "@/components/ai/automation/rules-manager";
import { Zap, Lock, ArrowRight, Info } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function AutomatePage() {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData?.user) redirect("/auth/login");

  const host = await ensureHostRow(supabase, userData.user);
  const effective = await getEffectivePlan(supabase, userData.user.id);
  const isEntitled =
    effective.isPlatformAdmin || featureEnabled(effective.plan, "ai_automation");

  if (!isEntitled) {
    return <UpgradeGate planName={effective.plan?.name ?? "Free"} />;
  }

  // Load existing rules server-side so there's no loading flash
  let initialRules: AutomationRule[] = [];
  let stats: RulesManagerStats = { assetsThisWeek: 0, runsThisWeek: 0 };

  if (host) {
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const [rulesRes, assetsRes, runsRes] = await Promise.all([
      supabase
        .from("ai_automation_rules")
        .select("id, rule_type, label, enabled, schedule, config, last_run_at, next_run_at, run_count, created_at")
        .eq("host_id", host.id)
        .order("created_at", { ascending: true }),
      supabase
        .from("ai_generated_assets")
        .select("id", { count: "exact", head: true })
        .eq("host_id", host.id)
        .gte("created_at", weekAgo)
        .contains("metadata", { auto: true }),
      supabase
        .from("ai_automation_rules")
        .select("id", { count: "exact", head: true })
        .eq("host_id", host.id)
        .gte("last_run_at", weekAgo),
    ]);

    initialRules = (rulesRes.data ?? []) as AutomationRule[];
    stats = {
      assetsThisWeek: assetsRes.count ?? 0,
      runsThisWeek:   runsRes.count  ?? 0,
    };
  }

  return (
    <main className="mx-auto max-w-3xl px-5 py-10 sm:px-8 sm:py-12">
      {/* Page header */}
      <header className="mb-8">
        <div className="mb-2 inline-flex items-center gap-1.5 rounded-full border border-violet-200 bg-violet-50 px-2.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-violet-700 dark:border-violet-800 dark:bg-violet-950 dark:text-violet-300">
          <Zap className="h-3 w-3" />
          Automation Engine
        </div>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
          Put your content on autopilot
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Set up recurring AI workflows — daily ideas, weekly summaries, and post-stream
          recaps run automatically in the background.
        </p>
      </header>

      {/* How it works banner */}
      <div className="mb-6 flex items-start gap-3 rounded-lg border border-blue-200/60 bg-blue-50/60 px-4 py-3 dark:border-blue-900/40 dark:bg-blue-950/20">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-blue-500" />
        <p className="text-xs text-blue-700 dark:text-blue-300 leading-relaxed">
          Rules run automatically each day at 07:00 UTC. Generated assets appear in{" "}
          <Link href="/ai" className="underline underline-offset-2">
            AI Studio
          </Link>{" "}
          and trigger a dashboard notification.
        </p>
      </div>

      {/* Live rules manager */}
      <RulesManager initialRules={initialRules} stats={stats} />
    </main>
  );
}

function UpgradeGate({ planName }: { planName: string }) {
  return (
    <main className="mx-auto max-w-3xl px-5 py-10 sm:px-8 sm:py-12">
      <header className="mb-8">
        <div className="mb-2 inline-flex items-center gap-1.5 rounded-full border border-violet-200 bg-violet-50 px-2.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-violet-700 dark:border-violet-800 dark:bg-violet-950 dark:text-violet-300">
          <Zap className="h-3 w-3" />
          Automation Engine
        </div>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
          Put your content on autopilot
        </h1>
      </header>
      <div className="flex flex-col items-center justify-center py-20 text-center gap-4">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
          <Lock className="h-6 w-6 text-primary" />
        </div>
        <h2 className="text-base font-semibold">Automation requires an upgrade</h2>
        <p className="text-sm text-muted-foreground max-w-sm">
          Your current plan (<strong>{planName}</strong>) doesn&apos;t include AI
          automation. Upgrade to unlock daily jobs, weekly summaries, and post-stream
          recaps.
        </p>
        <Button asChild>
          <Link href="https://live.isunday.me/host/settings">
            View upgrade options <ArrowRight className="ml-1.5 h-4 w-4" />
          </Link>
        </Button>
      </div>
    </main>
  );
}
