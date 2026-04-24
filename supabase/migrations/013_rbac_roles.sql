-- RBAC: replace ad-hoc is_admin boolean with a proper role enum.
-- Roles:
--   admin  – full platform access, can manage users
--   host   – can create/own streams, can be invited as co-host on other streams
--   cohost – can ONLY be invited as co-host; cannot create their own streams
--
-- is_admin is kept and auto-synced from role so existing code keeps working.

-- 1) Add role column ------------------------------------------------------
ALTER TABLE hosts
  ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'host'
  CHECK (role IN ('admin', 'host', 'cohost'));

-- Backfill from the existing boolean
UPDATE hosts SET role = 'admin' WHERE is_admin = true AND role <> 'admin';
UPDATE hosts SET role = 'host'  WHERE (is_admin IS NULL OR is_admin = false) AND role = 'host';

CREATE INDEX IF NOT EXISTS idx_hosts_role ON hosts(role);

-- 2) Keep is_admin in sync with role (back-compat for existing checks) ----
CREATE OR REPLACE FUNCTION public.hosts_sync_is_admin()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.is_admin := (NEW.role = 'admin');
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS hosts_sync_is_admin_trg ON hosts;
CREATE TRIGGER hosts_sync_is_admin_trg
  BEFORE INSERT OR UPDATE OF role, is_admin ON hosts
  FOR EACH ROW EXECUTE FUNCTION public.hosts_sync_is_admin();

-- Ensure the existing rows have the correct is_admin after backfill
UPDATE hosts SET is_admin = (role = 'admin');

-- 3) Refresh is_admin_user() (still reads is_admin — no change needed,
--    but redefine for clarity / idempotency).
CREATE OR REPLACE FUNCTION public.is_admin_user()
RETURNS BOOLEAN
LANGUAGE SQL
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT role = 'admin' FROM public.hosts WHERE user_id = auth.uid() LIMIT 1),
    false
  );
$$;

-- 4) Helper: current user's role (RLS-friendly, bypasses recursion) -------
CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS TEXT
LANGUAGE SQL
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT role FROM public.hosts WHERE user_id = auth.uid() LIMIT 1),
    'none'
  );
$$;

-- 5) Block cohost-role users from creating streams ------------------------
-- The existing "Hosts can create their own streams" policy only checks that
-- the hosts row belongs to auth.uid(); it does not distinguish role.
-- Replace it to additionally require role IN ('admin','host').
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

-- 6) Guard against losing the last admin ---------------------------------
-- Prevent demoting / deleting the only admin row via DB-level check.
-- (API also enforces, but defence in depth.)
CREATE OR REPLACE FUNCTION public.hosts_prevent_last_admin()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  remaining_admins INT;
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.role = 'admin' AND NEW.role <> 'admin' THEN
    SELECT COUNT(*) INTO remaining_admins FROM hosts WHERE role = 'admin' AND id <> OLD.id;
    IF remaining_admins = 0 THEN
      RAISE EXCEPTION 'Cannot demote the last remaining admin';
    END IF;
  ELSIF TG_OP = 'DELETE' AND OLD.role = 'admin' THEN
    SELECT COUNT(*) INTO remaining_admins FROM hosts WHERE role = 'admin' AND id <> OLD.id;
    IF remaining_admins = 0 THEN
      RAISE EXCEPTION 'Cannot delete the last remaining admin';
    END IF;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS hosts_prevent_last_admin_trg ON hosts;
CREATE TRIGGER hosts_prevent_last_admin_trg
  BEFORE UPDATE OR DELETE ON hosts
  FOR EACH ROW EXECUTE FUNCTION public.hosts_prevent_last_admin();
