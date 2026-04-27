import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getEffectivePlan } from "@/lib/billing/entitlements";
import { featureEnabled } from "@/lib/billing/plans";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Film,
  Share2,
  Users,
  CircleDollarSign,
  ArrowRight,
  Sparkles,
} from "lucide-react";

/**
 * Studio overview — what the host sees the moment they land on
 * studio.isunday.me. We aim for a creator-feeling welcome rather than
 * an admin-dashboard wall of charts.
 *
 * Three blocks:
 *   1. Hero with their name + a short product framing.
 *   2. Four module tiles (Replay, Distribution, Audience, Monetize).
 *      Each tile shows whether the feature is unlocked, with a CTA
 *      that either takes them to the module or surfaces an upgrade
 *      hint.
 *   3. Quick stats row (archives, published replays, plan).
 *
 * Server-rendered for fast first paint. No client effects on this
 * page — every counter we need is one Supabase query away.
 */
export default async function StudioOverviewPage() {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  const user = userData?.user!;

  const { data: host } = await supabase
    .from("hosts")
    .select("id, display_name, email")
    .eq("user_id", user.id)
    .single();

  const effective = await getEffectivePlan(supabase, user.id);
  const plan = effective.plan;

  // Counts. Each wrapped individually so the page still renders if a
  // table is missing (e.g. migration 025 not applied yet — replay_
  // publications won't exist on first deploy). The cost of a failed
  // query is tiny; the cost of a 500 on the studio landing is large.
  const [archiveCount, publishedCount] = await Promise.all([
    supabase
      .from("stream_archives")
      .select("id", { count: "exact", head: true })
      .eq("host_id", host?.id ?? "")
      .then((r) => r.count ?? 0)
      .catch(() => 0),
    supabase
      .from("replay_publications")
      .select("id", { count: "exact", head: true })
      .eq("host_id", host?.id ?? "")
      .eq("is_published", true)
      .then((r) => r.count ?? 0)
      .catch(() => 0),
  ]);

  const tiles = [
    {
      href: "/studio/replay",
      title: "Replay Library",
      blurb:
        "Curate your recordings. Add titles, thumbnails, and publish them as social replays.",
      icon: Film,
      tone: "violet" as const,
      gated: !featureEnabled(plan, "replay_publishing"),
    },
    {
      href: "/studio/distribution",
      title: "Distribution Hub",
      blurb:
        "Send replays to YouTube, generate exports, manage where your content lives.",
      icon: Share2,
      tone: "sky" as const,
      gated: !featureEnabled(plan, "distribution_export"),
    },
    {
      href: "/studio/audience",
      title: "Audience CRM",
      blurb:
        "Subscriber lists, segments, engagement history — your audience in one place.",
      icon: Users,
      tone: "emerald" as const,
      gated: !featureEnabled(plan, "audience_crm"),
    },
    {
      href: "/studio/monetize",
      title: "Monetization",
      blurb:
        "Earnings, paywalls, premium replays. Turn engagement into revenue.",
      icon: CircleDollarSign,
      tone: "amber" as const,
      gated: !featureEnabled(plan, "monetization_basic"),
    },
  ];

  return (
    <main className="mx-auto max-w-5xl px-5 py-10 sm:px-8 sm:py-14">
      {/* ─── hero ────────────────────────────────────────────────────── */}
      <div className="mb-10 flex items-start justify-between gap-6">
        <div>
          <div className="mb-1.5 inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/50 px-2.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            <Sparkles className="h-3 w-3" />
            Studio · creator workspace
          </div>
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
            Welcome back, {host?.display_name?.split(" ")[0] || "creator"}.
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground sm:text-base">
            Your replays, audience, and monetization in one place. Built on
            top of the live platform — same account, same data, more reach.
          </p>
        </div>
      </div>

      {/* ─── stats row ───────────────────────────────────────────────── */}
      <div className="mb-10 grid grid-cols-3 gap-3 sm:gap-4">
        <StatCard label="Archived streams" value={String(archiveCount ?? 0)} />
        <StatCard
          label="Published replays"
          value={String(publishedCount ?? 0)}
        />
        <StatCard
          label="Plan"
          value={effective.isPlatformAdmin ? "Admin" : plan?.name ?? "Free"}
          accent
        />
      </div>

      {/* ─── module tiles ────────────────────────────────────────────── */}
      <div className="grid gap-4 sm:grid-cols-2">
        {tiles.map((tile) => (
          <ModuleTile key={tile.href} {...tile} />
        ))}
      </div>
    </main>
  );
}

function StatCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <Card className={accent ? "border-primary/30" : undefined}>
      <CardContent className="px-4 py-3">
        <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          {label}
        </div>
        <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
      </CardContent>
    </Card>
  );
}

const TONE_CLASSES: Record<
  "violet" | "sky" | "emerald" | "amber",
  { bg: string; ring: string; text: string }
> = {
  violet: {
    bg: "from-violet-500/15 to-indigo-500/5",
    ring: "ring-violet-500/20",
    text: "text-violet-700 dark:text-violet-300",
  },
  sky: {
    bg: "from-sky-500/15 to-cyan-500/5",
    ring: "ring-sky-500/20",
    text: "text-sky-700 dark:text-sky-300",
  },
  emerald: {
    bg: "from-emerald-500/15 to-teal-500/5",
    ring: "ring-emerald-500/20",
    text: "text-emerald-700 dark:text-emerald-300",
  },
  amber: {
    bg: "from-amber-500/15 to-orange-500/5",
    ring: "ring-amber-500/20",
    text: "text-amber-700 dark:text-amber-300",
  },
};

function ModuleTile({
  href,
  title,
  blurb,
  icon: Icon,
  tone,
  gated,
}: {
  href: string;
  title: string;
  blurb: string;
  icon: React.ComponentType<{ className?: string }>;
  tone: keyof typeof TONE_CLASSES;
  gated: boolean;
}) {
  const t = TONE_CLASSES[tone];
  return (
    <Card
      className={`relative overflow-hidden bg-gradient-to-br ${t.bg} ring-1 ${t.ring}`}
    >
      <CardContent className="flex h-full flex-col gap-3 p-5">
        <div className="flex items-start justify-between gap-3">
          <div
            className={`flex h-9 w-9 items-center justify-center rounded-lg bg-background/70 backdrop-blur ${t.text}`}
          >
            <Icon className="h-4 w-4" />
          </div>
          {gated && (
            <Badge
              variant="outline"
              className="h-5 px-1.5 text-[10px] font-normal text-muted-foreground"
            >
              Upgrade
            </Badge>
          )}
        </div>
        <div className="flex-1">
          <h3 className="text-base font-semibold tracking-tight">{title}</h3>
          <p className="mt-1 text-xs text-muted-foreground">{blurb}</p>
        </div>
        <div className="flex items-center justify-between">
          <Button asChild size="sm" variant={gated ? "outline" : "default"}>
            <Link href={href}>
              {gated ? "Preview" : "Open"}
              <ArrowRight className="ml-1 h-3 w-3" />
            </Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
