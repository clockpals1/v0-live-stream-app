-- ─────────────────────────────────────────────────────────────────────────
-- 027_stream_branding_scenes.sql
--
-- Live Control Room — additive columns for the redesigned host studio.
--
-- 1. streams.scenes        jsonb  default '[]'
--    A list of saved scene presets the host can flip between live. Each
--    scene is a snapshot of producer state (overlay + ticker + music +
--    layout choice). Applying a scene re-uses the existing
--    overlay_*/ticker_*/overlay_music_* persistence and broadcast paths
--    — the column is just for storing the named presets so the host
--    doesn't have to retype them every show.
--
--    Element shape (validated client-side, NOT enforced by Postgres so
--    new fields can be added without a follow-up migration):
--      {
--        id: string,            -- uuid generated client-side
--        name: string,
--        layout: "solo" | "split" | "pip",
--        overlay: {
--          active: boolean,
--          message: string,
--          background: "dark" | "light" | "branded",
--          imageUrl: string
--        } | null,
--        ticker: {
--          active: boolean,
--          message: string,
--          speed: "slow" | "normal" | "fast",
--          style: "default" | "urgent" | "info"
--        } | null,
--        musicUrl: string | null,
--        createdAt: number      -- ms since epoch
--      }
--
-- 2. streams.branding      jsonb  default '{}'
--    Premium / branding settings that apply across the live stream.
--    Plan-gated in the UI but stored on the row regardless so a host
--    upgrading mid-show doesn't lose configuration. Shape:
--      {
--        watermarkUrl?: string,         -- premium: corner logo
--        watermarkPosition?: "tl"|"tr"|"bl"|"br",
--        watchPageTheme?: "default"|"minimal"|"branded",
--        accentColor?: string,          -- hex, e.g. "#1d4ed8"
--        layout?: "solo"|"split"|"pip"  -- current scene layout
--      }
--
-- Both columns default to safe empty values so existing rows don't need
-- a backfill. RLS is unchanged: the existing streams table policies
-- already gate read/write by ownership and operator/cohost role.
-- ─────────────────────────────────────────────────────────────────────────

ALTER TABLE public.streams
  ADD COLUMN IF NOT EXISTS scenes   jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS branding jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.streams.scenes
  IS 'Array of saved scene presets (overlay+ticker+music+layout snapshots) the host can apply live.';

COMMENT ON COLUMN public.streams.branding
  IS 'Premium branding settings (watermark, watch-page theme, layout). Plan-gated in the UI.';
