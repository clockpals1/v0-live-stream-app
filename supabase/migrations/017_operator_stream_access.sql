-- ============================================================================
-- 017_operator_stream_access.sql
-- ----------------------------------------------------------------------------
-- Fills the RLS gap exposed after migration 015: assigned operators
-- (Super Users / admins with a stream_operators row) need client-side
-- SELECT + UPDATE on their assigned streams so the operator UI can read
-- and write the overlay / ticker / music / slideshow fields that live on
-- the streams row (and the stream_slides child table).
--
-- Broadcast lifecycle is NOT enabled for operators: they never open media
-- on their device, and the UI gates Start/End/Pause/Resume/GoOnAir on the
-- owner. The UPDATE policy below is column-agnostic (no per-column filter
-- in RLS) because client-side UI never exposes those broadcast-mutating
-- controls to operators. Defence-in-depth against a malicious operator
-- crafting a direct DB update would require column-level grants, which are
-- out of scope for this change — the UI + API are the primary gate.
-- ============================================================================

-- ─── streams: SELECT for operators ────────────────────────────────────────
-- The existing owner / assigned-host / public-active / public-scheduled
-- policies already cover most cases. This fills in the gap for operators
-- viewing a stream whose status is NOT live/waiting/scheduled (e.g. 'ended')
-- and makes the intent explicit regardless of status.
DROP POLICY IF EXISTS "Operators can view assigned streams" ON streams;
CREATE POLICY "Operators can view assigned streams" ON streams
  FOR SELECT USING (
    EXISTS (
      SELECT 1
        FROM stream_operators o
        JOIN hosts h ON h.id = o.host_id
       WHERE o.stream_id = streams.id
         AND h.user_id = auth.uid()
    )
  );

-- ─── streams: UPDATE for operators ────────────────────────────────────────
-- Required for overlay / ticker / music persistence called client-side
-- from components/host/stream-interface.tsx via supabase.from('streams').update.
DROP POLICY IF EXISTS "Operators can update assigned streams" ON streams;
CREATE POLICY "Operators can update assigned streams" ON streams
  FOR UPDATE USING (
    EXISTS (
      SELECT 1
        FROM stream_operators o
        JOIN hosts h ON h.id = o.host_id
       WHERE o.stream_id = streams.id
         AND h.user_id = auth.uid()
    )
  ) WITH CHECK (
    EXISTS (
      SELECT 1
        FROM stream_operators o
        JOIN hosts h ON h.id = o.host_id
       WHERE o.stream_id = streams.id
         AND h.user_id = auth.uid()
    )
  );

-- ─── streams: admins full access ──────────────────────────────────────────
-- Admins operate any stream. Add explicit admin policies so they can run
-- the operator UI on a stream they do not own (migration 013's
-- is_admin_user() function reads role='admin').
DROP POLICY IF EXISTS "Admins can view all streams" ON streams;
CREATE POLICY "Admins can view all streams" ON streams
  FOR SELECT USING (public.is_admin_user());

DROP POLICY IF EXISTS "Admins can update all streams" ON streams;
CREATE POLICY "Admins can update all streams" ON streams
  FOR UPDATE USING (public.is_admin_user())
  WITH CHECK (public.is_admin_user());

-- ─── stream_slides: operator + admin write access ────────────────────────
-- The original policy in migration 011 used `s.host_id = auth.uid()` which
-- is incorrect — streams.host_id references hosts.id, not auth.uid().
-- The SlideshowPanel therefore only worked when called via a service-role
-- path. Replace with correctly-scoped policies and extend to operators.
DROP POLICY IF EXISTS "Host write stream_slides" ON stream_slides;
CREATE POLICY "Host write stream_slides" ON stream_slides
  FOR ALL
  USING (
    public.is_stream_owner(stream_id)
    OR public.is_admin_user()
    OR public.is_stream_operator(stream_id)
  )
  WITH CHECK (
    public.is_stream_owner(stream_id)
    OR public.is_admin_user()
    OR public.is_stream_operator(stream_id)
  );

COMMENT ON POLICY "Operators can view assigned streams" ON streams IS
  'Super Users (via stream_operators) can read their assigned streams regardless of status. Complements owner / assigned-host / public policies without widening viewer-facing access.';
COMMENT ON POLICY "Operators can update assigned streams" ON streams IS
  'Super Users (via stream_operators) may write overlay / ticker / music / slideshow state on their assigned streams. Broadcast lifecycle is gated in the UI, not in RLS.';
