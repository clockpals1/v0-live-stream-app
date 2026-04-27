/**
 * Live Control Room — design tokens.
 *
 * Plain string constants instead of CSS-in-JS so Tailwind's JIT compiler
 * statically picks up every utility. Importing these at the top of a
 * component is the *only* approved way to opt into a control-room
 * surface — it keeps visuals consistent across decks without dragging
 * in an extra abstraction.
 *
 * Surface ladder (in increasing visual weight):
 *
 *   INLINE  — buttons, inline cards inside a panel. Flat, no shadow.
 *   PANEL   — module / deck card. Subtle gradient + border + sm shadow.
 *   STAGE   — hero surfaces (program preview, stage actions). Heavier
 *             ring + md shadow. Reserved for the program zone.
 *   ACCENT  — same shape as PANEL but with primary-tinted ring + inner
 *             highlight. Used when a panel is in an "active" state
 *             (e.g. overlay deck while overlay is showing live).
 *
 * Typography scale:
 *   - LABEL  : 10px uppercase tracking, muted. Section / metric labels.
 *   - TITLE  : 13px semibold foreground. Module names.
 *   - SUB    : 11px muted. One-liner descriptions under titles.
 *   - METRIC : 18px tabular-nums. Big numbers in health deck etc.
 */

export const SURFACE = {
  inline:
    "bg-card border border-border/60 rounded-md",
  panel:
    "bg-gradient-to-b from-card to-card/95 border border-border/60 rounded-xl shadow-sm shadow-black/[0.03] dark:shadow-black/30",
  stage:
    "bg-gradient-to-b from-card to-card/95 border border-border/70 rounded-xl shadow-md shadow-black/[0.06] ring-1 ring-black/[0.03] dark:ring-white/[0.04]",
  accent:
    "bg-gradient-to-b from-primary/[0.04] to-card border border-primary/30 rounded-xl shadow-sm ring-1 ring-primary/15",
} as const;

export const TYPO = {
  label: "text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground",
  title: "text-[13px] font-semibold text-foreground tracking-tight",
  sub: "text-[11px] text-muted-foreground",
  metric: "text-lg font-semibold tabular-nums text-foreground",
} as const;

/**
 * Icon chip — the gradient square that lives next to every section
 * title. Two flavours:
 *   - PRIMARY  : module headers (Overlay, Ticker, Music, …)
 *   - MUTED    : status / informational (Stream health idle state)
 */
export const ICON_CHIP = {
  primary:
    "h-8 w-8 rounded-lg bg-gradient-to-br from-primary/25 via-primary/15 to-primary/5 ring-1 ring-primary/25 flex items-center justify-center text-primary shrink-0",
  muted:
    "h-8 w-8 rounded-lg bg-muted ring-1 ring-border flex items-center justify-center text-muted-foreground shrink-0",
} as const;

/**
 * Live status pill (the pulsing one). Emits its own aura so the eye
 * catches it before the rest of the topbar.
 */
export const LIVE_PILL =
  "inline-flex items-center gap-1.5 px-2 h-6 rounded-full text-[11px] font-semibold text-white bg-gradient-to-r from-red-500 to-rose-500 shadow-[0_0_0_3px_rgba(239,68,68,0.18)] animate-pulse";
