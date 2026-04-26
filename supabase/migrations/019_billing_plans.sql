-- ─── 019: Billing — plans, config, host plan assignment ─────────────
--
-- Phase 1 of the subscription system. Adds two new tables (billing_plans,
-- billing_config) and a small set of columns on `hosts` for plan
-- assignment + future Stripe linkage. NO Stripe SDK calls happen yet.
--
-- DESIGN
-- ------
-- billing_plans : admin-managed catalogue of subscription tiers. The
--                 platform ships with one row, slug='free', that cannot
--                 be deleted. Admins create paid tiers from the
--                 dashboard. A `features` JSONB blob lets admins toggle
--                 capabilities (insider_circle, cloud_archive,
--                 youtube_upload, …) per plan without a schema change.
-- billing_config: singleton row (id=1). Holds the Stripe API key pair
--                 (test + live), the active mode (test|live), and the
--                 default plan slug for new hosts. Stored in DB so
--                 admins can rotate keys without redeploying. Read by
--                 the Stripe SDK wrapper in Phase 2.
--
-- SAFETY
-- ------
-- - All-additive: zero existing column or row is modified destructively.
-- - The default plan_slug='free' on `hosts` means every existing host
--   silently lands on the free plan with no UI change.
-- - RLS: hosts can read only ACTIVE plans (for the upgrade UI). Admins
--   read/write everything. billing_config is admin-only end-to-end.
-- - Stripe keys live as encrypted-at-rest PostgreSQL columns; admin RLS
--   means the anon role + every non-admin host cannot SELECT them.
-- - There is intentionally no UNIQUE constraint on stripe_price_id
--   beyond per-row uniqueness — the same price id should never appear
--   on two plans, but enforcing it here would block harmless re-use
--   during testing.

-- ─────────────────────────────────────────────────────────────────────
-- 1. billing_plans
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS billing_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL UNIQUE,                            -- 'free', 'pro', etc. URL-safe.
  name TEXT NOT NULL,                                    -- display label
  description TEXT,                                      -- 1-2 sentence pitch
  price_cents INTEGER NOT NULL DEFAULT 0,                -- 0 for free; admin sets others
  currency TEXT NOT NULL DEFAULT 'usd',                  -- ISO-4217 lowercase
  billing_interval TEXT NOT NULL DEFAULT 'month'         -- 'month' | 'year' | 'one_time'
    CHECK (billing_interval IN ('month','year','one_time')),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,               -- inactive plans hidden from upgrade UI
  is_default BOOLEAN NOT NULL DEFAULT FALSE,             -- new hosts land on the row with TRUE
  sort_order INTEGER NOT NULL DEFAULT 0,                 -- ascending; cheaper first
  features JSONB NOT NULL DEFAULT '{}'::jsonb,           -- { insider_circle: true, cloud_archive: false, ... }
  stripe_price_id_test TEXT,                             -- price_xxxx in test mode
  stripe_price_id_live TEXT,                             -- price_xxxx in live mode
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Only one row may have is_default=TRUE.
CREATE UNIQUE INDEX IF NOT EXISTS billing_plans_is_default_uniq
  ON billing_plans ((is_default))
  WHERE is_default = TRUE;

CREATE INDEX IF NOT EXISTS idx_billing_plans_active_sort
  ON billing_plans (is_active, sort_order);

-- updated_at trigger (re-uses the helper from migration 001)
DROP TRIGGER IF EXISTS billing_plans_updated_at ON billing_plans;
CREATE TRIGGER billing_plans_updated_at
  BEFORE UPDATE ON billing_plans
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Seed the free plan. is_default=TRUE so signups land here automatically.
-- Features default-on for everything that's currently free for everyone,
-- so existing user behaviour is unchanged the moment this migration runs.
INSERT INTO billing_plans (slug, name, description, price_cents, billing_interval, is_active, is_default, sort_order, features)
VALUES (
  'free',
  'Free',
  'Live streaming with chat, viewers, and Insider Circle subscribers.',
  0,
  'month',
  TRUE,
  TRUE,
  0,
  '{
    "insider_circle": true,
    "cloud_archive": false,
    "youtube_upload": false,
    "max_subscribers": null,
    "max_viewers_per_stream": 50
  }'::jsonb
)
ON CONFLICT (slug) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────
-- 2. billing_config (singleton — id pinned to 1)
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS billing_config (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),       -- singleton guard
  stripe_mode TEXT NOT NULL DEFAULT 'test'               -- which key set is active
    CHECK (stripe_mode IN ('test','live')),
  stripe_test_secret_key TEXT,                           -- sk_test_…
  stripe_test_publishable_key TEXT,                      -- pk_test_… (safe for client)
  stripe_test_webhook_secret TEXT,                       -- whsec_…
  stripe_live_secret_key TEXT,                           -- sk_live_…
  stripe_live_publishable_key TEXT,                      -- pk_live_…
  stripe_live_webhook_secret TEXT,                       -- whsec_…
  default_plan_slug TEXT NOT NULL DEFAULT 'free'         -- new hosts land on this slug
    REFERENCES billing_plans(slug) ON UPDATE CASCADE ON DELETE RESTRICT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed the singleton row. Keys are NULL until admin enters them.
INSERT INTO billing_config (id, stripe_mode, default_plan_slug)
VALUES (1, 'test', 'free')
ON CONFLICT (id) DO NOTHING;

DROP TRIGGER IF EXISTS billing_config_updated_at ON billing_config;
CREATE TRIGGER billing_config_updated_at
  BEFORE UPDATE ON billing_config
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ─────────────────────────────────────────────────────────────────────
-- 3. hosts: plan + Stripe linkage columns
-- ─────────────────────────────────────────────────────────────────────

ALTER TABLE hosts
  ADD COLUMN IF NOT EXISTS plan_slug TEXT NOT NULL DEFAULT 'free'
    REFERENCES billing_plans(slug) ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE hosts
  ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT;

ALTER TABLE hosts
  ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT;

ALTER TABLE hosts
  ADD COLUMN IF NOT EXISTS subscription_status TEXT;     -- 'active' | 'trialing' | 'past_due' | 'canceled' | NULL

ALTER TABLE hosts
  ADD COLUMN IF NOT EXISTS subscription_current_period_end TIMESTAMPTZ;

ALTER TABLE hosts
  ADD COLUMN IF NOT EXISTS subscription_cancel_at_period_end BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_hosts_plan_slug ON hosts (plan_slug);
CREATE INDEX IF NOT EXISTS idx_hosts_stripe_customer ON hosts (stripe_customer_id);

-- ─────────────────────────────────────────────────────────────────────
-- 4. RLS — billing_plans
-- ─────────────────────────────────────────────────────────────────────

ALTER TABLE billing_plans ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can read active plans" ON billing_plans;
CREATE POLICY "Anyone can read active plans" ON billing_plans
  FOR SELECT USING (is_active = TRUE);

DROP POLICY IF EXISTS "Admins read all plans" ON billing_plans;
CREATE POLICY "Admins read all plans" ON billing_plans
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM hosts
      WHERE hosts.user_id = auth.uid()
        AND (hosts.role = 'admin' OR hosts.is_admin = TRUE)
    )
  );

DROP POLICY IF EXISTS "Admins write plans" ON billing_plans;
CREATE POLICY "Admins write plans" ON billing_plans
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM hosts
      WHERE hosts.user_id = auth.uid()
        AND (hosts.role = 'admin' OR hosts.is_admin = TRUE)
    )
  ) WITH CHECK (
    EXISTS (
      SELECT 1 FROM hosts
      WHERE hosts.user_id = auth.uid()
        AND (hosts.role = 'admin' OR hosts.is_admin = TRUE)
    )
  );

-- ─────────────────────────────────────────────────────────────────────
-- 5. RLS — billing_config (admin-only, end-to-end; secrets must never
--    leak to anon or non-admin authed users)
-- ─────────────────────────────────────────────────────────────────────

ALTER TABLE billing_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins read config" ON billing_config;
CREATE POLICY "Admins read config" ON billing_config
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM hosts
      WHERE hosts.user_id = auth.uid()
        AND (hosts.role = 'admin' OR hosts.is_admin = TRUE)
    )
  );

DROP POLICY IF EXISTS "Admins write config" ON billing_config;
CREATE POLICY "Admins write config" ON billing_config
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM hosts
      WHERE hosts.user_id = auth.uid()
        AND (hosts.role = 'admin' OR hosts.is_admin = TRUE)
    )
  ) WITH CHECK (
    EXISTS (
      SELECT 1 FROM hosts
      WHERE hosts.user_id = auth.uid()
        AND (hosts.role = 'admin' OR hosts.is_admin = TRUE)
    )
  );

-- ─────────────────────────────────────────────────────────────────────
-- 6. Default-plan trigger on hosts
--
-- Existing migration 002 inserts a `hosts` row when a new auth user
-- signs up. Once that trigger ran on a fresh user, plan_slug picks up
-- whatever billing_config.default_plan_slug currently is. We do this
-- in a BEFORE INSERT trigger on `hosts` so the auth-trigger path
-- doesn't need to know about billing.
-- ─────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION assign_default_plan_to_host()
RETURNS TRIGGER AS $$
DECLARE
  v_default TEXT;
BEGIN
  -- Only override when the inserter didn't specify one explicitly.
  IF NEW.plan_slug IS NULL OR NEW.plan_slug = 'free' THEN
    SELECT default_plan_slug INTO v_default FROM billing_config WHERE id = 1;
    IF v_default IS NOT NULL THEN
      NEW.plan_slug := v_default;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS hosts_assign_default_plan ON hosts;
CREATE TRIGGER hosts_assign_default_plan
  BEFORE INSERT ON hosts
  FOR EACH ROW EXECUTE FUNCTION assign_default_plan_to_host();
