import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getEffectivePlan } from "@/lib/billing/entitlements";
import { featureEnabled } from "@/lib/billing/plans";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import Link from "next/link";
import { CircleDollarSign, Lock, ArrowRight, Tag, TrendingUp, Megaphone } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function AiMonetizePage() {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData?.user) redirect("/auth/login");

  const effective = await getEffectivePlan(supabase, userData.user.id);
  const isEntitled =
    effective.isPlatformAdmin || featureEnabled(effective.plan, "ai_monetization");

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
        <p className="mt-2 text-sm text-muted-foreground">
          AI-powered affiliate campaign copy, product launch packs, and revenue-focused
          content strategies — built around real products and real audiences.
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
  const features = [
    {
      icon: Tag,
      label: "Affiliate Campaign Generator",
      desc: "Input a product → get hooks, captions, email subjects, and CTAs instantly.",
    },
    {
      icon: Megaphone,
      label: "Product Launch Pack",
      desc: "Complete content pack for launching a product: teaser, launch day, follow-up.",
    },
    {
      icon: TrendingUp,
      label: "Revenue Tracking",
      desc: "Connect affiliate links, track clicks and conversions, surface top earners.",
    },
  ];

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-dashed border-border p-8 text-center">
        <CircleDollarSign className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
        <h2 className="text-base font-semibold">Monetization Hub — Phase 4</h2>
        <p className="mt-2 text-sm text-muted-foreground max-w-md mx-auto">
          Revenue-focused AI workflows are launching soon. In the meantime, you can
          use the AI Studio's Affiliate Campaign task to generate campaign copy today.
        </p>
        <Button asChild variant="outline" className="mt-4">
          <Link href="/ai">Try Affiliate Campaign in AI Studio →</Link>
        </Button>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        {features.map(({ icon: Icon, label, desc }) => (
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
      <h2 className="text-base font-semibold">Monetization Hub requires an upgrade</h2>
      <p className="text-sm text-muted-foreground max-w-sm">
        Your current plan (<strong>{planName}</strong>) doesn't include AI monetization tools.
        Upgrade to unlock affiliate campaigns and revenue-focused content automation.
      </p>
      <Button asChild>
        <Link href="https://live.isunday.me/host/settings">
          View upgrade options <ArrowRight className="ml-1.5 h-4 w-4" />
        </Link>
      </Button>
    </div>
  );
}
