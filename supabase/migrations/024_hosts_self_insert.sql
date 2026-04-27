-- 024_hosts_self_insert.sql
--
-- Allow authenticated users to INSERT their own hosts row.
--
-- WHY THIS EXISTS
-- ---------------
-- The dashboard page auto-creates a hosts row on first visit for any
-- newly-confirmed user. It tried to do this through the service-role
-- admin client, falling back to the regular (anon/auth) client if the
-- service key isn't configured in the runtime.
--
-- Migration 001 added SELECT and UPDATE policies on hosts but never an
-- INSERT policy. With RLS enabled, that means the fallback path was
-- silently rejected and new users landed on the "Host Access Required"
-- screen unless their email matched the hardcoded admin bootstrap.
--
-- This policy lets a signed-in user insert ONE row keyed to themselves
-- (user_id MUST equal auth.uid()). That's the same identity check the
-- existing SELECT/UPDATE policies already enforce. is_admin defaults to
-- false at the column level, so a self-insert cannot grant admin.
--
-- IDEMPOTENCY
-- -----------
-- DROP IF EXISTS first so re-running the migration is safe.

DROP POLICY IF EXISTS "Users can insert their own host profile" ON hosts;

CREATE POLICY "Users can insert their own host profile" ON hosts
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);
