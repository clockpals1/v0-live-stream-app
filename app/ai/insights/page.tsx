import type React from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getEffectivePlan } from "@/lib/billing/entitlements";
import { featureEnabled } from "@/lib/billing/plans";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import Link from "next/link";
import {
  BarChart2,
  Lock,
  ArrowRight,
  TrendingUp,
  MessageSquare,
  Users,
  Sparkles,
  ChevronRight,
  Activity,
  Eye,
  Clock,
  PlayCircle,
  PenLine,
  Send,
  Lightbulb,
} from "lucide-react";

export const dynamic = "force-dynamic";

// ── Types ──────────────────────────────────────────────────────────────────

interface StreamRow {
  id: string;
  title: string;
  status: string;
  viewer_count: number;
  started_at: string | null;
  ended_at: string | null;
  created_at: string;
}

interface SubRow {
  created_at: string;
  is_active: boolean;
}

interface ReplayRow {
  title: string;
  view_count: number;
  like_count: number;
  comment_count: number;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function durationMins(s: StreamRow): number {
  if (!s.started_at || !s.ended_at) return 0;
  return Math.round(
    (new Date(s.ended_at).getTime() - new Date(s.started_at).getTime()) / 60000,
  );
}

function lastNWeekStarts(n: number): string[] {
  const weeks: string[] = [];
  const now = new Date();
  const dayOfWeek = (now.getDay() + 6) % 7;
  const monday = new Date(now);
  monday.setDate(monday.getDate() - dayOfWeek);
  monday.setHours(0, 0, 0, 0);
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(monday);
    d.setDate(d.getDate() - i * 7);
    weeks.push(d.toISOString().slice(0, 10));
  }
  return weeks;
}

function buildGrowthNarrative(
  recentGain: number,
  prevGain: number,
  totalSubs: number,
  totalStreams: number,
  peakViewers: number,
): string {
  if (totalStreams === 0) {
    return "Go live for the first time to start generating your performance intelligence. Your AI growth narrative will appear here after your first stream.";
  }
  if (totalSubs === 0 && recentGain === 0) {
    return `You have ${totalStreams} stream${totalStreams !== 1 ? "s" : ""} on record with a peak of ${peakViewers} concurrent viewer${peakViewers !== 1 ? "s" : ""}. Promote your stream link to start building your subscriber base — subscriber growth signals will appear here automatically.`;
  }
  if (recentGain > prevGain && prevGain > 0) {
    const pct = Math.round(((recentGain - prevGain) / prevGain) * 100);
    return `Growing — ${recentGain} new subscriber${recentGain !== 1 ? "s" : ""} this month, up ${pct}% from last month. Your peak stream attracted ${peakViewers} concurrent viewers. Momentum is building — keep publishing consistently.`;
  }
  if (recentGain > prevGain && prevGain === 0) {
    return `Breakout month — ${recentGain} new subscriber${recentGain !== 1 ? "s" : ""} with no subscribers the month before. Your content is starting to convert viewers into followers.`;
  }
  if (recentGain < prevGain && recentGain > 0) {
    return `Steady with a slight cooldown — ${recentGain} new subscriber${recentGain !== 1 ? "s" : ""} this month vs ${prevGain} last month. Consistent publishing and cross-promotion will sustain your audience growth curve.`;
  }
  if (recentGain === prevGain && recentGain > 0) {
    return `Consistent — ${recentGain} new subscriber${recentGain !== 1 ? "s" : ""} each of the past two months. You have a reliable growth baseline. Publishing more frequently is the fastest way to accelerate it.`;
  }
  return `${totalSubs} total subscriber${totalSubs !== 1 ? "s" : ""} following your content across ${totalStreams} stream${totalStreams !== 1 ? "s" : ""}. Your audience exists — keep streaming to deepen engagement.`;
}

function buildChatInsight(
  chatByStream: { title: string; messages: number }[],
  avgPerStream: number,
): string {
  const active = chatByStream.filter((c) => c.messages > 0);
  if (active.length === 0) {
    return "No chat activity recorded yet. When your audience starts chatting during streams, AI will surface the topics and moments that drive the most engagement for you.";
  }
  const sorted = [...active].sort((a, b) => b.messages - a.messages);
  const top = sorted[0];
  const hotCount = active.filter((c) => c.messages > avgPerStream).length;
  if (hotCount > 1) {
    return `"${top.title}" generated the most audience interaction. ${hotCount} of your recent streams had above-average chat activity (>${avgPerStream} messages). These topics are your strongest engagement signals — plan future streams around them.`;
  }
  return `Your audience was most active during "${top.title}" with ${top.messages} chat message${top.messages !== 1 ? "s" : ""}. Streams on similar topics tend to drive deeper audience participation and higher replay retention.`;
}

function buildPerformanceInsight(
  viewersByStream: { title: string; viewers: number; durationMins: number }[],
): string {
  const valid = viewersByStream.filter((s) => s.viewers > 0);
  if (valid.length === 0) {
    return "Performance patterns will appear once you have completed streams with viewer data. Each stream you run trains the pattern model.";
  }
  const sorted = [...valid].sort((a, b) => b.viewers - a.viewers);
  const top = sorted[0];
  const avgDur = Math.round(valid.reduce((s, e) => s + e.durationMins, 0) / valid.length);
  const avgVwr = Math.round(valid.reduce((s, e) => s + e.viewers, 0) / valid.length);
  const longerWins =
    valid.filter((s) => s.durationMins > avgDur && s.viewers > avgVwr).length >
    valid.filter((s) => s.durationMins <= avgDur && s.viewers > avgVwr).length;
  return `"${top.title}" is your highest-performing stream with ${top.viewers} viewer${top.viewers !== 1 ? "s" : ""}. Across your last ${valid.length} streams, you average ${avgVwr} concurrent viewers and ${avgDur} minutes of live time. ${longerWins ? "Longer sessions correlate with higher viewership for your audience." : "Your audience engages strongly with focused, concise streams."}`;
}

// ── Page ───────────────────────────────────────────────────────────────────

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

  const hostId = host?.id ?? "";

  // ── Parallel data fetch ───────────────────────────────────────────────
  const [streamsRes, archivesRes, subsRes, replaysRes] = await Promise.all([
    admin
      .from("streams")
      .select("id, title, status, viewer_count, started_at, ended_at, created_at")
      .eq("host_id", hostId)
      .order("created_at", { ascending: false })
      .limit(50),
    admin
      .from("stream_archives")
      .select("id", { count: "exact", head: true })
      .eq("host_id", hostId)
      .eq("status", "ready"),
    admin
      .from("host_subscribers")
      .select("created_at, is_active")
      .eq("host_id", hostId)
      .order("created_at", { ascending: true })
      .limit(5000),
    (async () => {
      try {
        return await admin
          .from("replay_publications")
          .select("title, view_count, like_count, comment_count")
          .eq("host_id", hostId)
          .eq("is_published", true)
          .order("view_count", { ascending: false })
          .limit(5);
      } catch {
        return { data: [] as ReplayRow[] };
      }
    })(),
  ]);

  const streams: StreamRow[] = (streamsRes.data ?? []) as StreamRow[];
  const subs: SubRow[] = (subsRes.data ?? []) as SubRow[];
  const replays: ReplayRow[] = (replaysRes.data ?? []) as ReplayRow[];

  // ── Stream metrics ────────────────────────────────────────────────────
  const endedStreams = streams.filter(
    (s) => s.status === "ended" && s.started_at && s.ended_at,
  );
  const peakConcurrent = streams.reduce((m, s) => Math.max(m, s.viewer_count ?? 0), 0);
  const totalViewerSessions = streams.reduce((sum, s) => sum + (s.viewer_count ?? 0), 0);
  const liveMinutes = endedStreams.reduce((sum, s) => sum + durationMins(s), 0);
  const avgViewers =
    endedStreams.length > 0
      ? Math.round(totalViewerSessions / endedStreams.length)
      : 0;

  // ── Subscriber metrics ────────────────────────────────────────────────
  const weekLabels = lastNWeekStarts(8);
  const weekGrowth = weekLabels.map((weekStart, i) => {
    const weekEnd = weekLabels[i + 1] ?? new Date().toISOString().slice(0, 10);
    return {
      week: weekStart,
      newCount: subs.filter(
        (s) => s.created_at >= weekStart && s.created_at < weekEnd,
      ).length,
    };
  });
  const last4 = weekGrowth.slice(-4).reduce((s, w) => s + w.newCount, 0);
  const prev4 = weekGrowth.slice(0, 4).reduce((s, w) => s + w.newCount, 0);
  const activeSubs = subs.filter((s) => s.is_active).length;

  // ── Chat activity ─────────────────────────────────────────────────────
  const recentEnded = endedStreams.slice(0, 10);
  const recentIds = recentEnded.map((s) => s.id);
  let chatCounts: { stream_id: string; count: number }[] = [];
  if (recentIds.length > 0) {
    try {
      const { data: chatData } = await admin
        .from("chat_messages")
        .select("stream_id")
        .in("stream_id", recentIds);
      if (chatData) {
        const tally: Record<string, number> = {};
        for (const row of chatData as { stream_id: string }[]) {
          tally[row.stream_id] = (tally[row.stream_id] ?? 0) + 1;
        }
        chatCounts = Object.entries(tally).map(([stream_id, count]) => ({
          stream_id,
          count,
        }));
      }
    } catch {
      // chat_messages unavailable — safe to skip
    }
  }
  const totalChat = chatCounts.reduce((s, r) => s + r.count, 0);
  const avgChat =
    chatCounts.length > 0 ? Math.round(totalChat / chatCounts.length) : 0;

  const chatByStream = recentIds.map((id) => {
    const s = streams.find((x) => x.id === id);
    const c = chatCounts.find((r) => r.stream_id === id);
    return {
      title: s ? (s.title.length > 28 ? s.title.slice(0, 28) + "…" : s.title) : id,
      messages: c?.count ?? 0,
    };
  });

  const viewersByStream = endedStreams
    .slice(0, 10)
    .reverse()
    .map((s) => ({
      title: s.title.length > 28 ? s.title.slice(0, 28) + "…" : s.title,
      viewers: s.viewer_count ?? 0,
      durationMins: durationMins(s),
    }));

  // ── Narratives ────────────────────────────────────────────────────────
  const growthNarrative = buildGrowthNarrative(
    last4,
    prev4,
    activeSubs,
    streams.length,
    peakConcurrent,
  );
  const chatInsight = buildChatInsight(chatByStream, avgChat);
  const performanceInsight = buildPerformanceInsight(viewersByStream);

  // ── Top performers ────────────────────────────────────────────────────
  const topStreams = [...endedStreams]
    .sort((a, b) => (b.viewer_count ?? 0) - (a.viewer_count ?? 0))
    .slice(0, 5);
  const maxViewers = topStreams[0]?.viewer_count ?? 1;

  const maxChatStream = Math.max(...chatByStream.map((c) => c.messages), 1);

  return (
    <main className="mx-auto max-w-5xl px-5 py-10 sm:px-8 sm:py-12">

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <header className="mb-10">
        <div className="mb-2 inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
          <BarChart2 className="h-3 w-3" />
          AI Insights · Phase 5
        </div>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
          Understand your performance, deeply
        </h1>
        <p className="mt-2 max-w-xl text-sm text-muted-foreground">
          The intelligence layer of your platform — chat themes, stream patterns,
          subscriber signals, and AI-written narratives that explain what&apos;s working and what to do next.
        </p>
      </header>

      {/* ── Performance summary (always visible) ───────────────────────── */}
      <div className="mb-10 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Total streams" value={streams.length} icon={Activity} />
        <StatCard label="Live minutes" value={liveMinutes} icon={Clock} />
        <StatCard label="Peak viewers" value={peakConcurrent} icon={Eye} />
        <StatCard label="Subscribers" value={activeSubs} icon={Users} />
      </div>

      {isEntitled ? (
        <InsightsDashboard
          growthNarrative={growthNarrative}
          chatInsight={chatInsight}
          performanceInsight={performanceInsight}
          weekGrowth={weekGrowth}
          topStreams={topStreams}
          maxViewers={maxViewers}
          chatByStream={chatByStream.filter((c) => c.messages > 0).slice(0, 6)}
          maxChatStream={maxChatStream}
          replays={replays}
          archiveCount={archivesRes.count ?? 0}
          avgViewers={avgViewers}
          totalChat={totalChat}
        />
      ) : (
        <UpgradeGate planName={effective.plan?.name ?? "Free"} />
      )}
    </main>
  );
}

// ── InsightsDashboard ──────────────────────────────────────────────────────

function InsightsDashboard({
  growthNarrative,
  chatInsight,
  performanceInsight,
  weekGrowth,
  topStreams,
  maxViewers,
  chatByStream,
  maxChatStream,
  replays,
  archiveCount,
  avgViewers,
  totalChat,
}: {
  growthNarrative: string;
  chatInsight: string;
  performanceInsight: string;
  weekGrowth: { week: string; newCount: number }[];
  topStreams: StreamRow[];
  maxViewers: number;
  chatByStream: { title: string; messages: number }[];
  maxChatStream: number;
  replays: ReplayRow[];
  archiveCount: number;
  avgViewers: number;
  totalChat: number;
}) {
  const recentWeek = weekGrowth[weekGrowth.length - 1]?.newCount ?? 0;
  const prevWeek = weekGrowth[weekGrowth.length - 2]?.newCount ?? 0;
  const trend: "up" | "down" | "flat" =
    recentWeek > prevWeek ? "up" : recentWeek < prevWeek ? "down" : "flat";
  const maxWeekCount = Math.max(...weekGrowth.map((w) => w.newCount), 1);

  return (
    <div className="space-y-10">

      {/* ── Section 1: AI Growth Narrative ─────────────────────────────── */}
      <section>
        <SectionLabel icon={Sparkles} label="AI Growth Narrative" color="text-emerald-600" />

        <div className="mt-3 rounded-xl border border-emerald-200/60 bg-gradient-to-br from-emerald-50/60 to-background p-6 dark:border-emerald-900/40 dark:from-emerald-950/20">
          <div className="flex items-start gap-3">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10">
              <TrendingUp className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex flex-wrap items-center gap-2 mb-2">
                <span className="text-sm font-semibold">Subscriber growth signal</span>
                <Badge
                  className={`text-[10px] h-4 px-1.5 border-0 ${
                    trend === "up"
                      ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                      : trend === "down"
                        ? "bg-amber-500/10 text-amber-700 dark:text-amber-400"
                        : "bg-muted text-muted-foreground"
                  }`}
                >
                  {trend === "up" ? "↑ Growing" : trend === "down" ? "↓ Cooling" : "→ Steady"}
                </Badge>
              </div>
              <p className="text-sm text-muted-foreground leading-relaxed">{growthNarrative}</p>

              {/* Mini sparkline — last 8 weeks */}
              {weekGrowth.some((w) => w.newCount > 0) && (
                <div className="mt-4">
                  <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    New subscribers · last 8 weeks
                  </p>
                  <div className="flex items-end gap-1 h-10">
                    {weekGrowth.map((w, i) => (
                      <div key={i} className="flex-1 flex flex-col items-center justify-end h-full">
                        <div
                          className="w-full rounded-sm bg-emerald-500/70 dark:bg-emerald-400/60 transition-all"
                          style={{ height: `${Math.max(4, Math.round((w.newCount / maxWeekCount) * 40))}px` }}
                          title={`${w.week}: ${w.newCount} new`}
                        />
                      </div>
                    ))}
                  </div>
                  <div className="mt-1 flex justify-between text-[9px] text-muted-foreground/60">
                    <span>{weekGrowth[0]?.week?.slice(5)}</span>
                    <span>this week</span>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Quick sub-metrics strip */}
        <div className="mt-3 grid grid-cols-3 gap-2">
          {[
            { label: "New this month", value: String(weekGrowth.slice(-4).reduce((s, w) => s + w.newCount, 0)) },
            { label: "Avg viewers / stream", value: String(avgViewers) },
            { label: "Total chat messages", value: totalChat.toLocaleString() },
          ].map(({ label, value }) => (
            <div
              key={label}
              className="rounded-lg border border-border/60 bg-muted/20 px-3 py-2.5 text-center"
            >
              <div className="text-base font-semibold tabular-nums">{value}</div>
              <div className="mt-0.5 text-[10px] text-muted-foreground">{label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Section 2: Chat + Performance ──────────────────────────────── */}
      <section className="grid gap-5 sm:grid-cols-2">

        {/* Chat Theme Extraction */}
        <div>
          <SectionLabel icon={MessageSquare} label="Chat Theme Extraction" color="text-sky-600" />
          <Card className="mt-3 border-border/60 h-full">
            <CardContent className="p-5">
              <p className="text-[12px] text-muted-foreground leading-relaxed mb-4">
                {chatInsight}
              </p>

              {chatByStream.length > 0 ? (
                <div className="space-y-2">
                  <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    Audience engagement by stream
                  </p>
                  {chatByStream.slice(0, 5).map((c, i) => (
                    <div key={i}>
                      <div className="flex items-center justify-between mb-0.5 gap-2">
                        <span className="text-[11px] text-foreground/80 truncate min-w-0">{c.title}</span>
                        <span className="text-[10px] tabular-nums text-muted-foreground shrink-0">{c.messages}</span>
                      </div>
                      <div className="h-1.5 w-full rounded-full bg-muted/40">
                        <div
                          className="h-full rounded-full bg-sky-400/70 dark:bg-sky-500/60"
                          style={{ width: `${Math.max(4, Math.round((c.messages / maxChatStream) * 100))}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex items-center gap-2 rounded-lg border border-dashed border-border px-3 py-3">
                  <MessageSquare className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <p className="text-[11px] text-muted-foreground">Go live to start collecting chat signals.</p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Content Performance Patterns */}
        <div>
          <SectionLabel icon={TrendingUp} label="Content Performance Patterns" color="text-violet-600" />
          <Card className="mt-3 border-border/60 h-full">
            <CardContent className="p-5">
              <p className="text-[12px] text-muted-foreground leading-relaxed mb-4">
                {performanceInsight}
              </p>

              {topStreams.length > 0 ? (
                <div className="space-y-2">
                  <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    Top streams by viewership
                  </p>
                  {topStreams.slice(0, 5).map((s, i) => (
                    <div key={s.id}>
                      <div className="flex items-center justify-between mb-0.5 gap-2">
                        <span className="text-[11px] text-foreground/80 truncate min-w-0">
                          {s.title.length > 28 ? s.title.slice(0, 28) + "…" : s.title}
                        </span>
                        <span className="text-[10px] tabular-nums text-muted-foreground shrink-0">
                          {s.viewer_count ?? 0} viewers
                        </span>
                      </div>
                      <div className="h-1.5 w-full rounded-full bg-muted/40">
                        <div
                          className="h-full rounded-full bg-violet-400/70 dark:bg-violet-500/60"
                          style={{ width: `${Math.max(4, Math.round(((s.viewer_count ?? 0) / maxViewers) * 100))}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex items-center gap-2 rounded-lg border border-dashed border-border px-3 py-3">
                  <TrendingUp className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <p className="text-[11px] text-muted-foreground">Stream performance patterns appear after your first completed stream.</p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </section>

      {/* ── Section 3: Top Replays ──────────────────────────────────────── */}
      {replays.length > 0 && (
        <section>
          <SectionLabel icon={PlayCircle} label="Top Replay Performers" color="text-amber-600" />
          <div className="mt-3 space-y-2">
            {replays.map((r, i) => (
              <div
                key={i}
                className="flex items-center justify-between rounded-lg border border-border/60 bg-muted/10 px-4 py-3 gap-4"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span className="shrink-0 flex h-5 w-5 items-center justify-center rounded-full bg-amber-100 text-[10px] font-bold text-amber-700 dark:bg-amber-900/40 dark:text-amber-400">
                    {i + 1}
                  </span>
                  <span className="truncate text-sm font-medium min-w-0">{r.title}</span>
                </div>
                <div className="flex shrink-0 items-center gap-3 text-[11px] text-muted-foreground tabular-nums">
                  <span>{(r.view_count ?? 0).toLocaleString()} views</span>
                  {(r.like_count ?? 0) > 0 && <span>{r.like_count} likes</span>}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── Section 4: Insight tip ──────────────────────────────────────── */}
      <div className="rounded-xl border border-emerald-200/50 bg-emerald-50/30 px-5 py-4 dark:border-emerald-900/30 dark:bg-emerald-950/10">
        <div className="flex items-start gap-3">
          <Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
          <div>
            <p className="text-sm font-medium text-emerald-900 dark:text-emerald-200">
              Intelligence tip
            </p>
            <p className="mt-0.5 text-[12px] text-emerald-800/80 dark:text-emerald-300/70 leading-relaxed">
              Your best-performing streams share a common pattern — they attract viewers <em>and</em> generate
              chat. Use the AI Studio to create content that mirrors these patterns, then distribute
              it via Publishing Hub to compound your reach. Insights feed creation. Creation feeds growth.
            </p>
          </div>
        </div>
      </div>

      {/* ── Section 5: Cross-system action strip ───────────────────────── */}
      <section>
        <SectionLabel icon={ArrowRight} label="Continue your workflow" color="text-muted-foreground" />
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          {[
            {
              icon: BarChart2,
              label: "Full Studio Analytics",
              desc: "Detailed charts for viewer counts, chat, replays, and subscriber growth.",
              href: "https://studio.isunday.me/insights",
              color: "text-emerald-600",
              bg: "bg-emerald-500/10",
            },
            {
              icon: PenLine,
              label: "AI Studio",
              desc: "Create content informed by your top-performing themes and patterns.",
              href: "/ai",
              color: "text-violet-600",
              bg: "bg-violet-500/10",
            },
            {
              icon: Send,
              label: "Publishing Hub",
              desc: "Distribute your top replays and content to grow your reach further.",
              href: "/ai/publish",
              color: "text-sky-600",
              bg: "bg-sky-500/10",
            },
          ].map(({ icon: Icon, label, desc, href, color, bg }) => (
            <Link
              key={label}
              href={href}
              className="group flex flex-col gap-3 rounded-xl border border-border/60 bg-muted/10 p-4 transition-colors hover:bg-muted/30"
            >
              <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${bg}`}>
                <Icon className={`h-4 w-4 ${color}`} />
              </div>
              <div>
                <p className="text-sm font-medium group-hover:text-foreground">{label}</p>
                <p className="mt-0.5 text-[11px] text-muted-foreground leading-snug">{desc}</p>
              </div>
              <ChevronRight className={`h-3.5 w-3.5 ${color} mt-auto self-end opacity-0 group-hover:opacity-100 transition-opacity`} />
            </Link>
          ))}
        </div>
      </section>

      {/* Archive count context */}
      {archiveCount > 0 && (
        <p className="text-center text-[11px] text-muted-foreground/60">
          {archiveCount} saved archive{archiveCount !== 1 ? "s" : ""} available in Studio · insights update in real time
        </p>
      )}

    </div>
  );
}

// ── Shared sub-components ──────────────────────────────────────────────────

function StatCard({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: number;
  icon: React.ComponentType<{ className?: string }>;
}) {
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
    <div className="flex flex-col items-center justify-center py-16 text-center gap-4">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
        <Lock className="h-6 w-6 text-primary" />
      </div>
      <h2 className="text-base font-semibold">AI Insights requires an upgrade</h2>
      <p className="text-sm text-muted-foreground max-w-sm">
        Your current plan (<strong>{planName}</strong>) doesn&apos;t include AI-enhanced analytics.
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
