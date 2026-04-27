import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getEffectivePlan } from "@/lib/billing/entitlements";
import { featureEnabled } from "@/lib/billing/plans";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import Link from "next/link";
import { Send, Lock, ArrowRight, Youtube, Instagram, Twitter } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function PublishPage() {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData?.user) redirect("/auth/login");

  const effective = await getEffectivePlan(supabase, userData.user.id);
  const isEntitled =
    effective.isPlatformAdmin || featureEnabled(effective.plan, "ai_publishing");

  return (
    <main className="mx-auto max-w-5xl px-5 py-10 sm:px-8 sm:py-12">
      <header className="mb-8">
        <div className="mb-2 inline-flex items-center gap-1.5 rounded-full border border-sky-200 bg-sky-50 px-2.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-sky-700 dark:border-sky-800 dark:bg-sky-950 dark:text-sky-300">
          <Send className="h-3 w-3" />
          Publishing Hub
        </div>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
          Distribute content across every platform
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Connect your social accounts and publish or schedule AI-generated content
          to YouTube, TikTok, Instagram, and more from one place.
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
  const platforms = [
    { icon: Youtube, label: "YouTube", desc: "Upload clips, schedule posts, manage descriptions." },
    { icon: Instagram, label: "Instagram / Reels", desc: "Post captions, carousels, and short videos." },
    { icon: Twitter, label: "Twitter / X", desc: "Thread drafts, scheduled tweets, engagement tracking." },
  ];

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-dashed border-border p-8 text-center">
        <Send className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
        <h2 className="text-base font-semibold">Publishing Hub — Phase 3</h2>
        <p className="mt-2 text-sm text-muted-foreground max-w-md mx-auto">
          Social platform OAuth connections are launching soon. YouTube is already
          connected via the Studio Distribution Hub — AI-powered scheduling is next.
        </p>
        <Button asChild variant="outline" className="mt-4">
          <Link href="https://studio.isunday.me/distribution">
            Connect YouTube in Studio →
          </Link>
        </Button>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        {platforms.map(({ icon: Icon, label, desc }) => (
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
      <h2 className="text-base font-semibold">Publishing Hub requires an upgrade</h2>
      <p className="text-sm text-muted-foreground max-w-sm">
        Your current plan (<strong>{planName}</strong>) doesn't include AI publishing.
        Upgrade to unlock cross-platform scheduling and social automation.
      </p>
      <Button asChild>
        <Link href="https://live.isunday.me/host/settings">
          View upgrade options <ArrowRight className="ml-1.5 h-4 w-4" />
        </Link>
      </Button>
    </div>
  );
}
