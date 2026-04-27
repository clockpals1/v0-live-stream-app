"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight, Sparkles, Youtube, Send, Loader2, Calendar } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { QueueItem } from "./hub-view";

interface Suggestion {
  suggested_time: string;
  score: number;
  reason: string;
}

function startOfWeek(date: Date): Date {
  const d = new Date(date);
  const day = d.getUTCDay();
  d.setUTCDate(d.getUTCDate() - day);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

function addDays(date: Date, n: number): Date {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + n);
  return d;
}

function isSameDay(a: Date, b: Date): boolean {
  return a.getUTCFullYear() === b.getUTCFullYear() &&
    a.getUTCMonth() === b.getUTCMonth() &&
    a.getUTCDate() === b.getUTCDate();
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

function fmtMonthDay(d: Date): string {
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function platformIcon(platform: string) {
  if (platform === "youtube") return <Youtube className="h-3 w-3 text-rose-500" />;
  return <Send className="h-3 w-3 text-muted-foreground" />;
}

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function CalendarTab({ items, platform = "youtube" }: { items: QueueItem[]; platform?: string }) {
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()));
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);

  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

  const scheduledItems = items.filter(
    (i) => i.scheduled_for && (i.status === "scheduled" || i.status === "approved"),
  );

  function itemsForDay(day: Date): QueueItem[] {
    return scheduledItems.filter((i) => {
      if (!i.scheduled_for) return false;
      return isSameDay(new Date(i.scheduled_for), day);
    });
  }

  function suggestionsForDay(day: Date): Suggestion[] {
    return suggestions.filter((s) => isSameDay(new Date(s.suggested_time), day));
  }

  const handleGetSuggestions = async () => {
    setLoadingSuggestions(true);
    try {
      const res = await fetch(`/api/ai/publish/schedule/suggest?platform=${platform}`);
      const json = await res.json();
      if (!res.ok) { toast.error(json.error ?? "Failed to load suggestions"); return; }
      setSuggestions(json.suggestions ?? []);
      if ((json.suggestions ?? []).length === 0) {
        toast.info("No suggestions available for this week — try again next week.");
      }
    } catch {
      toast.error("Network error loading suggestions");
    } finally {
      setLoadingSuggestions(false);
    }
  };

  const weekLabel = `${fmtMonthDay(weekStart)} – ${fmtMonthDay(addDays(weekStart, 6))}`;
  const today = new Date();

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="h-8 w-8 p-0"
            onClick={() => setWeekStart((d) => addDays(d, -7))}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-sm font-medium min-w-[160px] text-center">{weekLabel}</span>
          <Button variant="outline" size="sm" className="h-8 w-8 p-0"
            onClick={() => setWeekStart((d) => addDays(d, 7))}>
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="sm" className="h-8 text-xs text-muted-foreground"
            onClick={() => setWeekStart(startOfWeek(new Date()))}>
            Today
          </Button>
        </div>
        <Button variant="outline" size="sm" className="h-8 gap-1.5 border-violet-300 text-violet-700 hover:bg-violet-50 dark:border-violet-700 dark:text-violet-300 dark:hover:bg-violet-950"
          onClick={handleGetSuggestions} disabled={loadingSuggestions}>
          {loadingSuggestions
            ? <><Loader2 className="h-3.5 w-3.5 animate-spin" />Analyzing…</>
            : <><Sparkles className="h-3.5 w-3.5" />AI suggest times</>}
        </Button>
      </div>

      {/* AI suggestions banner */}
      {suggestions.length > 0 && (
        <div className="rounded-lg border border-violet-200/60 bg-violet-50/60 px-4 py-3 dark:border-violet-800/40 dark:bg-violet-950/20">
          <p className="mb-2 text-xs font-medium text-violet-700 dark:text-violet-300 flex items-center gap-1.5">
            <Sparkles className="h-3.5 w-3.5" />
            AI scheduling suggestions (UTC) — based on your stream history
          </p>
          <div className="flex flex-wrap gap-2">
            {suggestions.map((s) => (
              <div key={s.suggested_time} title={s.reason}
                className="flex items-center gap-1.5 rounded-md border border-violet-200 bg-white px-2.5 py-1 text-[11px] dark:border-violet-800 dark:bg-violet-950/40">
                <Sparkles className="h-3 w-3 text-violet-500" />
                <span className="font-medium">
                  {new Date(s.suggested_time).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}
                </span>
                <span className="text-muted-foreground">{fmtTime(s.suggested_time)} UTC</span>
                <Badge variant="outline" className="h-4 border-violet-300 px-1 text-[9px] text-violet-600">
                  {s.score}
                </Badge>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Weekly grid */}
      <div className="overflow-x-auto">
        <div className="grid min-w-[600px] grid-cols-7 gap-1">
          {/* Day headers */}
          {days.map((day, i) => {
            const isToday = isSameDay(day, today);
            return (
              <div key={i} className={cn(
                "rounded-md px-2 py-1.5 text-center",
                isToday ? "bg-primary/10" : "bg-muted/40",
              )}>
                <div className={cn("text-[10px] font-medium uppercase tracking-wide",
                  isToday ? "text-primary" : "text-muted-foreground")}>
                  {DAY_LABELS[day.getUTCDay()]}
                </div>
                <div className={cn("text-sm font-semibold",
                  isToday ? "text-primary" : "text-foreground")}>
                  {day.getUTCDate()}
                </div>
              </div>
            );
          })}

          {/* Day cells */}
          {days.map((day, i) => {
            const dayItems = itemsForDay(day);
            const daySuggestions = suggestionsForDay(day);
            return (
              <div key={i} className="min-h-[120px] rounded-lg border border-border/60 p-1.5 space-y-1">
                {dayItems.map((item) => (
                  <div key={item.id}
                    className="flex items-center gap-1 rounded-md border border-border bg-card px-2 py-1">
                    {platformIcon(item.platform)}
                    <span className="truncate text-[10px] font-medium leading-tight">{item.title}</span>
                    {item.scheduled_for && (
                      <span className="shrink-0 text-[9px] text-muted-foreground">{fmtTime(item.scheduled_for)}</span>
                    )}
                  </div>
                ))}
                {daySuggestions.map((s, si) => (
                  <div key={si}
                    className="flex items-center gap-1 rounded-md border border-dashed border-violet-300/60 bg-violet-50/40 px-2 py-1 dark:border-violet-700/40 dark:bg-violet-950/20">
                    <Sparkles className="h-3 w-3 shrink-0 text-violet-400" />
                    <span className="text-[9px] text-violet-600 dark:text-violet-400">
                      {fmtTime(s.suggested_time)} UTC
                    </span>
                  </div>
                ))}
                {dayItems.length === 0 && daySuggestions.length === 0 && (
                  <div className="flex h-full items-center justify-center pt-4">
                    <Calendar className="h-4 w-4 text-border" />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <p className="text-[11px] text-muted-foreground">
        Calendar shows items with status <em>scheduled</em> or <em>approved</em>.
        AI suggestions are shown as dashed cards — add them to the queue to schedule.
        All times are UTC.
      </p>
    </div>
  );
}
