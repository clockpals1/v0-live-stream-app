-- 037_video_projects.sql
--
-- Short Video Creator — dedicated project entity.
--
-- Each AI-generated short video creates one video_project row. This is the
-- canonical record for the full creative package: hook, concept, script,
-- scenes, CTA, caption, and the production pipeline state through to publish.
--
-- Status lifecycle:
--   script_ready      — AI generated hook/script/CTA/caption; basic scenes seeded
--   scenes_generated  — user confirmed or refined scene breakdown
--   visuals_pending   — visual/asset generation requested
--   voiceover_pending — voiceover generation requested
--   preview_ready     — preview assembled, awaiting user review
--   rendering         — final render in progress
--   published         — pushed to platform via publish_queue
--
-- Scene JSONB element shape:
--   {
--     "id":            "scene_1",
--     "order":         1,
--     "duration":      3,
--     "type":          "hook" | "setup" | "main" | "cta" | "outro",
--     "script":        "full script text for this scene",
--     "visual_prompt": "visual direction / prompt",
--     "shot_type":     "close-up" | "mid-shot" | "wide",
--     "on_screen_text": "text overlay for this scene",
--     "notes":         "production notes"
--   }
--
-- SAFETY: Additive only. No existing tables modified.

CREATE TABLE IF NOT EXISTS video_projects (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  host_id           UUID NOT NULL REFERENCES hosts(id) ON DELETE CASCADE,
  asset_id          UUID REFERENCES ai_generated_assets(id) ON DELETE SET NULL,
  publish_queue_id  UUID REFERENCES publish_queue(id) ON DELETE SET NULL,

  -- Project identity
  title             TEXT NOT NULL,
  platform          TEXT CHECK (platform IN (
    'youtube', 'tiktok', 'instagram', 'twitter', 'linkedin', 'generic'
  )),
  video_length      TEXT NOT NULL DEFAULT '30',  -- '15' | '30' | '60'

  -- Overall project status
  status            TEXT NOT NULL DEFAULT 'script_ready' CHECK (status IN (
    'script_ready', 'scenes_generated', 'visuals_pending',
    'voiceover_pending', 'preview_ready', 'rendering', 'published'
  )),

  -- Core creative content (parsed from AI output)
  hook              TEXT,
  concept           TEXT,
  script_body       TEXT,
  cta               TEXT,
  caption           TEXT,

  -- Structured scene list (JSONB array of scene objects)
  scenes            JSONB NOT NULL DEFAULT '[]',

  -- Production pipeline sub-states
  voiceover_status  TEXT NOT NULL DEFAULT 'pending' CHECK (voiceover_status IN (
    'pending', 'generating', 'ready'
  )),
  render_status     TEXT NOT NULL DEFAULT 'pending' CHECK (render_status IN (
    'pending', 'rendering', 'ready', 'failed'
  )),

  -- Output artifact URLs
  preview_url       TEXT,
  render_url        TEXT,

  -- Extra metadata (tone, niche, monetization_angle, ai model, etc.)
  metadata          JSONB NOT NULL DEFAULT '{}',

  -- Soft delete
  archived_at       TIMESTAMPTZ,

  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_video_projects_host
  ON video_projects (host_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_video_projects_asset
  ON video_projects (asset_id);

CREATE INDEX IF NOT EXISTS idx_video_projects_active_status
  ON video_projects (host_id, status)
  WHERE archived_at IS NULL;

DROP TRIGGER IF EXISTS video_projects_updated_at ON video_projects;
CREATE TRIGGER video_projects_updated_at
  BEFORE UPDATE ON video_projects
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ─── RLS ─────────────────────────────────────────────────────────────

ALTER TABLE video_projects ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Hosts manage own video projects" ON video_projects;
CREATE POLICY "Hosts manage own video projects" ON video_projects
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM hosts
      WHERE hosts.id = video_projects.host_id
        AND hosts.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM hosts
      WHERE hosts.id = video_projects.host_id
        AND hosts.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Admins read all video projects" ON video_projects;
CREATE POLICY "Admins read all video projects" ON video_projects
  FOR SELECT USING (public.is_admin_user());
