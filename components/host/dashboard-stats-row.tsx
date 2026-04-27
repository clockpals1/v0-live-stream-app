"use client";

import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { TrendingUp, Users, Eye, Film, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface Stats {
  totalStreams: number;
  activeSubscribers: number;
  totalViewerSessions: number;
  publishedReplays: number;
}

function StatCard({
  label,
  value,
  icon,
  tone,
  loading,
}: {
  label: string;
  value: string | number;
  icon: React.ReactNode;
  tone?: "primary" | "emerald" | "sky" | "violet";
  loading?: boolean;
}) {
  const toneMap = {
    primary: "text-primary",
    emerald: "text-emerald-600 dark:text-emerald-400",
    sky: "text-sky-600 dark:text-sky-400",
    violet: "text-violet-600 dark:text-violet-400",
  };
  const bgMap = {
    primary: "bg-primary/10",
    emerald: "bg-emerald-500/10",
    sky: "bg-sky-500/10",
    violet: "bg-violet-500/10",
  };
  const t = tone ?? "primary";
  return (
    <Card className={cn("transition-colors", tone === "primary" && "border-primary/20 bg-primary/5")}>
      <CardContent className="flex items-center gap-3 px-4 py-3">
        <div className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-lg", bgMap[t])}>
          <span className={cn("h-4 w-4", toneMap[t])}>{icon}</span>
        </div>
        <div className="min-w-0">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            {label}
          </div>
          {loading ? (
            <Loader2 className="mt-0.5 h-4 w-4 animate-spin text-muted-foreground" />
          ) : (
            <div className="mt-0.5 text-xl font-semibold tabular-nums leading-none">
              {typeof value === "number" ? value.toLocaleString() : value}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export function DashboardStatsRow() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/host/analytics/overview");
        if (!res.ok) return;
        const json = await res.json();
        if (cancelled) return;
        setStats({
          totalStreams: json.streams?.total ?? 0,
          activeSubscribers: json.subscribers?.active ?? 0,
          totalViewerSessions: json.streams?.totalViewerSessions ?? 0,
          publishedReplays: json.replays?.total ?? 0,
        });
      } catch {
        /* silent */
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
      <StatCard
        label="Total streams"
        value={stats?.totalStreams ?? 0}
        icon={<TrendingUp />}
        tone="primary"
        loading={loading}
      />
      <StatCard
        label="Subscribers"
        value={stats?.activeSubscribers ?? 0}
        icon={<Users />}
        tone="emerald"
        loading={loading}
      />
      <StatCard
        label="Total viewers"
        value={stats?.totalViewerSessions ?? 0}
        icon={<Eye />}
        tone="sky"
        loading={loading}
      />
      <StatCard
        label="Published replays"
        value={stats?.publishedReplays ?? 0}
        icon={<Film />}
        tone="violet"
        loading={loading}
      />
    </div>
  );
}
