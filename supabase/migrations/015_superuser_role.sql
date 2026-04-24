-- ============================================================================
-- 015_superuser_role.sql
-- ----------------------------------------------------------------------------
-- Adds the scoped-operator "superuser" role alongside the existing
-- admin / host / cohost roles.
--
-- Role contract (enforced by app + DB):
--   superuser
--     • NOT a broadcaster. Cannot create streams; cannot be invited as a
--       co-host broadcaster.
--     • Per-stream assignment only — effective permissions apply ONLY on the
--       streams their row in `stream_operators` references.
--     • Within an assigned stream: may manage overlay/image/music/ticker/
--       slideshow, add/remove co-hosts, change active participant, share,
--       and (see migration 016) exchange ops-channel private messages with
--       the stream owner and admins.
--
-- This migration is additive and non-destructive:
--   • existing role CHECK is widened, not rewritten
--   • existing RLS policies are untouched except for the streams-INSERT guard
--     which is widened to also reject 'superuser' (same way it rejects 'cohost')
--   • is_admin trigger is untouched — a superuser has is_admin=false
-- ============================================================================

-- 1) Widen role CHECK to include 'superuser'.
--    The constraint added in 013 was unnamed so Postgres generated
--    "hosts_role_check". DROP IF EXISTS + recreate is safe across re-runs.
ALTER TABLE hosts DROP CONSTRAINT IF EXISTS hosts_role_check;
ALTER TABLE hosts
  ADD CONSTRAINT hosts_role_check
  CHECK (role IN ('admin', 'host', 'cohost', 'superuser'));

-- 2) Block superusers from inserting streams.
--    Mirrors the existing guard that blocks cohosts (see 013).
DROP POLICY IF EXISTS "Hosts can create their own streams" ON streams;
CREATE POLICY "Hosts can create their own streams" ON streams
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM hosts
      WHERE hosts.id = streams.host_id
        AND hosts.user_id = auth.uid()
        AND hosts.role IN ('admin', 'host')
    )
  );

-- 3) stream_operators: per-stream superuser assignments.
--    One row = "this host may operate this stream". Created / deleted by
--    admins only (enforced by RLS below and by the admin API).
CREATE TABLE IF NOT EXISTS stream_operators (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stream_id    uuid NOT NULL REFERENCES streams(id) ON DELETE CASCADE,
  host_id      uuid NOT NULL REFERENCES hosts(id)   ON DELETE CASCADE,
  assigned_by  uuid REFERENCES hosts(id) ON DELETE SET NULL,
  assigned_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (stream_id, host_id)
);

CREATE INDEX IF NOT EXISTS idx_stream_operators_stream ON stream_operators(stream_id);
CREATE INDEX IF NOT EXISTS idx_stream_operators_host   ON stream_operators(host_id);

ALTER TABLE stream_operators ENABLE ROW LEVEL SECURITY;

-- Admin: full access (defence in depth — admin API uses service role anyway).
DROP POLICY IF EXISTS "Admins manage stream operators" ON stream_operators;
CREATE POLICY "Admins manage stream operators" ON stream_operators
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM hosts
      WHERE hosts.user_id = auth.uid()
        AND hosts.role = 'admin'
    )
  ) WITH CHECK (
    EXISTS (
      SELECT 1 FROM hosts
      WHERE hosts.user_id = auth.uid()
        AND hosts.role = 'admin'
    )
  );

-- Stream owner: may read operator rows for THEIR streams (to render
-- "who can operate this stream" panels client-side).
DROP POLICY IF EXISTS "Stream owner reads own stream operators" ON stream_operators;
CREATE POLICY "Stream owner reads own stream operators" ON stream_operators
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM streams s
      JOIN hosts h ON h.id = s.host_id
      WHERE s.id = stream_operators.stream_id
        AND h.user_id = auth.uid()
    )
  );

-- Assigned operator: may read their own assignments (used by the dashboard
-- to list "streams I am assigned to operate").
DROP POLICY IF EXISTS "Operator reads own assignments" ON stream_operators;
CREATE POLICY "Operator reads own assignments" ON stream_operators
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM hosts h
      WHERE h.id = stream_operators.host_id
        AND h.user_id = auth.uid()
    )
  );

-- 4) Helper: is the current user allowed to OPERATE this stream?
--    Centralised so RLS elsewhere (e.g. private messages in 016) can reuse it.
CREATE OR REPLACE FUNCTION public.is_stream_operator(target_stream uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM stream_operators o
      JOIN hosts h ON h.id = o.host_id
     WHERE o.stream_id = target_stream
       AND h.user_id = auth.uid()
  );
$$;

CREATE OR REPLACE FUNCTION public.is_stream_owner(target_stream uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM streams s
      JOIN hosts h ON h.id = s.host_id
     WHERE s.id = target_stream
       AND h.user_id = auth.uid()
  );
$$;

COMMENT ON TABLE stream_operators IS
  'Per-stream superuser assignments. A row grants the referenced host operator-level access to the referenced stream only.';
