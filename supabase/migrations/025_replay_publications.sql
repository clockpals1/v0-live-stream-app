-- 025_replay_publications.sql
--
-- Replay Library — publication metadata layer.
--
-- DESIGN
-- ------
-- We deliberately do NOT extend `stream_archives` (migration 020) with
-- publishing fields. `stream_archives` is a STORAGE row — it answers
-- "where do the bytes live, when do they expire". A replay is a
-- PUBLICATION — it answers "what does the host want viewers to see, what's
-- the title, is it featured, what's the public slug".
--
-- Keeping these concerns in separate tables means:
--   - retention/lifecycle on stream_archives stays unchanged
--   - a host can have an archive that is NOT published yet
--   - in the future a single archive could spawn multiple "clips" (each
--     its own row pointing back to one archive)
--
-- ENGAGEMENT COUNTERS
-- -------------------
-- like_count / comment_count / view_count are denormalised on this table
-- so a public replay listing doesn't need to aggregate joins on every
-- request. They will be maintained by triggers on the (future) likes /
-- comments tables in Phase 2. For now they just default to zero.
--
-- IDEMPOTENCY
-- -----------
-- Standard CREATE TABLE IF NOT EXISTS + DROP POLICY IF EXISTS pattern
-- so re-running this migration after partial failure is safe.

CREATE TABLE IF NOT EXISTS replay_publications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  archive_id uuid NOT NULL REFERENCES stream_archives(id) ON DELETE CASCADE,
  host_id uuid NOT NULL REFERENCES hosts(id) ON DELETE CASCADE,
  -- Public URL slug; namespaced under the host's id so we don't need a
  -- global uniqueness constraint and hosts can pick whatever they want.
  slug text NOT NULL,
  title text NOT NULL,
  description text,
  thumbnail_url text,
  -- Publishing state. Two booleans rather than an enum so checks are
  -- trivially indexable and a host can toggle publish/feature
  -- independently.
  is_published boolean NOT NULL DEFAULT false,
  is_featured boolean NOT NULL DEFAULT false,
  published_at timestamptz,
  -- Denormalised engagement counters (Phase 2 will populate via triggers).
  view_count integer NOT NULL DEFAULT 0,
  like_count integer NOT NULL DEFAULT 0,
  comment_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- One publication per archive; if a host wants to "republish" they
  -- update the existing row.
  UNIQUE (archive_id),
  -- Slug must be unique per host so the public URL is unambiguous:
  --   /r/{host_slug}/{replay_slug}
  UNIQUE (host_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_replay_publications_host
  ON replay_publications(host_id);

-- Index that powers the "show me all published replays" feed.
-- Partial index keeps it small (only published rows are indexed).
CREATE INDEX IF NOT EXISTS idx_replay_publications_published
  ON replay_publications(host_id, published_at DESC)
  WHERE is_published = true;

-- updated_at trigger — keep the timestamp fresh on any UPDATE without
-- requiring callers to remember to set it.
CREATE OR REPLACE FUNCTION touch_replay_publications_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_replay_publications_touch ON replay_publications;
CREATE TRIGGER trg_replay_publications_touch
  BEFORE UPDATE ON replay_publications
  FOR EACH ROW
  EXECUTE FUNCTION touch_replay_publications_updated_at();

-- ─── RLS ────────────────────────────────────────────────────────────────
-- Hosts manage their own publications. The public can SELECT only
-- rows where is_published = true (the public replay page reads anon).
ALTER TABLE replay_publications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Hosts manage their own publications" ON replay_publications;
CREATE POLICY "Hosts manage their own publications" ON replay_publications
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM hosts
      WHERE hosts.id = replay_publications.host_id
        AND hosts.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM hosts
      WHERE hosts.id = replay_publications.host_id
        AND hosts.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Public can view published replays" ON replay_publications;
CREATE POLICY "Public can view published replays" ON replay_publications
  FOR SELECT
  USING (is_published = true);
