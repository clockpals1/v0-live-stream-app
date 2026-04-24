-- ============================================================================
-- 016_stream_private_messages.sql
-- ----------------------------------------------------------------------------
-- Stream-scoped private messaging between the stream OPERATORS:
--   • the stream owner (host / admin who owns the stream)
--   • platform admins
--   • assigned Super Users (via stream_operators)
--
-- This is the "ops channel" — it is NOT viewer chat. Viewers never see these
-- messages, and operators on one stream cannot read or write messages on a
-- different stream. Scope is enforced at three layers:
--   1. RLS policies below restrict SELECT / INSERT to the three roles above
--      for the specific stream_id on the row.
--   2. The API routes perform the same authorisation check before inserting,
--      so an anon client without a session gets a clean 401 / 403.
--   3. The client-side Supabase Broadcast channel is keyed on the stream_id
--      too, so even if someone subscribed with a bad JWT the RLS still gates
--      reads on the DB snapshot used for history.
-- ============================================================================

CREATE TABLE IF NOT EXISTS stream_private_messages (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stream_id      uuid NOT NULL REFERENCES streams(id) ON DELETE CASCADE,
  sender_host_id uuid NOT NULL REFERENCES hosts(id)  ON DELETE CASCADE,
  -- Snapshot of sender's role AT THE TIME the message was sent. Used purely
  -- for UI badging; role changes later do not retroactively relabel history.
  sender_role    text NOT NULL CHECK (sender_role IN ('admin', 'host', 'superuser')),
  -- Cached display name so the UI doesn't have to JOIN hosts on every message
  -- (and so deleted hosts still render a sensible "Former user" attribution).
  sender_name    text NOT NULL,
  body           text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 2000),
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_stream_private_messages_stream
  ON stream_private_messages (stream_id, created_at);

ALTER TABLE stream_private_messages ENABLE ROW LEVEL SECURITY;

-- SELECT: only the stream owner, platform admins, and operators assigned
-- to that specific stream may read the ops-channel history.
DROP POLICY IF EXISTS "Ops read stream private messages" ON stream_private_messages;
CREATE POLICY "Ops read stream private messages" ON stream_private_messages
  FOR SELECT USING (
    public.is_stream_owner(stream_id)
    OR EXISTS (
      SELECT 1 FROM hosts
      WHERE hosts.user_id = auth.uid()
        AND hosts.role = 'admin'
    )
    OR public.is_stream_operator(stream_id)
  );

-- INSERT: same gate as SELECT, PLUS sender_host_id must belong to auth.uid()
-- so nobody can impersonate another host by forging sender_host_id client-side.
DROP POLICY IF EXISTS "Ops insert stream private messages" ON stream_private_messages;
CREATE POLICY "Ops insert stream private messages" ON stream_private_messages
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM hosts
      WHERE hosts.id = stream_private_messages.sender_host_id
        AND hosts.user_id = auth.uid()
    )
    AND (
      public.is_stream_owner(stream_id)
      OR EXISTS (
        SELECT 1 FROM hosts
        WHERE hosts.user_id = auth.uid()
          AND hosts.role = 'admin'
      )
      OR public.is_stream_operator(stream_id)
    )
  );

-- UPDATE / DELETE are not exposed through the API. We intentionally do NOT
-- grant them at the RLS level so even a service-role oversight can't expose
-- editing; admins needing to scrub messages use the service role directly.

COMMENT ON TABLE stream_private_messages IS
  'Ops-channel chat scoped to a single stream. Readable only by the stream owner, platform admins, and assigned operators (Super Users).';
