import type React from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getEffectivePlan } from "@/lib/billing/entitlements";
import { featureEnabled } from "@/lib/billing/plans";
import { ensureHostRow } from "@/lib/host/bootstrap";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import {
  CircleDollarSign,
  Lock,
  ArrowRight,
  Tag,
  TrendingUp,
  Megaphone,
  Zap,
  CheckCircle2,
  ChevronRight,
  BarChart3,
  Mail,
  MousePointerClick,
  FileText,
  Layers,
  Target,
  Clock,
  Sparkles,
} from "lucide-react";

export const dynamic = "force-dynamic";

type CampaignAsset = {
  id: string;
  title: string | null;
  content: string;
  created_at: string;
  metadata: Record<string, unknown>;
};

export default async function AiMonetizePage() {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData?.user) redirect("/auth/login");

  const host = await ensureHostRow(supabase, userData.user);
  const effective = await getEffectivePlan(supabase, userData.user.id);
  const isEntitled =
    effective.isPlatformAdmin || featureEnabled(effective.plan, "ai_monetization");

  if (!isEntitled) {
    return <UpgradeGate planName={effective.plan?.name ?? "Free"} />;
  }

  // Load real data to make the page feel alive
  let recentCampaigns: CampaignAsset[] = [];
  let hasAffiliateAutopilot = false;

  if (host) {
    const [campaignsRes, autopilotRes] = await Promise.all([
      supabase
        .from("ai_generated_assets")
        .select("id, title, content, created_at, metadata")
        .eq("host_id", host.id)
        .eq("asset_type", "campaign_copy")
        .is("archived_at", null)
        .order("created_at", { ascending: false })
        .limit(3),
      supabase
        .from("ai_automation_rules")
        .select("id", { count: "exact", head: true })
        .eq("host_id", host.id)
        .eq("rule_type", "affiliate_campaign")
        .eq("enabled", true),
    ]);

    recentCampaigns = (campaignsRes.data ?? []) as CampaignAsset[];
    hasAffiliateAutopilot = (autopilotRes.count ?? 0) > 0;
  }

  return (
    <main className="mx-auto max-w-5xl px-5 py-10 sm:px-8 sm:py-12">
      {/* ── Page header ─────────────────────────────────────────────── */}
      <header className="mb-10">
        <div className="mb-2 inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-amber-700 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300">
          <CircleDollarSign className="h-3 w-3" />
          Monetization Hub
        </div>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
          Turn content into revenue
        </h1>
        <p className="mt-2 max-w-xl text-sm text-muted-foreground">
          AI-powered affiliate campaigns, product launch packs, and revenue-focused
          content strategies — built around real products and real audiences.
        </p>
      </header>

      <div className="space-y-10">

        {/* ── Section 1: Active now ──────────────────────────────────── */}
        <section>
          <SectionLabel icon={CheckCircle2} label="Available now" color="text-emerald-600" />

          {/* Affiliate Campaign Generator — primary live feature */}
          <Card className="mt-3 overflow-hidden border-amber-200/60 bg-gradient-to-br from-amber-50/50 to-background dark:border-amber-900/40 dark:from-amber-950/20">
            <CardContent className="p-6 sm:p-8">
              <div className="flex flex-col gap-6 sm:flex-row sm:items-start sm:gap-8">
                {/* Left: feature info */}
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2 mb-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-amber-500/10">
                      <Tag className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-base font-semibold">Affiliate Campaign Generator</span>
                        <Badge className="bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-0 text-[10px] h-4 px-1.5">
                          Live
                        </Badge>
                      </div>
                    </div>
                  </div>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    Input any product — get a complete, ready-to-deploy affiliate campaign.
                    Structured copy for every channel your audience lives on.
                  </p>

                  {/* Output types */}
                  <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {[
                      { icon: Sparkles, label: "Hook lines" },
                      { icon: FileText, label: "Social captions" },
                      { icon: Mail, label: "Email subjects" },
                      { icon: Target, label: "CTAs" },
                    ].map(({ icon: Icon, label }) => (
                      <div
                        key={label}
                        className="flex items-center gap-1.5 rounded-md border border-border/60 bg-background/70 px-2.5 py-1.5 text-[11px] text-muted-foreground"
                      >
                        <Icon className="h-3 w-3 shrink-0 text-amber-500" />
                        {label}
                      </div>
                    ))}
                  </div>

                  <div className="mt-5 flex flex-wrap gap-2">
                    <Button asChild size="sm" className="gap-1.5 bg-amber-600 hover:bg-amber-700 text-white dark:bg-amber-500 dark:hover:bg-amber-600">
                      <Link href="/ai">
                        Generate campaign copy
                        <ChevronRight className="h-3.5 w-3.5" />
                      </Link>
                    </Button>
                    <Button asChild size="sm" variant="outline" className="gap-1.5">
                      <Link href="/ai/automate">
                        <Zap className="h-3.5 w-3.5" />
                        Set up autopilot
                      </Link>
                    </Button>
                  </div>
                </div>

                {/* Right: step guide */}
                <div className="shrink-0 sm:w-56">
                  <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground mb-2">
                    How it works
                  </p>
                  {[
                    "Open AI Studio → select Affiliate Campaign",
                    "Enter product name, niche, and tone",
                    "Get campaign copy in seconds",
                    "Publish or schedule via Publishing Hub",
                  ].map((step, i) => (
                    <div key={i} className="flex items-start gap-2 mb-2 last:mb-0">
                      <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-amber-100 text-[9px] font-bold text-amber-700 dark:bg-amber-900/40 dark:text-amber-400">
                        {i + 1}
                      </span>
                      <p className="text-[11px] text-muted-foreground leading-snug">{step}</p>
                    </div>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Recent campaigns */}
          {recentCampaigns.length > 0 ? (
            <div className="mt-4">
              <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                Your recent campaigns
              </p>
              <div className="space-y-2">
                {recentCampaigns.map((asset) => (
                  <div
                    key={asset.id}
                    className="flex items-center justify-between rounded-lg border border-border/60 bg-muted/20 px-4 py-3 gap-3"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <Tag className="h-3.5 w-3.5 shrink-0 text-amber-500" />
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">
                          {asset.title ?? "Campaign copy"}
                        </p>
                        <p className="text-[11px] text-muted-foreground">
                          {formatDistanceToNow(new Date(asset.created_at), { addSuffix: true })}
                          {asset.metadata?.auto && (
                            <span className="ml-1.5 inline-flex items-center gap-0.5 text-violet-500">
                              <Zap className="h-2.5 w-2.5" /> auto
                            </span>
                          )}
                        </p>
                      </div>
                    </div>
                    <Button asChild size="sm" variant="ghost" className="h-7 px-2 text-xs shrink-0">
                      <Link href="/ai">View in Studio</Link>
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="mt-4 flex items-center gap-3 rounded-lg border border-dashed border-border px-4 py-3.5">
              <Sparkles className="h-4 w-4 shrink-0 text-muted-foreground" />
              <p className="text-[12px] text-muted-foreground">
                No campaigns yet.{" "}
                <Link href="/ai" className="font-medium text-foreground underline underline-offset-2">
                  Generate your first affiliate campaign
                </Link>{" "}
                in AI Studio.
              </p>
            </div>
          )}

          {/* Autopilot status */}
          <div className={`mt-4 flex items-center justify-between rounded-lg border px-4 py-3 gap-3 ${
            hasAffiliateAutopilot
              ? "border-violet-200/60 bg-violet-50/40 dark:border-violet-900/40 dark:bg-violet-950/20"
              : "border-border/60 bg-muted/20"
          }`}>
            <div className="flex items-center gap-2.5 min-w-0">
              <Zap className={`h-4 w-4 shrink-0 ${hasAffiliateAutopilot ? "text-violet-500" : "text-muted-foreground"}`} />
              <div>
                <p className="text-sm font-medium">
                  {hasAffiliateAutopilot ? "Affiliate autopilot is active" : "Automate your campaigns"}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  {hasAffiliateAutopilot
                    ? "New campaign copy is generated automatically each week."
                    : "Set up a weekly automation rule to generate campaign copy on schedule."}
                </p>
              </div>
            </div>
            <Button asChild size="sm" variant={hasAffiliateAutopilot ? "outline" : "default"} className="h-7 px-3 text-xs shrink-0">
              <Link href="/ai/automate">
                {hasAffiliateAutopilot ? "Manage" : "Set up autopilot"}
              </Link>
            </Button>
          </div>
        </section>

        {/* ── Section 2: Launching next ─────────────────────────────── */}
        <section>
          <SectionLabel icon={Clock} label="Launching next" color="text-muted-foreground" />

          <div className="mt-3 grid gap-4 sm:grid-cols-2">

            {/* Product Launch Pack */}
            <Card className="border-border/60">
              <CardContent className="p-5">
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-violet-500/10">
                    <Megaphone className="h-4 w-4 text-violet-500" />
                  </div>
                  <Badge variant="secondary" className="text-[10px] h-5 px-2 font-normal">
                    Coming soon
                  </Badge>
                </div>
                <h3 className="text-sm font-semibold">Product Launch Pack</h3>
                <p className="mt-1 text-[12px] text-muted-foreground leading-relaxed">
                  A structured content system for launching any product — from first tease
                  to post-launch follow-up, across every channel.
                </p>
                <div className="mt-4 space-y-1.5">
                  {[
                    { icon: Layers, text: "Teaser content (pre-launch buzz)" },
                    { icon: Megaphone, text: "Launch-day announcement copy" },
                    { icon: Mail, text: "Email sequence — tease, launch, follow-up" },
                    { icon: FileText, text: "Channel-native assets per platform" },
                  ].map(({ icon: Icon, text }) => (
                    <div key={text} className="flex items-start gap-2 text-[11px] text-muted-foreground">
                      <Icon className="mt-0.5 h-3 w-3 shrink-0 text-violet-400" />
                      {text}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* Revenue Tracking */}
            <Card className="border-border/60">
              <CardContent className="p-5">
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-500/10">
                    <BarChart3 className="h-4 w-4 text-emerald-500" />
                  </div>
                  <Badge variant="secondary" className="text-[10px] h-5 px-2 font-normal">
                    Coming soon
                  </Badge>
                </div>
                <h3 className="text-sm font-semibold">Revenue Tracking</h3>
                <p className="mt-1 text-[12px] text-muted-foreground leading-relaxed">
                  The analytics layer for your monetization strategy — see exactly which
                  content drives clicks, conversions, and affiliate revenue.
                </p>
                <div className="mt-4 space-y-1.5">
                  {[
                    { icon: MousePointerClick, text: "Affiliate link click tracking" },
                    { icon: TrendingUp, text: "Conversion attribution per campaign" },
                    { icon: BarChart3, text: "Top-earning content surface" },
                    { icon: Target, text: "Revenue-per-audience segment" },
                  ].map(({ icon: Icon, text }) => (
                    <div key={text} className="flex items-start gap-2 text-[11px] text-muted-foreground">
                      <Icon className="mt-0.5 h-3 w-3 shrink-0 text-emerald-400" />
                      {text}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        </section>

        {/* ── Strategy tip ──────────────────────────────────────────── */}
        <div className="rounded-xl border border-amber-200/50 bg-amber-50/30 px-5 py-4 dark:border-amber-900/30 dark:bg-amber-950/10">
          <div className="flex items-start gap-3">
            <CircleDollarSign className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
            <div>
              <p className="text-sm font-medium text-amber-900 dark:text-amber-200">
                Revenue strategy tip
              </p>
              <p className="mt-0.5 text-[12px] text-amber-800/80 dark:text-amber-300/70 leading-relaxed">
                The highest-converting affiliate campaigns start with specific audiences, not
                generic products. Use the Affiliate Campaign Generator with your niche and
                tone settings for copy that actually converts — then automate it weekly so
                every product in your stack stays active.
              </p>
            </div>
          </div>
        </div>

      </div>
    </main>
  );
}

// ── Shared sub-components ──────────────────────────────────────────────────

function SectionLabel({
  icon: Icon,
  label,
  color,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  color: string;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <Icon className={`h-3.5 w-3.5 ${color}`} />
      <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
    </div>
  );
}

function UpgradeGate({ planName }: { planName: string }) {
  return (
    <main className="mx-auto max-w-5xl px-5 py-10 sm:px-8 sm:py-12">
      <header className="mb-8">
        <div className="mb-2 inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-amber-700 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300">
          <CircleDollarSign className="h-3 w-3" />
          Monetization Hub
        </div>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
          Turn content into revenue
        </h1>
      </header>
      <div className="flex flex-col items-center justify-center py-20 text-center gap-4">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
          <Lock className="h-6 w-6 text-primary" />
        </div>
        <h2 className="text-base font-semibold">Monetization Hub requires an upgrade</h2>
        <p className="text-sm text-muted-foreground max-w-sm">
          Your current plan (<strong>{planName}</strong>) doesn&apos;t include AI monetization
          tools. Upgrade to unlock affiliate campaigns and revenue-focused content automation.
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
