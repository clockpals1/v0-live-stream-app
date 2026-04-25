-- 018_insider_circle.sql
-- Insider Circle: per-host email subscriber list + broadcast history.
-- Viewers can subscribe from a host's live stream page. The host can
-- later compose and send rich-HTML email updates to their own list.
--
-- Architecture
--   * Subscribers and broadcasts are isolated PER HOST (host_id FK with
--     ON DELETE CASCADE). One host's list is invisible to every other host.
--   * RLS lets a host SELECT only their own rows. All writes come from
--     server-side endpoints using the service role (anon viewers POST to
--     /api/insider/subscribe; authenticated hosts POST to /api/insider/broadcast).
--   * Each subscriber row carries a per-row unsubscribe_token used in the
--     mailto unsubscribe footer link, so a leaked token only unsubscribes
--     one address from one host.
--
-- This migration is additive. It does not modify existing tables.

-- ─── Subscribers ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS host_subscribers (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  host_id             uuid NOT NULL REFERENCES hosts(id) ON DELETE CASCADE,
  email               text NOT NULL,
  source_room_code    text,
  unsubscribe_token   text NOT NULL DEFAULT replace(gen_random_uuid()::text, '-', ''),
  is_active           boolean NOT NULL DEFAULT true,
  created_at          timestamptz NOT NULL DEFAULT now(),
  unsubscribed_at     timestamptz,
  CONSTRAINT host_subscribers_email_per_host UNIQUE (host_id, email)
);

CREATE INDEX IF NOT EXISTS idx_host_subs_host_active
  ON host_subscribers(host_id) WHERE is_active = true;

CREATE UNIQUE INDEX IF NOT EXISTS idx_host_subs_token
  ON host_subscribers(unsubscribe_token);

-- ─── Broadcasts ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS host_broadcasts (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  host_id           uuid NOT NULL REFERENCES hosts(id) ON DELETE CASCADE,
  subject           text NOT NULL,
  html_body         text NOT NULL,
  recipient_count   int NOT NULL DEFAULT 0,
  sent_count        int NOT NULL DEFAULT 0,
  failed_count      int NOT NULL DEFAULT 0,
  status            text NOT NULL DEFAULT 'sending'
                    CHECK (status IN ('sending','sent','failed','partial')),
  created_at        timestamptz NOT NULL DEFAULT now(),
  sent_at           timestamptz
);

CREATE INDEX IF NOT EXISTS idx_host_broadcasts_host
  ON host_broadcasts(host_id, created_at DESC);

-- ─── RLS ────────────────────────────────────────────────────────────────
ALTER TABLE host_subscribers ENABLE ROW LEVEL SECURITY;
ALTER TABLE host_broadcasts  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS host_subscribers_select_own ON host_subscribers;
CREATE POLICY host_subscribers_select_own ON host_subscribers
  FOR SELECT USING (
    host_id IN (SELECT id FROM hosts WHERE user_id = auth.uid())
  );

DROP POLICY IF EXISTS host_subscribers_select_admin ON host_subscribers;
CREATE POLICY host_subscribers_select_admin ON host_subscribers
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM hosts WHERE user_id = auth.uid() AND is_admin = true)
  );

DROP POLICY IF EXISTS host_broadcasts_select_own ON host_broadcasts;
CREATE POLICY host_broadcasts_select_own ON host_broadcasts
  FOR SELECT USING (
    host_id IN (SELECT id FROM hosts WHERE user_id = auth.uid())
  );

DROP POLICY IF EXISTS host_broadcasts_select_admin ON host_broadcasts;
CREATE POLICY host_broadcasts_select_admin ON host_broadcasts
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM hosts WHERE user_id = auth.uid() AND is_admin = true)
  );

-- Note: NO insert/update/delete policies. Every write goes through the
-- service-role admin client on the server, which bypasses RLS entirely.
-- This makes it impossible for a malicious client to fabricate or modify
-- subscriber rows directly via PostgREST.

GRANT SELECT ON host_subscribers TO authenticated;
GRANT SELECT ON host_broadcasts  TO authenticated;
