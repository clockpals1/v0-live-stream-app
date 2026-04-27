"use client";

import { useState } from "react";
import {
  Activity,
  Image as ImageIcon,
  Megaphone,
  Music2,
  Sparkles,
  Tv,
  type LucideIcon,
} from "lucide-react";
import { SURFACE, TYPO } from "@/lib/control-room/styles";

interface Props {
  overlayDeck: React.ReactNode;
  tickerDeck: React.ReactNode;
  musicDeck: React.ReactNode;
  mediaDeck: React.ReactNode;
  brandingDeck: React.ReactNode;
  healthDeck: React.ReactNode;
}

type DeckKey = "overlay" | "ticker" | "music" | "media" | "branding" | "health";

const DECKS: ReadonlyArray<{ key: DeckKey; label: string; icon: LucideIcon }> = [
  { key: "overlay", label: "Overlay", icon: Megaphone },
  { key: "ticker", label: "Ticker", icon: Tv },
  { key: "music", label: "Music", icon: Music2 },
  { key: "media", label: "Media", icon: ImageIcon },
  { key: "branding", label: "Branding", icon: Sparkles },
  { key: "health", label: "Health", icon: Activity },
];

/**
 * Producer Deck — replaces a shadcn Tabs component with a custom
 * segmented studio switcher. Why custom:
 *
 *   - The default Tabs shows a flat list of buttons. Production
 *     consoles signal which tool you're in with a *colored bar* and
 *     an icon shift, not just a text underline.
 *   - We want the active deck label to read like "OVERLAY" in a
 *     module header strip, not like a tab title — establishes that
 *     each deck IS a module, not a sub-page.
 *   - The active indicator is a gradient bar above the row, drawing
 *     the eye downward into the deck content.
 */
export function ProducerDeck({
  overlayDeck,
  tickerDeck,
  musicDeck,
  mediaDeck,
  brandingDeck,
  healthDeck,
}: Props) {
  const [active, setActive] = useState<DeckKey>("overlay");
  const activeMeta = DECKS.find((d) => d.key === active)!;

  const renderActive = () => {
    switch (active) {
      case "overlay": return overlayDeck;
      case "ticker": return tickerDeck;
      case "music": return musicDeck;
      case "media": return mediaDeck;
      case "branding": return brandingDeck;
      case "health": return healthDeck;
    }
  };

  return (
    <section className={`${SURFACE.panel} overflow-hidden`}>
      {/* Module header strip */}
      <div className="px-4 sm:px-5 pt-3.5 pb-3 flex items-center justify-between gap-3 border-b border-border/60">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="h-7 w-7 rounded-md bg-gradient-to-br from-primary/25 via-primary/15 to-primary/5 ring-1 ring-primary/25 flex items-center justify-center text-primary shrink-0">
            <activeMeta.icon className="w-3.5 h-3.5" />
          </span>
          <div className="min-w-0">
            <p className={TYPO.label}>Producer Deck</p>
            <p className={`${TYPO.title} -mt-0.5`}>{activeMeta.label}</p>
          </div>
        </div>
      </div>

      {/* Segmented switcher.
          Uses flex-wrap (not overflow-x-auto) so on a narrow column the
          tabs reflow into a second row instead of leaving a horizontal
          scrollbar. Every tab keeps a min-width so labels never crop. */}
      <div className="px-3 sm:px-4 pt-3">
        <div className="flex flex-wrap items-center gap-1 p-1 bg-muted/50 rounded-lg ring-1 ring-border/60">
          {DECKS.map((d) => {
            const isActive = d.key === active;
            const Icon = d.icon;
            return (
              <button
                key={d.key}
                type="button"
                onClick={() => setActive(d.key)}
                className={`flex-1 min-w-[88px] inline-flex items-center justify-center gap-1.5 h-8 px-3 rounded-md text-[11px] sm:text-xs font-medium transition-colors ${
                  isActive
                    ? "bg-background text-foreground shadow-sm ring-1 ring-border/70"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{d.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Active deck */}
      <div className="px-3 sm:px-4 py-3 sm:py-4">{renderActive()}</div>
    </section>
  );
}
