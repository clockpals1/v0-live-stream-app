-- 035_ai_automation_rules_extend.sql
--
-- Extends the ai_automation_rules.rule_type CHECK constraint to include
-- two new monetization-aware automation types:
--
--   short_video_autopilot  — daily: auto-generate a 60s short video script
--                            for the configured niche and platform
--
--   evergreen_repurpose    — weekly: finds the host's best recent asset
--                            and generates 3 repurposed variations:
--                            a new hook, a caption variant, and a fresh angle
--
-- SAFETY: Additive constraint change only. No rows modified or deleted.

ALTER TABLE ai_automation_rules
  DROP CONSTRAINT IF EXISTS ai_automation_rules_rule_type_check;

ALTER TABLE ai_automation_rules
  ADD CONSTRAINT ai_automation_rules_rule_type_check
  CHECK (rule_type IN (
    'daily_content_ideas',
    'weekly_summary',
    'post_stream_recap',
    'affiliate_campaign',
    'short_video_autopilot',
    'evergreen_repurpose'
  ));
