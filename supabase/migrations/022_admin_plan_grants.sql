-- ─── 022: Admin manual plan grants ──────────────────────────────────
--
-- Lets admins manually upgrade a host to a paid plan WITHOUT taking a
-- Stripe payment. Used for comp accounts, gifted upgrades, support
-- escalations, internal team members, etc.
--
-- DESIGN
-- ------
-- A "grant" is an immutable audit row. Once written it is not edited;
-- it can only be revoked, which writes the revoked_at + revoked_by
-- columns and from that moment forward the row no longer counts as
-- active. This keeps a tamper-evident trail of who-did-what-when.
--
-- An "active" grant for the purposes of entitlement resolution is one
-- where:
--     revoked_at IS NULL
--   AND effective_at <= now()
--   AND (expires_at IS NULL OR expires_at > now())
--
-- We deliberately do NOT mutate hosts.plan_slug when a grant is
-- written. plan_slug remains the Stripe-driven source of truth; the
-- application's `getEffectivePlan()` resolver layers any active grant
-- ON TOP of plan_slug, so removing the grant cleanly returns the host
-- to their Stripe-driven (or default) plan with no extra cleanup.
--
-- RBAC
-- ----
-- Insert/Update/Delete on this table is locked down at the API layer
-- via /lib/auth/require-admin.ts. RLS denies all writes from the
-- authenticated client (RLS WITH CHECK FALSE policy) so a forged
-- request that bypasses the API can't write either. Reads are limited
-- to the granted host (their own active grant) and admins (any).
-- ────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS admin_plan_grants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  host_id UUID NOT NULL REFERENCES hosts(id) ON DELETE CASCADE,
  -- We store the slug rather than an FK to billing_plans so a plan
  -- rename doesn't orphan grants (slugs are stable; ids regenerate
  -- if a plan is deleted+recreated).
  plan_slug TEXT NOT NULL,
  -- auth.users.id of the admin who created the grant. Nullable in
  -- case the granting admin's auth row is later deleted; we keep
  -- granted_by_email as a textual fallback so the audit doesn't break.
  granted_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  granted_by_email TEXT,
  -- Free-form admin note ("Comp for community moderator", "BFCM
  -- promotion", etc.). Surfaced in the admin UI; never shown to the
  -- granted host.
  reason TEXT,
  -- Window during which the grant is in effect.
  effective_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ,
  -- Revocation = soft-delete. Once these are set, the grant is no
  -- longer active. We keep the row for the audit trail.
  revoked_at TIMESTAMPTZ,
  revoked_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  revoked_by_email TEXT,
  revoke_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Sanity: expiry can't precede effective.
  CHECK (expires_at IS NULL OR expires_at > effective_at)
);

CREATE INDEX IF NOT EXISTS idx_admin_plan_grants_host_id
  ON admin_plan_grants (host_id);
CREATE INDEX IF NOT EXISTS idx_admin_plan_grants_active
  ON admin_plan_grants (host_id)
  WHERE revoked_at IS NULL;

-- ─── RLS ─────────────────────────────────────────────────────────────
ALTER TABLE admin_plan_grants ENABLE ROW LEVEL SECURITY;

-- Hosts can read their own (so a future "you've been gifted X" notice
-- could query directly). They cannot read other hosts' grants.
DROP POLICY IF EXISTS "Hosts read own grants" ON admin_plan_grants;
CREATE POLICY "Hosts read own grants" ON admin_plan_grants
  FOR SELECT TO authenticated
  USING (
    host_id IN (SELECT id FROM hosts WHERE user_id = auth.uid())
  );

-- Admins read all.
DROP POLICY IF EXISTS "Admins read all grants" ON admin_plan_grants;
CREATE POLICY "Admins read all grants" ON admin_plan_grants
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM hosts
      WHERE user_id = auth.uid()
        AND (role = 'admin' OR is_admin = TRUE)
    )
  );

-- Writes are gated through the service-role admin client only. The
-- API layer (require-admin.ts) enforces the role check; RLS here is
-- belt-and-braces in case someone reaches in with the user-scoped key.
DROP POLICY IF EXISTS "No client writes" ON admin_plan_grants;
CREATE POLICY "No client writes" ON admin_plan_grants
  FOR ALL TO authenticated
  USING (false)
  WITH CHECK (false);

-- ─── Helper view: resolve the active grant per host ─────────────────
-- Useful for ad-hoc SQL queries; the application code uses its own
-- TypeScript resolver in lib/billing/grants.ts so the rules stay in
-- one place. View is SECURITY INVOKER (default), so RLS still applies.
CREATE OR REPLACE VIEW v_active_admin_plan_grants AS
SELECT g.*
FROM admin_plan_grants g
WHERE g.revoked_at IS NULL
  AND g.effective_at <= now()
  AND (g.expires_at IS NULL OR g.expires_at > now());

COMMENT ON TABLE admin_plan_grants IS
  'Admin-issued manual plan upgrades that bypass Stripe. Immutable audit log; revoked rows kept for traceability.';
