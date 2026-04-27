-- 029_host_notifications.sql
-- In-app notification feed for hosts.
--
-- Architecture
--   * host_notifications stores async events (new subscriber, payment,
--     stream ended, archive ready, replay published, cohost invite).
--   * notification_prefs JSONB column on hosts stores per-category
--     on/off preferences; controls whether the server writes a row.
--   * RLS: hosts can SELECT and UPDATE (mark-read) their own rows.
--     All INSERTs come from service-role API handlers (no INSERT policy
--     needed — service role bypasses RLS).
--   * A partial index on (host_id, created_at DESC) WHERE read=false
--     makes the unread-count query O(unread) not O(all).

-- ─── Notification feed ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS host_notifications (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  host_id     uuid        NOT NULL REFERENCES hosts(id) ON DELETE CASCADE,
  type        text        NOT NULL DEFAULT 'info'
                          CHECK (type IN ('info', 'success', 'warning', 'error')),
  category    text        NOT NULL DEFAULT 'general'
                          CHECK (category IN (
                            'subscriber', 'payment', 'stream',
                            'archive', 'cohost', 'replay', 'general'
                          )),
  title       text        NOT NULL,
  body        text,
  link        text,
  read        boolean     NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_host_notifs_host_unread
  ON host_notifications(host_id, created_at DESC)
  WHERE read = false;

CREATE INDEX IF NOT EXISTS idx_host_notifs_host_all
  ON host_notifications(host_id, created_at DESC);

-- ─── Preferences column on hosts ────────────────────────────────────
-- Keys map to category values above; value = true means send the
-- in-app notification. Absence of a key is treated as true (opt-in
-- by default). Emergency alerts are always delivered — not stored here.
ALTER TABLE hosts
  ADD COLUMN IF NOT EXISTS notification_prefs jsonb NOT NULL DEFAULT '{}'::jsonb;

-- ─── RLS ────────────────────────────────────────────────────────────
ALTER TABLE host_notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS host_notifs_select_own ON host_notifications;
CREATE POLICY host_notifs_select_own ON host_notifications
  FOR SELECT USING (
    host_id IN (SELECT id FROM hosts WHERE user_id = auth.uid())
  );

DROP POLICY IF EXISTS host_notifs_update_own ON host_notifications;
CREATE POLICY host_notifs_update_own ON host_notifications
  FOR UPDATE USING (
    host_id IN (SELECT id FROM hosts WHERE user_id = auth.uid())
  );

GRANT SELECT, UPDATE ON host_notifications TO authenticated;
