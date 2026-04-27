import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getEffectivePlan } from "@/lib/billing/entitlements";
import { featureEnabled } from "@/lib/billing/plans";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import Link from "next/link";
import { Zap, Lock, CalendarClock, ListChecks, BarChart2, ArrowRight } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function AutomatePage() {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData?.user) redirect("/auth/login");

  const effective = await getEffectivePlan(supabase, userData.user.id);
  const isEntitled =
    effective.isPlatformAdmin || featureEnabled(effective.plan, "ai_automation");

  return (
    <main className="mx-auto max-w-5xl px-5 py-10 sm:px-8 sm:py-12">
      <header className="mb-8">
        <div className="mb-2 inline-flex items-center gap-1.5 rounded-full border border-violet-200 bg-violet-50 px-2.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-violet-700 dark:border-violet-800 dark:bg-violet-950 dark:text-violet-300">
          <Zap className="h-3 w-3" />
          Automation Engine
        </div>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
          Put your content on autopilot
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Set up recurring AI tasks — daily content ideas, weekly performance summaries,
          and post-stream recaps delivered automatically.
        </p>
      </header>

      {isEntitled ? (
        <ComingSoon />
      ) : (
        <UpgradeGate planName={effective.plan?.name ?? "Free"} />
      )}
    </main>
  );
}

function ComingSoon() {
  const upcoming = [
    {
      icon: CalendarClock,
      label: "Daily Content Ideas",
      desc: "5 fresh ideas in your niche, every morning.",
    },
    {
      icon: BarChart2,
      label: "Weekly Performance Summary",
      desc: "AI narrative of last 7 days — viewers, growth, top stream.",
    },
    {
      icon: ListChecks,
      label: "Post-Stream Recap",
      desc: "Auto-generated recap and content repurposing plan after each live.",
    },
  ];

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-dashed border-border p-8 text-center">
        <Zap className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
        <h2 className="text-base font-semibold">Automation Engine — Phase 2</h2>
        <p className="mt-2 text-sm text-muted-foreground max-w-md mx-auto">
          Recurring AI workflows are launching soon. Your plan includes this feature —
          you'll be notified the moment it's live.
        </p>
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
    <div className="flex flex-col items-center justify-center py-20 text-center gap-4">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
        <Lock className="h-6 w-6 text-primary" />
      </div>
      <h2 className="text-base font-semibold">Automation requires an upgrade</h2>
      <p className="text-sm text-muted-foreground max-w-sm">
        Your current plan (<strong>{planName}</strong>) doesn't include AI automation.
        Upgrade to unlock daily jobs, weekly summaries, and post-stream recaps.
      </p>
      <Button asChild>
        <Link href="https://live.isunday.me/host/settings">
          View upgrade options <ArrowRight className="ml-1.5 h-4 w-4" />
        </Link>
      </Button>
    </div>
  );
}
