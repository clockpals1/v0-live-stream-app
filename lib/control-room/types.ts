/**
 * Live Control Room — shared types.
 *
 * Mirrors the shapes documented in migrations/027_stream_branding_scenes.sql.
 * Postgres stores these as jsonb — Postgres doesn't enforce shape, so the
 * client is the only validator. Adding a new optional field never breaks
 * the migration.
 */

export type SceneLayout = "solo" | "split" | "pip";
export type OverlayBackground = "dark" | "light" | "branded";
export type TickerSpeed = "slow" | "normal" | "fast";
export type TickerStyle = "default" | "urgent" | "info";

export interface OverlayPreset {
  active: boolean;
  message: string;
  background: OverlayBackground;
  imageUrl: string;
}

export interface TickerPreset {
  active: boolean;
  message: string;
  speed: TickerSpeed;
  style: TickerStyle;
}

export interface Scene {
  id: string;
  name: string;
  layout: SceneLayout;
  overlay: OverlayPreset | null;
  ticker: TickerPreset | null;
  /** R2 / public URL of an audio file to play on overlay channel. Null = no music. */
  musicUrl: string | null;
  createdAt: number;
}

export type WatermarkPosition = "tl" | "tr" | "bl" | "br";

export interface BrandingConfig {
  watermarkUrl?: string | null;
  watermarkPosition?: WatermarkPosition;
  watchPageTheme?: "default" | "minimal" | "branded";
  accentColor?: string | null;
  layout?: SceneLayout;
}

/**
 * Compose a Scene from the current live producer state. Used when the
 * host clicks "Save current as scene".
 */
export function captureScene(args: {
  name: string;
  layout: SceneLayout;
  overlay: OverlayPreset | null;
  ticker: TickerPreset | null;
  musicUrl: string | null;
}): Scene {
  return {
    id:
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `s_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    name: args.name.slice(0, 60) || "Untitled scene",
    layout: args.layout,
    overlay: args.overlay,
    ticker: args.ticker,
    musicUrl: args.musicUrl,
    createdAt: Date.now(),
  };
}
