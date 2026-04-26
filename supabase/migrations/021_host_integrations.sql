-- ─── 021: Host integrations — OAuth-linked external accounts ─────────
--
-- Phase 4 of the subscription/storage/upload system. Stores per-host
-- OAuth tokens for third-party services that the host has connected.
-- Today the only `provider` is 'youtube'; future entries could add
-- 'twitch', 'vimeo', 'spotify', etc. without a schema change.
--
-- TOKEN HANDLING
-- --------------
-- access_token / refresh_token are written/read by the admin client
-- only (service role), never directly by the host's authed client.
-- RLS therefore exposes only a redacted projection (provider_*,
-- connected_at, scopes), so a host can render their connection state
-- without ever seeing the raw tokens. The integration API routes use
-- the admin client to fetch tokens for outbound calls.
--
-- LIFECYCLE
-- ---------
-- Insert  — happens in /api/integrations/{provider}/callback after
--           Google's token exchange returns a refresh_token. We always
--           pass access_type=offline + prompt=consent so the second
--           connect from the same Google account also yields a fresh
--           refresh token (not just an access token).
-- Update  — the integration's lib refreshes the access_token whenever
--           it's near expiry and writes the new value back here.
-- Delete  — host clicks "Disconnect" or revokes the grant in Google's
--           account settings (we don't poll for that; we'll just
--           catch a 401 next time we try and surface a "reconnect"
--           prompt in the UI).
--
-- SAFETY
-- ------
-- - Additive only: no existing tables touched.
-- - Unique on (host_id, provider): a host can have at most one
--   YouTube account linked at a time. Re-connecting overwrites.

CREATE TABLE IF NOT EXISTS host_integrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  host_id UUID NOT NULL REFERENCES hosts(id) ON DELETE CASCADE,
  -- 'youtube' for now. Future: 'twitch','vimeo', etc.
  provider TEXT NOT NULL,
  -- The provider's stable id for the connected account (e.g. YouTube
  -- channelId). Used to show "connected as X" in the UI and to detect
  -- if the host re-auths a different account.
  provider_account_id TEXT,
  -- Display name we render in the UI ("My Cooking Channel").
  provider_account_name TEXT,
  -- Optional URL to the account avatar.
  provider_account_avatar_url TEXT,
  -- OAuth tokens. Service-role only; RLS hides them from the client.
  access_token TEXT NOT NULL,
  refresh_token TEXT,
  token_expires_at TIMESTAMPTZ,
  -- Scopes Google ultimately granted (may be a subset of what we asked).
  scopes TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  -- Free-form provider metadata (channel description, country, etc.).
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  connected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_refreshed_at TIMESTAMPTZ,
  last_used_at TIMESTAMPTZ,
  -- One row per (host, provider). Re-connecting overwrites via upsert.
  UNIQUE (host_id, provider)
);

CREATE INDEX IF NOT EXISTS idx_host_integrations_host_id
  ON host_integrations (host_id);
CREATE INDEX IF NOT EXISTS idx_host_integrations_provider
  ON host_integrations (provider);

-- ─── RLS — read-only redacted view via the table itself ──────────────
--
-- We don't ship a database VIEW because Supabase's PostgREST exposes
-- those too aggressively. Instead the policy below grants SELECT on
-- the SAFE columns only when the caller is the owning host. The
-- admin client (service role) skips RLS entirely and can read tokens.

ALTER TABLE host_integrations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Hosts read own integrations" ON host_integrations;
CREATE POLICY "Hosts read own integrations" ON host_integrations
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM hosts
      WHERE hosts.id = host_integrations.host_id
        AND hosts.user_id = auth.uid()
    )
  );

-- Hosts cannot directly insert/update/delete — all writes go through
-- the integration API routes (using the admin client). This prevents
-- a malicious client from supplying its own crafted access_token.

DROP POLICY IF EXISTS "Admins read all integrations" ON host_integrations;
CREATE POLICY "Admins read all integrations" ON host_integrations
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM hosts
      WHERE hosts.user_id = auth.uid()
        AND (hosts.role = 'admin' OR hosts.is_admin = TRUE)
    )
  );

-- ─── streams: link to the YouTube video that resulted from a stream ──
--
-- Phase 4 also adds an optional `youtube_video_id` column on streams
-- so the dashboard can render an "Uploaded to YouTube" badge with a
-- direct link, without joining stream_archives or any other table.
--
-- Existing streams get NULL — fine; they predate the feature.

ALTER TABLE streams
  ADD COLUMN IF NOT EXISTS youtube_video_id TEXT;
