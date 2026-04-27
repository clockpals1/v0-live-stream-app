"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Film, Eye, Heart, ArrowRight, Loader2 } from "lucide-react";

interface ReplayRow {
  id: string;
  slug: string;
  title: string;
  view_count: number;
  like_count: number;
  comment_count: number;
  published_at: string | null;
}

function fmt(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

export function RecentReplaysWidget() {
  const [replays, setReplays] = useState<ReplayRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/host/analytics/overview");
        if (!res.ok) return;
        const json = await res.json();
        if (cancelled) return;
        setReplays((json.topReplays ?? []).slice(0, 3).map((r: {title: string; views: number; likes: number; comments: number}, i: number) => ({
          id: String(i),
          slug: "",
          title: r.title,
          view_count: r.views,
          like_count: r.likes,
          comment_count: r.comments,
          published_at: null,
        })));
      } catch {
        /* silent */
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Film className="h-4 w-4 text-violet-500" />
          Recent Replays
        </CardTitle>
        <Button asChild variant="ghost" size="sm" className="h-7 gap-1 text-xs">
          <a href="https://studio.isunday.me/replay">
            Library <ArrowRight className="h-3 w-3" />
          </a>
        </Button>
      </CardHeader>
      <CardContent className="pt-0">
        {loading ? (
          <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading…
          </div>
        ) : replays.length === 0 ? (
          <div className="py-4 text-center text-sm text-muted-foreground">
            No published replays yet.{" "}
            <a
              href="https://studio.isunday.me/replay"
              className="text-primary hover:underline"
            >
              Publish one →
            </a>
          </div>
        ) : (
          <ul className="space-y-2">
            {replays.map((r, i) => (
              <li key={i} className="flex items-start justify-between gap-3 rounded-lg border border-border bg-muted/30 px-3 py-2">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{r.title}</div>
                  <div className="mt-0.5 flex items-center gap-3 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <Eye className="h-3 w-3" />
                      {r.view_count.toLocaleString()}
                    </span>
                    <span className="flex items-center gap-1">
                      <Heart className="h-3 w-3" />
                      {r.like_count}
                    </span>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
