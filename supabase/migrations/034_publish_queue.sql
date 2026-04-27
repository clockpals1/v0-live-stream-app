-- 034_publish_queue.sql
--
-- AI Publishing Hub — content publishing queue.
--
-- One row per "post" a creator intends to send to a social platform.
-- Decoupled from stream_archives (which is about storing recordings)
-- and from ai_generated_assets (which is about AI text generation).
-- A queue item can reference either or both.
--
-- Lifecycle (status):
--   draft       — item created, not yet approved for scheduling
--   approved    — ready to be scheduled or published
--   scheduled   — has a scheduled_for time set, waiting for that moment
--   publishing  — publish is in progress
--   published   — successfully posted; platform_post_id/url available
--   failed      — publish attempt failed; last_error explains why
--
-- Platform support (current + planned):
--   youtube     — video upload via existing R2→YouTube push flow
--   instagram   — coming soon (OAuth not yet configured)
--   tiktok      — coming soon
--   twitter     — coming soon
--   linkedin    — coming soon
--
-- platform_meta JSONB schema per platform:
--   youtube:   { title, description, privacy, tags[], thumbnail_prompt }
--   instagram: { caption, hashtags[], first_comment }
--   tiktok:    { caption, duet, stitch, view_privacy }
--   twitter:   { text, reply_settings }
--
-- AI scheduling:
--   ai_suggested_time  — time recommended by the scheduling suggestion endpoint
--   ai_suggestion_reason — human-readable explanation of why that slot was suggested
--
-- SAFETY: Additive only. No existing tables modified.

CREATE TABLE IF NOT EXISTS publish_queue (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  host_id              UUID NOT NULL REFERENCES hosts(id) ON DELETE CASCADE,

  -- Source content references (at least one should be set, both is valid)
  asset_id             UUID REFERENCES ai_generated_assets(id) ON DELETE SET NULL,
  archive_id           UUID REFERENCES stream_archives(id) ON DELETE SET NULL,

  -- Target platform
  platform             TEXT NOT NULL CHECK (platform IN (
    'youtube', 'instagram', 'tiktok', 'twitter', 'linkedin'
  )),

  -- Human-facing title for the queue item (copied from asset or entered manually)
  title                TEXT NOT NULL,
  -- Body text / caption / description for this item
  body                 TEXT,

  -- Platform-specific structured metadata (title, description, privacy, tags…)
  platform_meta        JSONB NOT NULL DEFAULT '{}',

  -- Lifecycle
  status               TEXT NOT NULL DEFAULT 'draft' CHECK (status IN (
    'draft', 'approved', 'scheduled', 'publishing', 'published', 'failed'
  )),

  -- Scheduling
  scheduled_for        TIMESTAMPTZ,
  published_at         TIMESTAMPTZ,

  -- Platform result after successful publish
  platform_post_id     TEXT,
  platform_post_url    TEXT,

  -- Retry / error tracking
  attempt_count        INTEGER NOT NULL DEFAULT 0,
  last_error           TEXT,
  last_attempt_at      TIMESTAMPTZ,

  -- AI scheduling hint (populated by /api/ai/publish/schedule/suggest)
  ai_suggested_time    TIMESTAMPTZ,
  ai_suggestion_reason TEXT,

  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index: list for a host ordered by status + scheduled_for (queue view)
CREATE INDEX IF NOT EXISTS idx_publish_queue_host_status
  ON publish_queue (host_id, status, scheduled_for);

-- Index: calendar view — scheduled items ordered by date
CREATE INDEX IF NOT EXISTS idx_publish_queue_scheduled
  ON publish_queue (host_id, scheduled_for)
  WHERE scheduled_for IS NOT NULL;

-- Partial index: cron sweep for items that are scheduled and overdue
CREATE INDEX IF NOT EXISTS idx_publish_queue_due
  ON publish_queue (scheduled_for)
  WHERE status = 'scheduled' AND scheduled_for IS NOT NULL;

DROP TRIGGER IF EXISTS publish_queue_updated_at ON publish_queue;
CREATE TRIGGER publish_queue_updated_at
  BEFORE UPDATE ON publish_queue
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ─── RLS ─────────────────────────────────────────────────────────────

ALTER TABLE publish_queue ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Hosts manage own publish queue" ON publish_queue;
CREATE POLICY "Hosts manage own publish queue" ON publish_queue
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM hosts
      WHERE hosts.id = publish_queue.host_id
        AND hosts.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM hosts
      WHERE hosts.id = publish_queue.host_id
        AND hosts.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Admins read all publish queue" ON publish_queue;
CREATE POLICY "Admins read all publish queue" ON publish_queue
  FOR SELECT USING (public.is_admin_user());
