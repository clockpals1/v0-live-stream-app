-- ============================================================================
-- 017_host_can_assign_operators.sql
--
-- Allow the stream OWNER (hosts.id = streams.host_id) to assign, remove, and
-- view Super User / operator rows for streams they own. Migration 016 only
-- allowed admins to write to stream_operators, which meant a host could not
-- attach a trusted operator to their own stream without bothering an admin.
--
-- Design:
--   * Reuse the SECURITY DEFINER helpers from 016 so we do not reintroduce
--     cross-table RLS subqueries (and the recursion problem they caused).
--   * Owner check uses a new helper public.is_stream_owner(stream_id) that
--     looks up streams.host_id against current_host_id() once, bypassing RLS.
--   * Admin rights are preserved — is_admin_user() OR is_stream_owner(id).
-- ============================================================================

BEGIN;

-- ─── New helper: is the authenticated user the owner of the given stream? ──
-- Drop any pre-existing version first. An older build of this helper may
-- already exist on the database with a different input parameter name
-- (e.g. target_stream instead of p_stream_id). Postgres 42P13 forbids
-- renaming parameters via CREATE OR REPLACE, so we drop then create.
DROP FUNCTION IF EXISTS public.is_stream_owner(UUID);

CREATE OR REPLACE FUNCTION public.is_stream_owner(p_stream_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.streams   s
      JOIN public.hosts     h ON h.id = s.host_id
     WHERE s.id = p_stream_id
       AND h.user_id = auth.uid()
  );
$$;

REVOKE ALL ON FUNCTION public.is_stream_owner(UUID) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.is_stream_owner(UUID) TO authenticated;

COMMENT ON FUNCTION public.is_stream_owner IS
  'True when the authenticated user is the owner (streams.host_id) of the given stream. SECURITY DEFINER to avoid RLS recursion when used inside RLS policies.';

-- ─── stream_operators RLS: widen write access to owner + admin ─────────────
-- SELECT policy unchanged (from 016) — operator-self, owner, admin already
-- covered via operators_select_scope.

DROP POLICY IF EXISTS "operators_admin_write"      ON public.stream_operators;
DROP POLICY IF EXISTS "operators_owner_or_admin"   ON public.stream_operators;

CREATE POLICY "operators_owner_or_admin" ON public.stream_operators
  FOR ALL
  USING (
        public.is_admin_user()
     OR public.is_stream_owner(stream_id)
  )
  WITH CHECK (
        public.is_admin_user()
     OR public.is_stream_owner(stream_id)
  );

COMMENT ON POLICY "operators_owner_or_admin" ON public.stream_operators IS
  'Admins or the stream owner can INSERT / UPDATE / DELETE operator rows for a stream. SELECT is still governed by operators_select_scope (operator-self, owner, admin).';

COMMIT;
