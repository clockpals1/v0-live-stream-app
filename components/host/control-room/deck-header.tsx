"use client";

import type { LucideIcon } from "lucide-react";
import { ICON_CHIP, TYPO } from "@/lib/control-room/styles";

interface Props {
  icon: LucideIcon;
  title: string;
  description: string;
  /** Optional right-side chip — e.g. "LIVE ON SCREEN" while overlay is showing. */
  status?: {
    label: string;
    /** Tailwind tone — defaults to emerald for ACTIVE, amber for STAGING, etc. */
    tone?: "live" | "ok" | "warn" | "muted";
  };
}

const TONE_CLASS: Record<NonNullable<Props["status"]>["tone"] & string, string> = {
  live: "bg-gradient-to-r from-emerald-500 to-emerald-600 text-white shadow-[0_0_0_3px_rgba(16,185,129,0.18)]",
  ok: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 ring-1 ring-emerald-500/30",
  warn: "bg-amber-500/15 text-amber-700 dark:text-amber-300 ring-1 ring-amber-500/30",
  muted: "bg-muted text-muted-foreground ring-1 ring-border",
};

/**
 * Compact, consistent header for every deck (overlay / ticker / music
 * / media / branding / health) and rail card (scenes / guests).
 *
 * Three jobs:
 *   1. Show a gradient icon chip so each module is identifiable at a
 *      glance even when collapsed inside a sea of identical cards.
 *   2. Pair a tracking-tight TITLE with a small SUBTITLE on a single
 *      line to compress vertical space — every deck used to spend
 *      ~64px on its header alone.
 *   3. Optional STATUS pill (right) for "currently broadcasting"
 *      affordances like "LIVE ON SCREEN" or "PLAYING LIVE".
 */
export function DeckHeader({ icon: Icon, title, description, status }: Props) {
  return (
    <div className="flex items-start justify-between gap-3 mb-3">
      <div className="flex items-center gap-2.5 min-w-0">
        <span className={ICON_CHIP.primary}>
          <Icon className="w-4 h-4" />
        </span>
        <div className="min-w-0 leading-tight">
          <p className={TYPO.title}>{title}</p>
          <p className={`${TYPO.sub} truncate`}>{description}</p>
        </div>
      </div>
      {status && (
        <span
          className={`shrink-0 inline-flex items-center gap-1 h-6 px-2 rounded-full text-[10px] font-semibold uppercase tracking-[0.12em] ${
            TONE_CLASS[status.tone ?? "live"]
          }`}
        >
          {status.tone !== "muted" && (
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full rounded-full bg-current opacity-60 animate-ping" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-current" />
            </span>
          )}
          {status.label}
        </span>
      )}
    </div>
  );
}
