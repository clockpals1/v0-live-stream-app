-- 031_ai_generated_assets.sql
--
-- AI Automation Hub — generated content storage.
--
-- One row per piece of AI-generated content. Decoupled from ai_tasks so
-- a single task can produce multiple assets (e.g. 3 caption variants from
-- one caption_gen task) and assets can be created / edited manually later.
--
-- asset_type values:
--   script           — full stream script (intro, body, CTA)
--   caption          — social media caption
--   hashtags         — platform hashtag pack (stored as JSON array in content)
--   title            — video/stream title variant
--   summary          — weekly or post-stream performance summary
--   campaign_copy    — affiliate/product campaign copy
--   content_ideas    — bulleted idea list
--   short_video_script — short-form (TikTok/Reels) script
--   thumbnail_prompt — image generation prompt for thumbnail
--
-- SAFETY: Additive only. Soft-delete via archived_at, not hard DELETE.

CREATE TABLE IF NOT EXISTS ai_generated_assets (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  host_id           UUID NOT NULL REFERENCES hosts(id) ON DELETE CASCADE,
  task_id           UUID REFERENCES ai_tasks(id) ON DELETE SET NULL,
  asset_type        TEXT NOT NULL,
  title             TEXT,
  -- The actual generated text. For hashtags this is a JSON array string.
  content           TEXT NOT NULL,
  -- Extra metadata: word_count, tone, platform, language, model, etc.
  metadata          JSONB NOT NULL DEFAULT '{}',
  -- Target platform context the asset was optimised for.
  platform          TEXT CHECK (platform IN (
    'youtube', 'tiktok', 'instagram', 'twitter', 'linkedin', 'generic'
  )),
  -- Optional backlinks to source content used as context.
  source_stream_id  UUID REFERENCES streams(id) ON DELETE SET NULL,
  source_replay_id  UUID REFERENCES replay_publications(id) ON DELETE SET NULL,
  -- Host-driven state flags.
  is_used           BOOLEAN NOT NULL DEFAULT FALSE,  -- applied to a stream/post
  is_starred        BOOLEAN NOT NULL DEFAULT FALSE,
  -- Soft delete. Keeps asset visible to host as "archived" without DB purge.
  archived_at       TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_assets_host_id
  ON ai_generated_assets(host_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_assets_task_id
  ON ai_generated_assets(task_id);
CREATE INDEX IF NOT EXISTS idx_ai_assets_type
  ON ai_generated_assets(host_id, asset_type);

-- Partial index for "recent non-archived assets" list — the most common query.
CREATE INDEX IF NOT EXISTS idx_ai_assets_active
  ON ai_generated_assets(host_id, created_at DESC)
  WHERE archived_at IS NULL;

ALTER TABLE ai_generated_assets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Hosts manage own ai assets" ON ai_generated_assets;
CREATE POLICY "Hosts manage own ai assets" ON ai_generated_assets
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM hosts
      WHERE hosts.id = ai_generated_assets.host_id
        AND hosts.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM hosts
      WHERE hosts.id = ai_generated_assets.host_id
        AND hosts.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Admins read all ai assets" ON ai_generated_assets;
CREATE POLICY "Admins read all ai assets" ON ai_generated_assets
  FOR SELECT USING (public.is_admin_user());
