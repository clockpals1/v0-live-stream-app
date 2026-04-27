-- 032_ai_automation_rules.sql
--
-- AI Automation Hub — recurring task rules engine.
--
-- Each row is a standing instruction: "run this AI workflow on this schedule
-- for this host." The cron route at /api/cron/ai/daily-jobs reads this table
-- to decide which jobs to fire.
--
-- rule_type values (current + planned):
--   daily_content_ideas    — generate 5 content ideas each morning
--   weekly_summary         — AI narrative of last 7 days' stream performance
--   post_stream_recap      — fired when a stream status → 'ended'
--   affiliate_campaign     — weekly campaign copy for a configured product
--
-- schedule:
--   daily       → cron fires each morning
--   weekly      → cron fires each Monday
--   post_stream → triggered by stream end event (not cron-based)
--
-- config JSONB stores rule-specific settings, e.g.:
--   { "niche": "fitness", "tone": "energetic", "platform": "tiktok" }
--   { "affiliate_url": "https://...", "product_name": "Protein X" }
--
-- SAFETY: Additive only. No existing tables modified.

CREATE TABLE IF NOT EXISTS ai_automation_rules (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  host_id       UUID NOT NULL REFERENCES hosts(id) ON DELETE CASCADE,
  rule_type     TEXT NOT NULL CHECK (rule_type IN (
    'daily_content_ideas',
    'weekly_summary',
    'post_stream_recap',
    'affiliate_campaign'
  )),
  label         TEXT NOT NULL,
  enabled       BOOLEAN NOT NULL DEFAULT TRUE,
  schedule      TEXT NOT NULL CHECK (schedule IN ('daily', 'weekly', 'post_stream')),
  -- Host-specific configuration for this rule (tone, niche, product, etc.)
  config        JSONB NOT NULL DEFAULT '{}',
  last_run_at   TIMESTAMPTZ,
  next_run_at   TIMESTAMPTZ,
  run_count     INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_rules_host_id
  ON ai_automation_rules(host_id);

-- Cron query: enabled daily rules not run in last 23 hours.
CREATE INDEX IF NOT EXISTS idx_ai_rules_cron
  ON ai_automation_rules(schedule, last_run_at)
  WHERE enabled = true;

DROP TRIGGER IF EXISTS ai_automation_rules_updated_at ON ai_automation_rules;
CREATE TRIGGER ai_automation_rules_updated_at
  BEFORE UPDATE ON ai_automation_rules
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE ai_automation_rules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Hosts manage own ai rules" ON ai_automation_rules;
CREATE POLICY "Hosts manage own ai rules" ON ai_automation_rules
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM hosts
      WHERE hosts.id = ai_automation_rules.host_id
        AND hosts.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM hosts
      WHERE hosts.id = ai_automation_rules.host_id
        AND hosts.user_id = auth.uid()
    )
  );
