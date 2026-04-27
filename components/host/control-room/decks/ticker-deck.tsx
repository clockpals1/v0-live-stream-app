"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Play, Square, Tv } from "lucide-react";
import { StreamTicker } from "@/components/stream/stream-ticker";
import type { TickerPreset, TickerSpeed, TickerStyle } from "@/lib/control-room/types";

interface Props {
  ticker: TickerPreset;
  setActive: (v: boolean) => void;
  setMessage: (v: string) => void;
  setSpeed: (v: TickerSpeed) => void;
  setStyle: (v: TickerStyle) => void;
}

/**
 * Ticker deck — breaking-news-style scrolling crawl.
 *
 * Includes a WYSIWYG preview that mirrors the live ticker so the host
 * can verify speed + style before going live with it.
 */
export function TickerDeck({
  ticker,
  setActive,
  setMessage,
  setSpeed,
  setStyle,
}: Props) {
  return (
    <Card>
      <CardHeader className="pb-3 border-b">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
              <Tv className="w-4 h-4 text-primary" />
            </div>
            <div className="min-w-0">
              <CardTitle className="text-sm font-semibold">Ticker</CardTitle>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                Breaking-news crawl across the bottom of viewers&apos; screens.
              </p>
            </div>
          </div>
          {ticker.active && (
            <Badge className="bg-green-500 text-white text-[10px] h-5 px-1.5 shrink-0">
              SCROLLING
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <textarea
          placeholder="e.g. BREAKING: Service starts at 10am AST • Prayer requests welcome..."
          value={ticker.message}
          onChange={(e) => setMessage(e.target.value)}
          maxLength={280}
          rows={2}
          className="w-full px-3 py-2 text-sm rounded-md border border-input bg-background resize-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex items-center gap-1">
              <span className="text-xs text-muted-foreground mr-1">Speed:</span>
              {(["slow", "normal", "fast"] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setSpeed(s)}
                  className={`h-7 px-2.5 rounded-md border text-xs capitalize transition-all ${
                    ticker.speed === s
                      ? "border-primary ring-2 ring-primary/30 bg-primary/10"
                      : "border-border hover:border-foreground/30"
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-1">
              <span className="text-xs text-muted-foreground mr-1">Style:</span>
              {(["default", "urgent", "info"] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setStyle(s)}
                  className={`h-7 px-2.5 rounded-md border text-xs capitalize transition-all ${
                    ticker.style === s
                      ? "border-primary ring-2 ring-primary/30"
                      : "border-border hover:border-foreground/30"
                  }`}
                  style={{
                    background:
                      s === "default"
                        ? "#111827"
                        : s === "urgent"
                          ? "#dc2626"
                          : "#1d4ed8",
                    color: "#fff",
                  }}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-2 ml-auto">
            <span className="text-[11px] text-muted-foreground tabular-nums">
              {ticker.message.length}/280
            </span>
            {ticker.active ? (
              <Button size="sm" variant="destructive" onClick={() => setActive(false)}>
                <Square className="w-4 h-4 mr-1.5" />
                Stop Ticker
              </Button>
            ) : (
              <Button size="sm" onClick={() => setActive(true)} disabled={!ticker.message.trim()}>
                <Play className="w-4 h-4 mr-1.5" />
                Start Ticker
              </Button>
            )}
          </div>
        </div>
        <div className="rounded-md overflow-hidden border border-border">
          <StreamTicker
            active={ticker.active && !!ticker.message.trim()}
            message={ticker.message || " "}
            speed={ticker.speed}
            style={ticker.style}
          />
          {!ticker.active && (
            <p className="text-[11px] text-muted-foreground py-2 px-3 bg-muted/30">
              Preview appears here when the ticker is running.
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
