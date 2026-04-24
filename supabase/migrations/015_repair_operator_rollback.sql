-- Repair migration after rollback of the operator/super-user features.
--
-- Background:
--   Earlier commits 1761e83, 24a45d1, 5e731ee added migrations 015/016/017
--   that introduced a `stream_operators` table, a `stream_private_messages`
--   table, and RLS policies on `streams` that referenced `stream_operators`.
--   Those migrations were applied to production Supabase. The repository was
--   later rolled back (commit cc4bd6f) — the SQL files and their application
--   code were deleted — BUT the applied policies + tables remain live on the
--   server.
--
--   The residual RLS policies on `streams` still reference `stream_operators`,
--   whose own RLS policies reference `streams`. Any SELECT/INSERT against
--   `streams` therefore triggers the cycle and returns:
--     "infinite recursion detected in policy for relation 'streams'"
--
-- This migration is a defensive, idempotent cleanup: it works whether or not
-- the earlier migrations were applied, and it leaves the DB in exactly the
-- state described by migrations 001 / 003 / 013 (admin / host / cohost only).

-- 1) Drop every policy on public.streams whose definition references
--    stream_operators. Done via a DO block because we don't know the exact
--    policy names used by the deleted migrations — only that they touch
--    stream_operators in either USING or WITH CHECK.
DO $$
DECLARE
  pol record;
BEGIN
  FOR pol IN
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'streams'
      AND (
        COALESCE(qual, '')       ILIKE '%stream_operators%'
        OR COALESCE(with_check, '') ILIKE '%stream_operators%'
      )
  LOOP
    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON public.streams',
      pol.policyname
    );
  END LOOP;
END $$;

-- 2) Drop the operator / private-message tables themselves. CASCADE removes
--    any RLS policies attached to them plus FK constraints pointing at them.
DROP TABLE IF EXISTS public.stream_private_messages CASCADE;
DROP TABLE IF EXISTS public.stream_operators        CASCADE;

-- 3) If migration 015 widened the hosts.role CHECK constraint to allow
--    'super_user' or 'operator', tighten it back to the canonical set
--    (admin / host / cohost) defined by 013.
DO $$
DECLARE
  bad_ck text;
BEGIN
  -- Demote any stranded rows first so the new CHECK won't fail on existing data.
  BEGIN
    UPDATE public.hosts
       SET role = 'host'
     WHERE role NOT IN ('admin', 'host', 'cohost');
  EXCEPTION WHEN undefined_column THEN
    -- hosts.role doesn't exist yet — migration 013 hasn't run. Nothing to do.
    RETURN;
  END;

  -- Find any CHECK constraint on hosts that references super_user or operator.
  SELECT conname INTO bad_ck
  FROM pg_constraint
  WHERE conrelid = 'public.hosts'::regclass
    AND contype  = 'c'
    AND (
      pg_get_constraintdef(oid) ILIKE '%super_user%'
      OR pg_get_constraintdef(oid) ILIKE '%operator%'
    )
  LIMIT 1;

  IF bad_ck IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.hosts DROP CONSTRAINT %I', bad_ck);
  END IF;

  -- Only add the canonical CHECK if no equivalent CHECK already exists.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.hosts'::regclass
      AND contype  = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%role = ANY%admin%host%cohost%'
  ) THEN
    ALTER TABLE public.hosts
      ADD CONSTRAINT hosts_role_check_canonical
        CHECK (role IN ('admin', 'host', 'cohost'));
  END IF;
END $$;

-- 4) Sanity check: re-assert the baseline streams SELECT policies from
--    migrations 001 and 003 are present. DROP-then-CREATE is idempotent
--    and guarantees the clean definitions win even if something else
--    mutated them during the broken-migration window.
DROP POLICY IF EXISTS "Hosts can view their own streams" ON public.streams;
CREATE POLICY "Hosts can view their own streams" ON public.streams
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.hosts
      WHERE hosts.id = streams.host_id
        AND hosts.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Assigned hosts can view their streams" ON public.streams;
CREATE POLICY "Assigned hosts can view their streams" ON public.streams
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.hosts
      WHERE hosts.id = streams.assigned_host_id
        AND hosts.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Assigned hosts can update their streams" ON public.streams;
CREATE POLICY "Assigned hosts can update their streams" ON public.streams
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM public.hosts
      WHERE hosts.id = streams.assigned_host_id
        AND hosts.user_id = auth.uid()
    )
  );
