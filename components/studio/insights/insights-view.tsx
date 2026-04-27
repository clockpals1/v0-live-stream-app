"use client";

import { useEffect, useState } from "react";
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Area,
  AreaChart,
  Legend,
} from "recharts";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Radio,
  Users,
  Eye,
  MessageSquare,
  Film,
  TrendingUp,
  Clock,
  Heart,
  Loader2,
  Lock,
  Zap,
  BarChart2,
} from "lucide-react";
import { PlanPickerDialog } from "@/components/billing/plan-picker-dialog";
import { cn } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────

interface AnalyticsData {
  streams: { total: number; liveMinutes: number; peakConcurrent: number; avgViewers: number; totalViewerSessions: number };
  chat: { total: number; avgPerStream: number };
  replays: { total: number; totalViews: number; totalLikes: number; totalComments: number };
  subscribers: { active: number; total: number };
  viewersByStream: Array<{ title: string; viewers: number; durationMins: number; date: string }>;
  subscriberGrowth: Array<{ week: string; newCount: number; cumulative: number }>;
  topReplays: Array<{ title: string; views: number; likes: number; comments: number }>;
  chatByStream: Array<{ title: string; messages: number }>;
}

interface InsightsViewProps {
  planSlug: string;
  isEntitled: boolean;
  isPlatformAdmin: boolean;
}

// ─── Helpers ──────────────────────────────────────────────────────────

function fmtMins(mins: number): string {
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function fmtWeekLabel(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

// ─── Stat card ────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  sub,
  icon,
  tone = "default",
}: {
  label: string;
  value: string | number;
  sub?: string;
  icon: React.ReactNode;
  tone?: "default" | "emerald" | "sky" | "violet" | "amber";
}) {
  const bg = {
    default: "bg-primary/10 text-primary",
    emerald: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
    sky: "bg-sky-500/10 text-sky-600 dark:text-sky-400",
    violet: "bg-violet-500/10 text-violet-600 dark:text-violet-400",
    amber: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  }[tone];

  return (
    <Card>
      <CardContent className="flex items-center gap-3 px-4 py-4">
        <div className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-xl", bg)}>
          {icon}
        </div>
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</div>
          <div className="mt-0.5 text-2xl font-semibold tabular-nums leading-none">
            {typeof value === "number" ? value.toLocaleString() : value}
          </div>
          {sub && <div className="mt-0.5 text-xs text-muted-foreground">{sub}</div>}
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Custom tooltip ───────────────────────────────────────────────────

function ChartTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ name: string; value: number; color: string }>; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2 text-xs shadow-lg">
      <p className="mb-1 font-medium text-foreground">{label}</p>
      {payload.map((p, i) => (
        <p key={i} style={{ color: p.color }}>
          {p.name}: <span className="font-semibold">{p.value.toLocaleString()}</span>
        </p>
      ))}
    </div>
  );
}

// ─── Gated overlay ───────────────────────────────────────────────────

function GatedOverlay({ onUpgrade }: { onUpgrade: () => void }) {
  return (
    <div className="flex min-h-[400px] flex-col items-center justify-center gap-4 rounded-xl border border-border bg-muted/30 py-16 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
        <Lock className="h-6 w-6 text-primary" />
      </div>
      <div>
        <h3 className="text-lg font-semibold">Analytics &amp; Insights</h3>
        <p className="mt-1 max-w-sm text-sm text-muted-foreground">
          Upgrade your plan to unlock viewer trends, chat activity, subscriber growth, replay performance, and stream retention metrics.
        </p>
      </div>
      <Button className="gap-2" onClick={onUpgrade}>
        <Zap className="h-4 w-4" />
        Upgrade to unlock
      </Button>
    </div>
  );
}

// ─── Empty state ─────────────────────────────────────────────────────

function EmptyChart({ message }: { message: string }) {
  return (
    <div className="flex h-[200px] items-center justify-center rounded-lg border border-dashed border-border">
      <p className="text-sm text-muted-foreground">{message}</p>
    </div>
  );
}

// ─── Main view ────────────────────────────────────────────────────────

export function InsightsView({ planSlug, isEntitled, isPlatformAdmin }: InsightsViewProps) {
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [pickerOpen, setPickerOpen] = useState(false);

  const canView = isPlatformAdmin || isEntitled;

  useEffect(() => {
    if (!canView) { setLoading(false); return; }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/host/analytics/overview");
        if (!res.ok) return;
        const json = await res.json();
        if (!cancelled) setData(json);
      } catch { /* silent */ }
      finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [canView]);

  if (!canView) {
    return (
      <>
        <GatedOverlay onUpgrade={() => setPickerOpen(true)} />
        <PlanPickerDialog open={pickerOpen} onOpenChange={setPickerOpen} currentPlanSlug={planSlug} />
      </>
    );
  }

  if (loading) {
    return (
      <div className="flex min-h-[300px] items-center justify-center gap-2 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
        Loading analytics…
      </div>
    );
  }

  if (!data) {
    return <p className="text-sm text-muted-foreground">Failed to load analytics. Try refreshing.</p>;
  }

  const hasStreams = data.streams.total > 0;
  const hasViewerData = data.viewersByStream.length > 0;
  const hasChatData = data.chatByStream.some((r) => r.messages > 0);
  const hasSubData = data.subscriberGrowth.some((r) => r.newCount > 0 || r.cumulative > 0);
  const hasReplayData = data.topReplays.length > 0;

  // Axis tick formatter — shorten long labels
  const tickFmt = (v: string) => (v.length > 12 ? v.slice(0, 12) + "…" : v);

  return (
    <div className="space-y-8">
      {/* ─── Summary stats ──────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard
          label="Total streams"
          value={data.streams.total}
          sub={hasStreams ? fmtMins(data.streams.liveMinutes) + " broadcast" : undefined}
          icon={<Radio className="h-5 w-5" />}
          tone="default"
        />
        <StatCard
          label="Peak concurrent"
          value={data.streams.peakConcurrent}
          sub={`avg ${data.streams.avgViewers} per stream`}
          icon={<Eye className="h-5 w-5" />}
          tone="sky"
        />
        <StatCard
          label="Chat messages"
          value={data.chat.total}
          sub={`avg ${data.chat.avgPerStream} per stream`}
          icon={<MessageSquare className="h-5 w-5" />}
          tone="amber"
        />
        <StatCard
          label="Subscribers"
          value={data.subscribers.active}
          sub={`${data.subscribers.total} total (incl. unsub)`}
          icon={<Users className="h-5 w-5" />}
          tone="emerald"
        />
      </div>

      {/* ─── Tabs ───────────────────────────────────────────────────── */}
      <Tabs defaultValue="live">
        <TabsList>
          <TabsTrigger value="live" className="gap-1.5 text-xs">
            <Radio className="h-3.5 w-3.5" />
            Live Performance
          </TabsTrigger>
          <TabsTrigger value="audience" className="gap-1.5 text-xs">
            <Users className="h-3.5 w-3.5" />
            Audience
          </TabsTrigger>
          <TabsTrigger value="replays" className="gap-1.5 text-xs">
            <Film className="h-3.5 w-3.5" />
            Replays
          </TabsTrigger>
        </TabsList>

        {/* ── Live Performance ─────────────────────────────────────── */}
        <TabsContent value="live" className="mt-4 space-y-6">
          {/* Viewers by stream */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm font-semibold">
                <Eye className="h-4 w-4 text-sky-500" />
                Viewer count — last 10 streams
              </CardTitle>
              <CardDescription className="text-xs">
                Total viewer sessions per ended stream, chronological order.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {hasViewerData ? (
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={data.viewersByStream} margin={{ top: 4, right: 8, left: 0, bottom: 40 }}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                    <XAxis
                      dataKey="title"
                      tick={{ fontSize: 10 }}
                      tickFormatter={tickFmt}
                      angle={-35}
                      textAnchor="end"
                      interval={0}
                    />
                    <YAxis tick={{ fontSize: 10 }} width={32} />
                    <Tooltip content={<ChartTooltip />} />
                    <Bar dataKey="viewers" name="Viewers" fill="hsl(var(--primary))" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <EmptyChart message="No ended streams with viewer data yet." />
              )}
            </CardContent>
          </Card>

          {/* Stream retention / duration */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm font-semibold">
                <Clock className="h-4 w-4 text-amber-500" />
                Stream duration — last 10 streams
              </CardTitle>
              <CardDescription className="text-xs">
                Minutes from start to end for each ended stream.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {hasViewerData ? (
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={data.viewersByStream} margin={{ top: 4, right: 8, left: 0, bottom: 40 }}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                    <XAxis
                      dataKey="title"
                      tick={{ fontSize: 10 }}
                      tickFormatter={tickFmt}
                      angle={-35}
                      textAnchor="end"
                      interval={0}
                    />
                    <YAxis tick={{ fontSize: 10 }} width={38} tickFormatter={(v: number) => `${v}m`} />
                    <Tooltip content={<ChartTooltip />} />
                    <Bar dataKey="durationMins" name="Minutes" fill="hsl(var(--primary) / 0.6)" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <EmptyChart message="No duration data yet — streams need a started_at and ended_at." />
              )}
            </CardContent>
          </Card>

          {/* Chat activity */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm font-semibold">
                <MessageSquare className="h-4 w-4 text-amber-500" />
                Chat activity — last 10 streams
              </CardTitle>
              <CardDescription className="text-xs">
                Total chat messages sent per stream.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {hasChatData ? (
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={data.chatByStream} margin={{ top: 4, right: 8, left: 0, bottom: 40 }}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                    <XAxis
                      dataKey="title"
                      tick={{ fontSize: 10 }}
                      tickFormatter={tickFmt}
                      angle={-35}
                      textAnchor="end"
                      interval={0}
                    />
                    <YAxis tick={{ fontSize: 10 }} width={32} />
                    <Tooltip content={<ChartTooltip />} />
                    <Bar dataKey="messages" name="Messages" fill="hsl(38 92% 50%)" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <EmptyChart message="No chat data yet for recent streams." />
              )}
            </CardContent>
          </Card>

          {/* Viewer + duration side-by-side summary */}
          {hasViewerData && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm font-semibold">
                  <TrendingUp className="h-4 w-4 text-sky-500" />
                  Viewer vs. Duration overlay
                </CardTitle>
                <CardDescription className="text-xs">
                  Compare how long you streamed against how many people tuned in.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={data.viewersByStream} margin={{ top: 4, right: 8, left: 0, bottom: 40 }}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                    <XAxis
                      dataKey="title"
                      tick={{ fontSize: 10 }}
                      tickFormatter={tickFmt}
                      angle={-35}
                      textAnchor="end"
                      interval={0}
                    />
                    <YAxis yAxisId="left" tick={{ fontSize: 10 }} width={32} />
                    <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10 }} width={38} tickFormatter={(v: number) => `${v}m`} />
                    <Tooltip content={<ChartTooltip />} />
                    <Legend wrapperStyle={{ fontSize: 10, paddingTop: 8 }} />
                    <Bar yAxisId="left" dataKey="viewers" name="Viewers" fill="hsl(var(--primary))" radius={[3, 3, 0, 0]} />
                    <Bar yAxisId="right" dataKey="durationMins" name="Duration (min)" fill="hsl(var(--primary) / 0.35)" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ── Audience ─────────────────────────────────────────────── */}
        <TabsContent value="audience" className="mt-4 space-y-6">
          {/* Cumulative growth */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm font-semibold">
                <Users className="h-4 w-4 text-emerald-500" />
                Subscriber growth — last 12 weeks
              </CardTitle>
              <CardDescription className="text-xs">
                Cumulative active subscribers and new sign-ups per week.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {hasSubData ? (
                <ResponsiveContainer width="100%" height={240}>
                  <AreaChart
                    data={data.subscriberGrowth.map((r) => ({
                      ...r,
                      week: fmtWeekLabel(r.week),
                    }))}
                    margin={{ top: 4, right: 8, left: 0, bottom: 0 }}
                  >
                    <defs>
                      <linearGradient id="gradCumulative" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="hsl(142 76% 36%)" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="hsl(142 76% 36%)" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                    <XAxis dataKey="week" tick={{ fontSize: 10 }} />
                    <YAxis tick={{ fontSize: 10 }} width={32} />
                    <Tooltip content={<ChartTooltip />} />
                    <Legend wrapperStyle={{ fontSize: 10 }} />
                    <Area
                      type="monotone"
                      dataKey="cumulative"
                      name="Total subscribers"
                      stroke="hsl(142 76% 36%)"
                      fill="url(#gradCumulative)"
                      strokeWidth={2}
                    />
                    <Bar dataKey="newCount" name="New this week" fill="hsl(142 76% 50%)" radius={[2, 2, 0, 0]} />
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <EmptyChart message="No subscriber data in the last 12 weeks." />
              )}
            </CardContent>
          </Card>

          {/* Weekly new subscribers bar chart */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm font-semibold">
                <TrendingUp className="h-4 w-4 text-emerald-500" />
                New subscribers per week
              </CardTitle>
            </CardHeader>
            <CardContent>
              {hasSubData ? (
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart
                    data={data.subscriberGrowth.map((r) => ({ ...r, week: fmtWeekLabel(r.week) }))}
                    margin={{ top: 4, right: 8, left: 0, bottom: 0 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                    <XAxis dataKey="week" tick={{ fontSize: 10 }} />
                    <YAxis tick={{ fontSize: 10 }} width={32} allowDecimals={false} />
                    <Tooltip content={<ChartTooltip />} />
                    <Bar dataKey="newCount" name="New subscribers" fill="hsl(142 76% 36%)" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <EmptyChart message="No new subscribers in the last 12 weeks." />
              )}
            </CardContent>
          </Card>

          {/* Subscriber stats summary */}
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <Card>
              <CardContent className="px-4 py-4">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Active subscribers</div>
                <div className="mt-1 text-3xl font-semibold tabular-nums">{data.subscribers.active.toLocaleString()}</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="px-4 py-4">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Total ever</div>
                <div className="mt-1 text-3xl font-semibold tabular-nums">{data.subscribers.total.toLocaleString()}</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="px-4 py-4">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Retention rate</div>
                <div className="mt-1 text-3xl font-semibold tabular-nums">
                  {data.subscribers.total > 0
                    ? Math.round((data.subscribers.active / data.subscribers.total) * 100) + "%"
                    : "—"}
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* ── Replays ──────────────────────────────────────────────── */}
        <TabsContent value="replays" className="mt-4 space-y-6">
          {/* Replay performance */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm font-semibold">
                <Film className="h-4 w-4 text-violet-500" />
                Replay views — top 5
              </CardTitle>
              <CardDescription className="text-xs">
                Total views for your most-watched published replays.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {hasReplayData ? (
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={data.topReplays} layout="vertical" margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border" horizontal={false} />
                    <XAxis type="number" tick={{ fontSize: 10 }} />
                    <YAxis type="category" dataKey="title" tick={{ fontSize: 10 }} width={130} />
                    <Tooltip content={<ChartTooltip />} />
                    <Bar dataKey="views" name="Views" fill="hsl(263 70% 50%)" radius={[0, 3, 3, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <EmptyChart message="No published replays yet." />
              )}
            </CardContent>
          </Card>

          {/* Likes and comments */}
          {hasReplayData && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm font-semibold">
                  <Heart className="h-4 w-4 text-violet-500" />
                  Engagement per replay
                </CardTitle>
                <CardDescription className="text-xs">
                  Likes and comments broken down by replay.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={data.topReplays} layout="vertical" margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border" horizontal={false} />
                    <XAxis type="number" tick={{ fontSize: 10 }} />
                    <YAxis type="category" dataKey="title" tick={{ fontSize: 10 }} width={130} />
                    <Tooltip content={<ChartTooltip />} />
                    <Legend wrapperStyle={{ fontSize: 10 }} />
                    <Bar dataKey="likes" name="Likes" fill="hsl(263 70% 50%)" radius={[0, 2, 2, 0]} />
                    <Bar dataKey="comments" name="Comments" fill="hsl(263 70% 70%)" radius={[0, 2, 2, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          )}

          {/* Replay aggregate stats */}
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {[
              { label: "Published replays", value: data.replays.total },
              { label: "Total replay views", value: data.replays.totalViews },
              { label: "Total likes", value: data.replays.totalLikes },
              { label: "Total comments", value: data.replays.totalComments },
            ].map(({ label, value }) => (
              <Card key={label}>
                <CardContent className="px-4 py-4">
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</div>
                  <div className="mt-1 text-3xl font-semibold tabular-nums">{value.toLocaleString()}</div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>
      </Tabs>

      <PlanPickerDialog open={pickerOpen} onOpenChange={setPickerOpen} currentPlanSlug={planSlug} />
    </div>
  );
}
