import Link from "next/link";
import { isNextControlFlowSignal } from "@/lib/next/control-flow";
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
  Radio,
  CalendarClock,
  CircleDot,
  Zap,
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
  try {
    return await renderStudioOverview();
  } catch (err) {
    if (isNextControlFlowSignal(err)) {
      throw err;
    }
    const e = err as Error;
    console.error(
      "[studio/page] uncaught render error:",
      JSON.stringify({
        name: e?.name,
        message: e?.message,
        stack: e?.stack,
      }),
    );
    return (
      <main className="mx-auto max-w-3xl px-5 py-14 sm:px-8">
        <h1 className="text-lg font-semibold">Studio is having trouble</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {e?.message || "Unknown error"}
        </p>
      </main>
    );
  }
}

async function renderStudioOverview() {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  const user = userData?.user;
  if (!user) return null;

  const { data: host } = await supabase
    .from("hosts")
    .select("id, display_name, email")
    .eq("user_id", user.id)
    .maybeSingle();

  const effective = await getEffectivePlan(supabase, user.id);
  const plan = effective.plan;

  // Counts. Each wrapped individually so the page still renders if a
  // table is missing (e.g. migration 025 not applied yet — replay_
  // publications won't exist on first deploy). Supabase's PostgrestBuilder
  // is PromiseLike, not Promise, so we can't .catch() it directly —
  // wrap in async helpers instead.
  const hostId = host?.id ?? "";
  const safeArchiveCount = async () => {
    try {
      const { count } = await supabase
        .from("stream_archives")
        .select("id", { count: "exact", head: true })
        .eq("host_id", hostId);
      return count ?? 0;
    } catch (err) {
      console.warn("[studio/page] archive count failed:", err);
      return 0;
    }
  };
  const safePublishedCount = async () => {
    try {
      const { count } = await supabase
        .from("replay_publications")
        .select("id", { count: "exact", head: true })
        .eq("host_id", hostId)
        .eq("is_published", true);
      return count ?? 0;
    } catch (err) {
      console.warn("[studio/page] published count failed:", err);
      return 0;
    }
  };
  const safeLatestStream = async () => {
    try {
      const { data } = await supabase
        .from("streams")
        .select("id, title, status, room_code, scheduled_at, created_at")
        .eq("host_id", hostId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle<{
          id: string;
          title: string;
          status: string;
          room_code: string;
          scheduled_at: string | null;
          created_at: string;
        }>();
      return data ?? null;
    } catch (err) {
      console.warn("[studio/page] latest stream lookup failed:", err);
      return null;
    }
  };
  const [archiveCount, publishedCount, latestStream] = await Promise.all([
    safeArchiveCount(),
    safePublishedCount(),
    safeLatestStream(),
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

      {/* ─── live stream bridge ─────────────────────────────────────── */}
      <LiveStatusCard latestStream={latestStream} />

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

      {/* ─── AI Hub discovery strip ──────────────────────────────────── */}
      <div className="mt-8 rounded-xl border border-violet-200/60 bg-gradient-to-r from-violet-500/5 to-fuchsia-500/5 p-5 dark:border-violet-800/30">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-violet-600 to-fuchsia-500 text-white">
              <Zap className="h-4 w-4" />
            </div>
            <div>
              <h3 className="text-base font-semibold">AI Automation Hub</h3>
              <p className="mt-0.5 max-w-lg text-xs text-muted-foreground">
                Turn your streams into content — generate scripts, captions,
                thumbnails, social posts, and affiliate campaigns, then
                schedule them across platforms automatically.
              </p>
            </div>
          </div>
          <a
            href="https://ai.isunday.me"
            className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-violet-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-violet-700"
          >
            Open AI Hub
            <ArrowRight className="h-3.5 w-3.5" />
          </a>
        </div>
        <div className="mt-4 grid gap-2 sm:grid-cols-3">
          {([
            { label: "AI Studio", desc: "Scripts, captions, and titles from your content" },
            { label: "Automation", desc: "Daily ideas and weekly summaries on autopilot" },
            { label: "Publishing Hub", desc: "Schedule posts across YouTube, TikTok, Instagram" },
          ] as const).map(({ label, desc }) => (
            <div key={label} className="rounded-lg bg-background/60 px-3 py-2.5">
              <div className="text-[11px] font-semibold text-violet-700 dark:text-violet-400">{label}</div>
              <div className="mt-0.5 text-[10px] text-muted-foreground">{desc}</div>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}

/**
 * Live status bridge — the studio → live counterpart of the Creator
 * Workspace strip on the live dashboard. Always visible so the host
 * remembers the live surface exists, with copy that adapts to whether
 * they're currently live, have a stream scheduled, or are idle.
 *
 * The "Go to live dashboard" CTA is a plain anchor (different host).
 * Auth cookies are shared at .isunday.me so no re-login is required.
 */
function LiveStatusCard({
  latestStream,
}: {
  latestStream: {
    id: string;
    title: string;
    status: string;
    room_code: string;
    scheduled_at: string | null;
    created_at: string;
  } | null;
}) {
  const liveDashboardUrl = "https://live.isunday.me/host/dashboard";

  // Branch on stream state. We pick a single banner per state rather
  // than stacking everything — keeps the surface calm.
  if (latestStream?.status === "live") {
    const streamUrl = `https://live.isunday.me/host/stream/${latestStream.room_code}`;
    return (
      <Card className="mb-6 overflow-hidden border-red-500/40 bg-gradient-to-br from-red-500/10 via-red-500/5 to-transparent">
        <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <span className="relative mt-1 flex h-3 w-3 shrink-0">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-60" />
              <span className="relative inline-flex h-3 w-3 rounded-full bg-red-500" />
            </span>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <Badge className="h-5 bg-red-500 text-[10px] uppercase tracking-wider text-white hover:bg-red-500">
                  Live now
                </Badge>
                <span className="truncate text-sm font-medium">
                  {latestStream.title}
                </span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                You're broadcasting on the live surface. Studio updates
                will reflect here as soon as the stream ends.
              </p>
            </div>
          </div>
          <Button asChild size="sm" className="shrink-0">
            <a href={streamUrl}>
              <Radio className="mr-2 h-3.5 w-3.5" />
              Open broadcast
            </a>
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (latestStream?.status === "scheduled" && latestStream.scheduled_at) {
    const when = new Date(latestStream.scheduled_at);
    const whenLabel = when.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
    return (
      <Card className="mb-6 border-blue-500/30 bg-blue-500/5">
        <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <CalendarClock className="mt-0.5 h-5 w-5 shrink-0 text-blue-500" />
            <div className="min-w-0">
              <div className="text-sm font-medium">
                Scheduled: {latestStream.title}
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Going live {whenLabel}.
              </p>
            </div>
          </div>
          <Button asChild size="sm" variant="outline" className="shrink-0">
            <a href={liveDashboardUrl}>Manage on live dashboard</a>
          </Button>
        </CardContent>
      </Card>
    );
  }

  // Idle / no recent stream / ended stream — gentle CTA back to live.
  return (
    <Card className="mb-6 border-dashed">
      <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <CircleDot className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
          <div className="min-w-0">
            <div className="text-sm font-medium">
              {latestStream
                ? `Last stream: ${latestStream.title}`
                : "No streams yet"}
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">
              The studio surfaces what you create on the live side. Start
              a broadcast and your archive, replays, and audience tools
              all flow back here automatically.
            </p>
          </div>
        </div>
        <Button asChild size="sm" className="shrink-0">
          <a href={liveDashboardUrl}>
            <Radio className="mr-2 h-3.5 w-3.5" />
            Go live
          </a>
        </Button>
      </CardContent>
    </Card>
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
