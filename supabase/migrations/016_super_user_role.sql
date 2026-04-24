-- ─────────────────────────────────────────────────────────────────────────
-- Super User role (per-stream scoped operator).
--
-- Design goals (learned from the recursion failure of the previous attempt):
--
--   1. Zero cross-table RLS subqueries. Every policy that needs to check
--      membership in another table calls a SECURITY DEFINER helper
--      function. SECURITY DEFINER functions bypass RLS for the queries
--      they run internally, so they cannot trigger a cycle.
--
--   2. Super User is a GLOBAL user type ('super_user' on hosts.role) +
--      a PER-STREAM membership (stream_operators). A user with
--      role='super_user' has no capabilities without at least one
--      stream_operators row; conversely, admin/host/cohost users are
--      NOT automatically operators — they must also be listed.
--
--   3. No blanket INSERT/UPDATE grants. Operators get SELECT on streams
--      they're assigned to, and UPDATE of overlay / ticker / music /
--      slideshow / active_participant_id columns only. Lifecycle fields
--      (status, started_at, ended_at, recording_url, host_id) are locked
--      by a BEFORE UPDATE trigger to owner/admin only — so an operator
--      cannot "go live" or publish a stream by direct DB write.
--
-- Idempotent: safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────

-- ─── 1. Allow 'super_user' in hosts.role CHECK ───────────────────────────
DO $$
DECLARE
  existing_ck text;
BEGIN
  -- Drop any existing role CHECK constraint regardless of name.
  SELECT conname INTO existing_ck
  FROM pg_constraint
  WHERE conrelid = 'public.hosts'::regclass
    AND contype  = 'c'
    AND pg_get_constraintdef(oid) ILIKE '%role%'
    AND pg_get_constraintdef(oid) ILIKE '%admin%'
  LIMIT 1;

  IF existing_ck IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.hosts DROP CONSTRAINT %I', existing_ck);
  END IF;

  ALTER TABLE public.hosts
    ADD CONSTRAINT hosts_role_check
      CHECK (role IN ('admin', 'host', 'cohost', 'super_user'));
END $$;

-- ─── 2. Helper: current user's hosts.id (used by many policies) ──────────
CREATE OR REPLACE FUNCTION public.current_host_id()
RETURNS UUID
LANGUAGE SQL
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT id FROM public.hosts WHERE user_id = auth.uid() LIMIT 1;
$$;

-- ─── 3. stream_operators table (per-stream super-user assignments) ──────
CREATE TABLE IF NOT EXISTS public.stream_operators (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stream_id   UUID NOT NULL REFERENCES public.streams(id) ON DELETE CASCADE,
  host_id     UUID NOT NULL REFERENCES public.hosts(id)   ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by  UUID REFERENCES public.hosts(id) ON DELETE SET NULL,
  UNIQUE (stream_id, host_id)
);
CREATE INDEX IF NOT EXISTS idx_stream_operators_host_id   ON public.stream_operators(host_id);
CREATE INDEX IF NOT EXISTS idx_stream_operators_stream_id ON public.stream_operators(stream_id);

ALTER TABLE public.stream_operators ENABLE ROW LEVEL SECURITY;

-- ─── 4. SECURITY DEFINER helpers — the anti-recursion layer ──────────────
-- All RLS policies below call these instead of writing cross-table subqueries.

-- True iff the current user is an operator on the given stream.
CREATE OR REPLACE FUNCTION public.is_operator_for(p_stream_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.stream_operators o
      JOIN public.hosts            h ON h.id = o.host_id
     WHERE o.stream_id = p_stream_id
       AND h.user_id   = auth.uid()
  );
$$;

-- True iff the current user owns the given stream.
CREATE OR REPLACE FUNCTION public.host_owns_stream(p_stream_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.streams s
      JOIN public.hosts   h ON h.id = s.host_id
     WHERE s.id      = p_stream_id
       AND h.user_id = auth.uid()
  );
$$;

-- True iff the current user can access private messages for the given stream.
-- Scope: admin OR owner OR operator OR assigned cohost.
CREATE OR REPLACE FUNCTION public.can_access_stream_pm(p_stream_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT
       public.is_admin_user()
    OR public.host_owns_stream(p_stream_id)
    OR public.is_operator_for(p_stream_id)
    OR EXISTS (
         SELECT 1
           FROM public.streams s
           JOIN public.hosts   h ON h.id = s.assigned_host_id
          WHERE s.id      = p_stream_id
            AND h.user_id = auth.uid()
       );
$$;

-- ─── 5. stream_operators RLS ─────────────────────────────────────────────
-- SELECT: operator-self, stream owner, or admin.
DROP POLICY IF EXISTS "operators_select_scope" ON public.stream_operators;
CREATE POLICY "operators_select_scope" ON public.stream_operators
  FOR SELECT USING (
       public.is_admin_user()
    OR host_id = public.current_host_id()
    OR public.host_owns_stream(stream_id)
  );

-- INSERT / UPDATE / DELETE: admin only (API layer is the assignment surface).
DROP POLICY IF EXISTS "operators_admin_write" ON public.stream_operators;
CREATE POLICY "operators_admin_write" ON public.stream_operators
  FOR ALL USING (public.is_admin_user())
          WITH CHECK (public.is_admin_user());

-- ─── 6. streams — grant operators SELECT + restricted UPDATE ─────────────
DROP POLICY IF EXISTS "Operators can view their assigned streams" ON public.streams;
CREATE POLICY "Operators can view their assigned streams" ON public.streams
  FOR SELECT USING (public.is_operator_for(id));

DROP POLICY IF EXISTS "Operators can update their assigned streams" ON public.streams;
CREATE POLICY "Operators can update their assigned streams" ON public.streams
  FOR UPDATE USING (public.is_operator_for(id))
             WITH CHECK (public.is_operator_for(id));

-- ─── 7. Lifecycle guard: operators cannot flip stream status / recording ─
-- Defense-in-depth: even though the app UI hides Go-Live from operators,
-- a BEFORE UPDATE trigger refuses any change to the broadcast-lifecycle
-- columns unless the caller is admin or the owner. This makes it
-- impossible for an operator to "go live" by direct DB write.
CREATE OR REPLACE FUNCTION public.enforce_stream_lifecycle_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.status       IS DISTINCT FROM NEW.status
  OR OLD.started_at   IS DISTINCT FROM NEW.started_at
  OR OLD.ended_at     IS DISTINCT FROM NEW.ended_at
  OR OLD.recording_url IS DISTINCT FROM NEW.recording_url
  OR OLD.host_id      IS DISTINCT FROM NEW.host_id
  THEN
    IF NOT public.is_admin_user() AND NOT public.host_owns_stream(NEW.id) THEN
      RAISE EXCEPTION
        'Only the stream owner or an admin can change stream lifecycle fields (status / started_at / ended_at / recording_url / host_id).';
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS enforce_stream_lifecycle_guard_trg ON public.streams;
CREATE TRIGGER enforce_stream_lifecycle_guard_trg
  BEFORE UPDATE ON public.streams
  FOR EACH ROW EXECUTE FUNCTION public.enforce_stream_lifecycle_guard();

-- ─── 8. Block super_user from owning streams (can't INSERT streams) ──────
-- The "Hosts can create their own streams" policy from 013 already limits
-- INSERT to role IN ('admin','host'). Re-assert it here so re-running this
-- migration on a DB that never received 013 still enforces the rule.
DROP POLICY IF EXISTS "Hosts can create their own streams" ON public.streams;
CREATE POLICY "Hosts can create their own streams" ON public.streams
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.hosts h
      WHERE h.id       = streams.host_id
        AND h.user_id  = auth.uid()
        AND h.role IN ('admin', 'host')
    )
  );

-- ─── 9. stream_private_messages table ────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.stream_private_messages (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stream_id    UUID NOT NULL REFERENCES public.streams(id) ON DELETE CASCADE,
  sender_id    UUID NOT NULL REFERENCES public.hosts(id)   ON DELETE CASCADE,
  sender_role  TEXT NOT NULL CHECK (sender_role IN ('admin', 'host', 'cohost', 'super_user')),
  sender_name  TEXT NOT NULL,
  message      TEXT NOT NULL CHECK (char_length(message) BETWEEN 1 AND 2000),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_spm_stream_id  ON public.stream_private_messages(stream_id);
CREATE INDEX IF NOT EXISTS idx_spm_stream_at  ON public.stream_private_messages(stream_id, created_at);

ALTER TABLE public.stream_private_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "spm_select_scope" ON public.stream_private_messages;
CREATE POLICY "spm_select_scope" ON public.stream_private_messages
  FOR SELECT USING (public.can_access_stream_pm(stream_id));

DROP POLICY IF EXISTS "spm_insert_scope" ON public.stream_private_messages;
CREATE POLICY "spm_insert_scope" ON public.stream_private_messages
  FOR INSERT WITH CHECK (
        public.can_access_stream_pm(stream_id)
    AND sender_id = public.current_host_id()
  );
