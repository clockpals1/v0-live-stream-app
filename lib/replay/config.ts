/**
 * Feature flags for the section-replay subsystem.
 *
 * SAFETY MODEL
 * ------------
 * Everything in lib/replay/* and components/host/replay-panel.tsx is gated
 * by these flags. With the defaults below, ZERO new code paths execute on
 * the live host page — the system behaves identically to pre-replay code.
 *
 * To enable in a deployment, set in .env.production:
 *
 *   NEXT_PUBLIC_REPLAY_ENABLED=true
 *   NEXT_PUBLIC_REPLAY_LOCAL_EXPORT_ENABLED=true
 *
 * These are intentionally NEXT_PUBLIC_* so they are inlined at build time
 * and there is no runtime fetch / no failure mode that could leave the
 * flag stuck in a partial-on state.
 *
 * ROLLBACK
 * --------
 * Flip NEXT_PUBLIC_REPLAY_ENABLED back to "false" (or unset) and redeploy.
 * No DB migration to reverse, no storage to clean up, no background jobs
 * to drain. The host UI loses the Replay tab on next page load.
 */

const truthy = (raw: string | undefined): boolean =>
  raw === "true" || raw === "1" || raw === "yes";

/** Master switch. When false, no replay UI renders and no recorder is created. */
export const REPLAY_ENABLED: boolean = truthy(
  process.env.NEXT_PUBLIC_REPLAY_ENABLED
);

/**
 * Whether the host can save a finalised section to their local drive.
 * The actual save mechanism (File System Access API vs. anchor-download)
 * is chosen at runtime based on browser support — this flag only controls
 * whether the export button is rendered at all.
 */
export const REPLAY_LOCAL_EXPORT_ENABLED: boolean = truthy(
  process.env.NEXT_PUBLIC_REPLAY_LOCAL_EXPORT_ENABLED ?? "true"
);

/**
 * Soft advisory limit, in minutes. When a section exceeds this duration
 * the UI gently suggests the host mark a section break to keep blob sizes
 * manageable (in-memory replay is bound by available browser memory).
 * Not enforced — the host can ignore it.
 */
export const REPLAY_MAX_SECTION_MINUTES: number = (() => {
  const n = parseInt(
    process.env.NEXT_PUBLIC_REPLAY_MAX_SECTION_MINUTES ?? "60",
    10
  );
  return Number.isFinite(n) && n > 0 ? n : 60;
})();
