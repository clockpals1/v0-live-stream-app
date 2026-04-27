"use client";

import {
  Send,
  Wifi,
  LayoutList,
  Calendar,
  BarChart2,
  CheckCircle2,
  Clock,
  AlertCircle,
  Youtube,
} from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import { ConnectionsTab } from "./connections-tab";
import type { YoutubeConnection } from "./connections-tab";
import { QueueTab } from "./queue-tab";
import { CalendarTab } from "./calendar-tab";

// ── Shared type — QueueItem ───────────────────────────────────────────
// Exported so queue-tab.tsx and calendar-tab.tsx can import it.

export interface QueueItem {
  id: string;
  title: string;
  body: string | null;
  platform: string;
  platform_meta: Record<string, unknown>;
  status: string;
  scheduled_for: string | null;
  published_at: string | null;
  platform_post_id: string | null;
  platform_post_url: string | null;
  attempt_count: number;
  last_error: string | null;
  last_attempt_at: string | null;
  ai_suggested_time: string | null;
  ai_suggestion_reason: string | null;
  asset_id: string | null;
  archive_id: string | null;
  created_at: string;
  updated_at: string;
}

// ── Insights ──────────────────────────────────────────────────────────

function InsightsTab({ items }: { items: QueueItem[] }) {
  const total     = items.length;
  const published = items.filter((i) => i.status === "published").length;
  const scheduled = items.filter((i) => i.status === "scheduled").length;
  const draft     = items.filter((i) => i.status === "draft").length;
  const failed    = items.filter((i) => i.status === "failed").length;

  const recentPublished = items
    .filter((i) => i.status === "published" && i.published_at)
    .sort((a, b) => new Date(b.published_at!).getTime() - new Date(a.published_at!).getTime())
    .slice(0, 5);

  const statCards = [
    { label: "Published",  value: published, icon: CheckCircle2, color: "text-emerald-600 dark:text-emerald-400", bg: "bg-emerald-500/10" },
    { label: "Scheduled",  value: scheduled, icon: Clock,        color: "text-violet-600 dark:text-violet-400",   bg: "bg-violet-500/10" },
    { label: "Drafts",     value: draft,     icon: LayoutList,   color: "text-muted-foreground",                   bg: "bg-muted" },
    { label: "Failed",     value: failed,    icon: AlertCircle,  color: "text-destructive",                        bg: "bg-destructive/10" },
  ];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {statCards.map(({ label, value, icon: Icon, color, bg }) => (
          <Card key={label}>
            <CardContent className="p-4">
              <div className={`mb-2 flex h-8 w-8 items-center justify-center rounded-lg ${bg}`}>
                <Icon className={`h-4 w-4 ${color}`} />
              </div>
              <div className="text-2xl font-semibold">{value}</div>
              <div className="text-xs text-muted-foreground">{label}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      {total === 0 && (
        <div className="rounded-xl border border-dashed border-border px-8 py-10 text-center">
          <BarChart2 className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
          <p className="text-sm font-medium">No publishing activity yet</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Add items to the queue and publish them to see insights here.
          </p>
        </div>
      )}

      {recentPublished.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold">Recently published</h3>
          {recentPublished.map((item) => (
            <div key={item.id}
              className="flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-muted">
                {item.platform === "youtube"
                  ? <Youtube className="h-3.5 w-3.5 text-rose-500" />
                  : <Send className="h-3.5 w-3.5 text-muted-foreground" />}
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{item.title}</div>
                <div className="text-[11px] text-muted-foreground capitalize">
                  {item.platform}
                  {item.published_at && (
                    <> · {new Date(item.published_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</>
                  )}
                </div>
              </div>
              {item.platform_post_url && (
                <a href={item.platform_post_url} target="_blank" rel="noreferrer"
                  className="shrink-0 text-xs text-muted-foreground hover:text-foreground hover:underline">
                  View ↗
                </a>
              )}
            </div>
          ))}
        </div>
      )}

      {total > 0 && (
        <div className="rounded-lg border border-border/60 bg-muted/20 px-4 py-3 text-xs text-muted-foreground leading-relaxed">
          <strong className="text-foreground">Publishing insights</strong> will grow richer as you
          publish more content. Platform-specific engagement data (views, likes, watch time) will be
          pulled once social platform analytics integrations are live.
        </div>
      )}
    </div>
  );
}

// ── Hub View ──────────────────────────────────────────────────────────

export interface PublishingHubProps {
  youtube: YoutubeConnection | null;
  youtubeServerConfigured: boolean;
  canYoutube: boolean;
  initialQueue: QueueItem[];
}

export function PublishingHubView({
  youtube,
  youtubeServerConfigured,
  canYoutube,
  initialQueue,
}: PublishingHubProps) {
  const scheduledCount = initialQueue.filter((i) => i.status === "scheduled").length;
  const draftCount     = initialQueue.filter((i) => i.status === "draft").length;

  return (
    <Tabs defaultValue="queue" className="w-full">
      <TabsList className="mb-6 grid w-full grid-cols-4 sm:w-auto sm:inline-grid">
        <TabsTrigger value="connections" className="gap-1.5 text-xs sm:text-sm">
          <Wifi className="h-3.5 w-3.5" />
          <span>Connections</span>
          {youtube && <span className="hidden sm:inline ml-0.5 h-1.5 w-1.5 rounded-full bg-emerald-500" />}
        </TabsTrigger>
        <TabsTrigger value="queue" className="gap-1.5 text-xs sm:text-sm">
          <LayoutList className="h-3.5 w-3.5" />
          <span>Queue</span>
          {(scheduledCount + draftCount) > 0 && (
            <span className="ml-0.5 rounded-full bg-primary/15 px-1 text-[10px] font-medium text-primary">
              {scheduledCount + draftCount}
            </span>
          )}
        </TabsTrigger>
        <TabsTrigger value="calendar" className="gap-1.5 text-xs sm:text-sm">
          <Calendar className="h-3.5 w-3.5" />
          <span>Calendar</span>
        </TabsTrigger>
        <TabsTrigger value="insights" className="gap-1.5 text-xs sm:text-sm">
          <BarChart2 className="h-3.5 w-3.5" />
          <span>Insights</span>
        </TabsTrigger>
      </TabsList>

      <TabsContent value="connections">
        <ConnectionsTab
          youtube={youtube}
          youtubeServerConfigured={youtubeServerConfigured}
          canYoutube={canYoutube}
        />
      </TabsContent>

      <TabsContent value="queue">
        <QueueTab
          initialItems={initialQueue}
          youtubeConnected={youtube !== null}
        />
      </TabsContent>

      <TabsContent value="calendar">
        <CalendarTab items={initialQueue} platform="youtube" />
      </TabsContent>

      <TabsContent value="insights">
        <InsightsTab items={initialQueue} />
      </TabsContent>
    </Tabs>
  );
}
