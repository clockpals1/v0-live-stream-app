import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getEffectivePlan } from "@/lib/billing/entitlements";
import { featureEnabled } from "@/lib/billing/plans";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import Link from "next/link";
import { BarChart2, Lock, ArrowRight, TrendingUp, MessageSquare, Users } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function AiInsightsPage() {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData?.user) redirect("/auth/login");

  const effective = await getEffectivePlan(supabase, userData.user.id);
  const isEntitled =
    effective.isPlatformAdmin || featureEnabled(effective.plan, "ai_insights");

  const admin = createAdminClient();
  const { data: host } = await admin
    .from("hosts")
    .select("id")
    .eq("user_id", userData.user.id)
    .maybeSingle();

  // Quick stats from existing tables — no new queries needed
  const hostId = host?.id ?? "";
  const [streamsRes, archivesRes, subscribersRes] = await Promise.all([
    admin
      .from("streams")
      .select("id", { count: "exact", head: true })
      .eq("host_id", hostId),
    admin
      .from("stream_archives")
      .select("id", { count: "exact", head: true })
      .eq("host_id", hostId)
      .eq("status", "ready"),
    admin
      .from("host_subscribers")
      .select("id", { count: "exact", head: true })
      .eq("host_id", hostId),
  ]);

  const stats = {
    streams: streamsRes.count ?? 0,
    archives: archivesRes.count ?? 0,
    subscribers: subscribersRes.count ?? 0,
  };

  return (
    <main className="mx-auto max-w-5xl px-5 py-10 sm:px-8 sm:py-12">
      <header className="mb-8">
        <div className="mb-2 inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
          <BarChart2 className="h-3 w-3" />
          AI Insights
        </div>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
          Understand your performance, deeply
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          AI-enhanced analytics: content themes from chat, top-performing stream patterns,
          subscriber growth signals, and actionable recommendations.
        </p>
      </header>

      {/* Platform stats — always visible */}
      <div className="mb-8 grid grid-cols-3 gap-3">
        <StatCard label="Total streams" value={stats.streams} icon={TrendingUp} />
        <StatCard label="Saved archives" value={stats.archives} icon={BarChart2} />
        <StatCard label="Subscribers" value={stats.subscribers} icon={Users} />
      </div>

      {isEntitled ? (
        <ComingSoon />
      ) : (
        <UpgradeGate planName={effective.plan?.name ?? "Free"} />
      )}
    </main>
  );
}

function StatCard({ label, value, icon: Icon }: { label: string; value: number; icon: React.ComponentType<{ className?: string }> }) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 px-4 py-3">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10">
          <Icon className="h-4 w-4 text-primary" />
        </div>
        <div>
          <div className="text-xl font-semibold tabular-nums">{value.toLocaleString()}</div>
          <div className="text-[11px] text-muted-foreground">{label}</div>
        </div>
      </CardContent>
    </Card>
  );
}

function ComingSoon() {
  const upcoming = [
    {
      icon: MessageSquare,
      label: "Chat Theme Extraction",
      desc: "AI reads your chat history and surfaces the topics your audience engages with most.",
    },
    {
      icon: TrendingUp,
      label: "Content Performance Patterns",
      desc: "Which stream topics drive the most viewers, replay watches, and subscribers.",
    },
    {
      icon: Users,
      label: "Growth Narrative",
      desc: "Weekly AI narrative explaining your subscriber and viewer trends in plain language.",
    },
  ];

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-dashed border-border p-8 text-center">
        <BarChart2 className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
        <h2 className="text-base font-semibold">AI Insights — Phase 5</h2>
        <p className="mt-2 text-sm text-muted-foreground max-w-md mx-auto">
          Deep analytics with AI narratives are launching soon. You can view current
          stream analytics in the Studio Insights page today.
        </p>
        <Button asChild variant="outline" className="mt-4">
          <Link href="https://studio.isunday.me/insights">View Studio Insights →</Link>
        </Button>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        {upcoming.map(({ icon: Icon, label, desc }) => (
          <Card key={label} className="border-dashed">
            <CardContent className="p-4">
              <Icon className="mb-2 h-5 w-5 text-muted-foreground" />
              <div className="text-sm font-medium">{label}</div>
              <div className="mt-1 text-xs text-muted-foreground">{desc}</div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

function UpgradeGate({ planName }: { planName: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center gap-4">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
        <Lock className="h-6 w-6 text-primary" />
      </div>
      <h2 className="text-base font-semibold">AI Insights requires an upgrade</h2>
      <p className="text-sm text-muted-foreground max-w-sm">
        Your current plan (<strong>{planName}</strong>) doesn't include AI-enhanced analytics.
        Upgrade to unlock content theme extraction, growth narratives, and performance patterns.
      </p>
      <Button asChild>
        <Link href="https://live.isunday.me/host/settings">
          View upgrade options <ArrowRight className="ml-1.5 h-4 w-4" />
        </Link>
      </Button>
    </div>
  );
}
