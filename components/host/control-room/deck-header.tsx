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
  /**
   * Optional right-side action node (button etc). Rendered next to the
   * title row, NOT next to the description, so a long description never
   * crowds it. Used by Scenes / Guests rails for "+ New" / "+ Invite".
   */
  action?: React.ReactNode;
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
export function DeckHeader({
  icon: Icon,
  title,
  description,
  status,
  action,
}: Props) {
  return (
    <div className="mb-3">
      {/* Title row: icon + title on the left, optional status / action on the
          right. Putting the action HERE (and not in a wrapping flex around
          the description) means a long description can wrap freely without
          fighting the right-side button for space. */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className={ICON_CHIP.primary}>
            <Icon className="w-4 h-4" />
          </span>
          <p className={`${TYPO.title} truncate`}>{title}</p>
        </div>
        <div className="shrink-0 flex items-center gap-1.5">
          {status && (
            <span
              className={`inline-flex items-center gap-1 h-6 px-2 rounded-full text-[10px] font-semibold uppercase tracking-[0.12em] ${
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
          {action}
        </div>
      </div>
      {/* Description is on its own line, indented to align with the title.
          Always full-width so any rail (even at 240px) can show it without
          truncation in most languages. */}
      <p className={`${TYPO.sub} mt-1 ml-[42px] leading-snug`}>
        {description}
      </p>
    </div>
  );
}
