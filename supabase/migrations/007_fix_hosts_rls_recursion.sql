-- Fix infinite recursion in hosts RLS policies (introduced in migration 006)
--
-- Problem: The admin policies used EXISTS(SELECT 1 FROM hosts WHERE ...)
-- which queries the hosts table from within a hosts policy, causing infinite
-- recursion. This also broke streams queries because:
--   streams policy → queries hosts → triggers admin hosts policy → queries hosts → loop
--
-- Solution: A SECURITY DEFINER function runs as the function owner (postgres),
-- which has BYPASSRLS, so it reads hosts without triggering RLS policies.

CREATE OR REPLACE FUNCTION public.is_admin_user()
RETURNS BOOLEAN
LANGUAGE SQL
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT is_admin FROM public.hosts WHERE user_id = auth.uid() LIMIT 1),
    false
  );
$$;

-- Re-create all admin policies to use the function (no more self-reference)
DROP POLICY IF EXISTS "Admins can view all hosts" ON hosts;
CREATE POLICY "Admins can view all hosts" ON hosts
  FOR SELECT USING (is_admin_user());

DROP POLICY IF EXISTS "Admins can create hosts" ON hosts;
CREATE POLICY "Admins can create hosts" ON hosts
  FOR INSERT WITH CHECK (is_admin_user());

DROP POLICY IF EXISTS "Admins can update all hosts" ON hosts;
CREATE POLICY "Admins can update all hosts" ON hosts
  FOR UPDATE USING (is_admin_user());

DROP POLICY IF EXISTS "Admins can delete hosts" ON hosts;
CREATE POLICY "Admins can delete hosts" ON hosts
  FOR DELETE USING (is_admin_user());
