-- 038_video_renders.sql
--
-- AI Short Video Creator — rendered output storage.
--
-- Stores the assembled video file produced by the canvas-based
-- video composer. Decoupled from stream_archives so video project
-- renders can appear in the Replay Library and Distribution pipeline
-- without requiring a live stream source.
--
-- Lifecycle (status):
--   pending   — row created, upload not yet started
--   uploading — browser PUT in progress
--   ready     — R2 upload complete; public_url or object_key is usable
--   failed    — upload or finalize step failed
--
-- SAFETY: Additive only. No existing tables modified.

CREATE TABLE IF NOT EXISTS video_renders (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  host_id      UUID NOT NULL REFERENCES hosts(id) ON DELETE CASCADE,
  project_id   UUID NOT NULL REFERENCES video_projects(id) ON DELETE CASCADE,
  object_key   TEXT,
  public_url   TEXT,
  content_type TEXT NOT NULL DEFAULT 'video/webm',
  byte_size    BIGINT NOT NULL DEFAULT 0,
  status       TEXT NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending', 'uploading', 'ready', 'failed')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_video_renders_host_id
  ON video_renders (host_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_video_renders_project_id
  ON video_renders (project_id);

DROP TRIGGER IF EXISTS video_renders_updated_at ON video_renders;

ALTER TABLE video_renders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Hosts manage own video renders" ON video_renders;
CREATE POLICY "Hosts manage own video renders" ON video_renders
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM hosts
      WHERE hosts.id = video_renders.host_id
        AND hosts.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM hosts
      WHERE hosts.id = video_renders.host_id
        AND hosts.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Admins read all video renders" ON video_renders;
CREATE POLICY "Admins read all video renders" ON video_renders
  FOR SELECT USING (public.is_admin_user());