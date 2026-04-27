"use client";

import { Button } from "@/components/ui/button";
import { Play, Square, Tv } from "lucide-react";
import { StreamTicker } from "@/components/stream/stream-ticker";
import { DeckHeader } from "@/components/host/control-room/deck-header";
import { TYPO } from "@/lib/control-room/styles";
import type { TickerPreset, TickerSpeed, TickerStyle } from "@/lib/control-room/types";

interface Props {
  ticker: TickerPreset;
  setActive: (v: boolean) => void;
  setMessage: (v: string) => void;
  setSpeed: (v: TickerSpeed) => void;
  setStyle: (v: TickerStyle) => void;
}

export function TickerDeck({
  ticker,
  setActive,
  setMessage,
  setSpeed,
  setStyle,
}: Props) {
  return (
    <div className="flex flex-col gap-3.5">
      <DeckHeader
        icon={Tv}
        title="Ticker"
        description="Breaking-news crawl across the bottom of viewers' screens."
        status={
          ticker.active ? { label: "Scrolling", tone: "live" } : undefined
        }
      />

      <textarea
        placeholder="e.g. BREAKING: Service starts at 10am AST • Prayer requests welcome…"
        value={ticker.message}
        onChange={(e) => setMessage(e.target.value)}
        maxLength={280}
        rows={2}
        className="w-full px-3 py-2 text-sm rounded-md border border-input bg-background/60 resize-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />

      <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-1.5">
            <span className={TYPO.label}>Speed</span>
            {(["slow", "normal", "fast"] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setSpeed(s)}
                className={`h-7 px-2.5 rounded-md text-[11px] capitalize font-medium ring-1 transition-all ${
                  ticker.speed === s
                    ? "ring-primary/60 ring-2 bg-primary/10 text-primary"
                    : "ring-border bg-background hover:ring-foreground/30"
                }`}
              >
                {s}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1.5">
            <span className={TYPO.label}>Style</span>
            {(["default", "urgent", "info"] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setStyle(s)}
                className={`h-7 px-2.5 rounded-md text-[11px] capitalize font-medium ring-1 transition-all text-white ${
                  ticker.style === s ? "ring-primary/60 ring-2" : "ring-transparent"
                }`}
                style={{
                  background:
                    s === "default"
                      ? "#0f172a"
                      : s === "urgent"
                        ? "linear-gradient(90deg, #dc2626, #ef4444)"
                        : "linear-gradient(90deg, #1d4ed8, #3b82f6)",
                }}
              >
                {s}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2 ml-auto">
          <span className="text-[10px] text-muted-foreground tabular-nums">
            {ticker.message.length}/280
          </span>
          {ticker.active ? (
            <Button size="sm" variant="destructive" onClick={() => setActive(false)} className="h-8">
              <Square className="w-3.5 h-3.5 mr-1.5 fill-current" />
              Stop
            </Button>
          ) : (
            <Button size="sm" onClick={() => setActive(true)} disabled={!ticker.message.trim()} className="h-8">
              <Play className="w-3.5 h-3.5 mr-1.5 fill-current" />
              Start ticker
            </Button>
          )}
        </div>
      </div>

      <div className="rounded-md overflow-hidden ring-1 ring-border bg-background">
        <StreamTicker
          active={ticker.active && !!ticker.message.trim()}
          message={ticker.message || " "}
          speed={ticker.speed}
          style={ticker.style}
        />
        {!ticker.active && (
          <p className="text-[11px] text-muted-foreground py-2 px-3 bg-muted/30 border-t border-border/60">
            Preview appears here when the ticker is running.
          </p>
        )}
      </div>
    </div>
  );
}
