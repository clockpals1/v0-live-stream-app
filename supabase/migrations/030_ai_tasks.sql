-- 030_ai_tasks.sql
--
-- AI Automation Hub — job queue.
--
-- Every AI generation request (manual or automated) creates a row here.
-- The lifecycle is:
--   pending  → task created, not yet started
--   running  → AI provider called, awaiting response
--   done     → output written, host notified
--   failed   → provider error or timeout; error column holds reason
--   cancelled→ host cancelled before completion
--
-- task_type covers all current + planned workflows:
--   manual:    script_gen, caption_gen, hashtag_gen, title_gen,
--              affiliate_campaign, content_ideas, replay_repurpose
--   automated: daily_ideas, weekly_summary, post_stream_recap
--
-- SAFETY
-- ------
-- Additive only. RLS: hosts see their own tasks; admins see all.

CREATE TABLE IF NOT EXISTS ai_tasks (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  host_id       UUID NOT NULL REFERENCES hosts(id) ON DELETE CASCADE,
  task_type     TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'running', 'done', 'failed', 'cancelled')),
  -- input: prompt, topic, tone, platform, any context the AI needs
  input         JSONB NOT NULL DEFAULT '{}',
  -- output: generated text, structured results
  output        JSONB,
  -- which AI provider + model was used
  provider      TEXT,
  model         TEXT,
  tokens_used   INTEGER,
  error         TEXT,
  -- optional link back to the source content
  source_type   TEXT CHECK (source_type IN ('stream', 'replay', 'manual', 'automation')),
  source_id     UUID,
  -- timing
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at    TIMESTAMPTZ,
  completed_at  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_ai_tasks_host_id   ON ai_tasks(host_id);
CREATE INDEX IF NOT EXISTS idx_ai_tasks_status    ON ai_tasks(status);
CREATE INDEX IF NOT EXISTS idx_ai_tasks_created   ON ai_tasks(host_id, created_at DESC);

-- Partial index for the automation cron — only pending rows need scanning.
CREATE INDEX IF NOT EXISTS idx_ai_tasks_pending
  ON ai_tasks(created_at)
  WHERE status = 'pending';

ALTER TABLE ai_tasks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Hosts manage own ai tasks" ON ai_tasks;
CREATE POLICY "Hosts manage own ai tasks" ON ai_tasks
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM hosts
      WHERE hosts.id = ai_tasks.host_id
        AND hosts.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM hosts
      WHERE hosts.id = ai_tasks.host_id
        AND hosts.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Admins read all ai tasks" ON ai_tasks;
CREATE POLICY "Admins read all ai tasks" ON ai_tasks
  FOR SELECT USING (public.is_admin_user());
