-- 026_replay_social.sql
--
-- Phase 2 of the Replay product surface: social engagement.
--
-- Adds three things on top of migration 025:
--   1. replay_likes        — one row per (replay, viewer)
--   2. replay_comments     — flat comment thread; soft-delete via deleted_at
--   3. counter triggers    — keep replay_publications.like_count /
--                            comment_count denormalised. The Studio
--                            library and public listing read the
--                            counter directly, no aggregate joins.
--
-- Plus two ancillary changes:
--   - public read policy on stream_archives for archives backing a
--     published replay (the player needs public_url / content_type)
--   - increment_replay_view(uuid) RPC so anonymous visitors can bump
--     the view counter without an UPDATE policy on the table
--
-- DESIGN NOTES
-- ------------
-- - viewer_id is auth.uid(); anonymous likes/comments aren't allowed.
--   Anonymous users CAN watch and bump view_count, but engagement
--   actions require a session — same model as YouTube/Twitch.
-- - Comments soft-delete (deleted_at) so threading stays visible
--   ("[comment removed]") and counter triggers stay simple.
-- - Counters are touched by AFTER triggers, never by the app code,
--   so there's exactly ONE place that maintains them. App writes
--   stay drift-free.
-- - Idempotent: every CREATE has IF NOT EXISTS, every policy is
--   dropped before re-creating.

-- ─── Likes ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS replay_likes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  replay_id   uuid NOT NULL REFERENCES replay_publications(id) ON DELETE CASCADE,
  viewer_id   uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (replay_id, viewer_id)
);

CREATE INDEX IF NOT EXISTS idx_replay_likes_replay
  ON replay_likes(replay_id);

ALTER TABLE replay_likes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone authed can like" ON replay_likes;
CREATE POLICY "Anyone authed can like" ON replay_likes
  FOR INSERT
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND viewer_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM replay_publications rp
      WHERE rp.id = replay_id AND rp.is_published = true
    )
  );

DROP POLICY IF EXISTS "Viewers see all likes on published replays" ON replay_likes;
CREATE POLICY "Viewers see all likes on published replays" ON replay_likes
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM replay_publications rp
      WHERE rp.id = replay_likes.replay_id AND rp.is_published = true
    )
  );

DROP POLICY IF EXISTS "Viewers remove their own likes" ON replay_likes;
CREATE POLICY "Viewers remove their own likes" ON replay_likes
  FOR DELETE
  USING (viewer_id = auth.uid());

-- ─── Comments ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS replay_comments (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  replay_id   uuid NOT NULL REFERENCES replay_publications(id) ON DELETE CASCADE,
  viewer_id   uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- Cached display name at write time. Avoids a join to hosts on every
  -- read AND lets users comment without ever owning a hosts row (most
  -- viewers never will).
  display_name text NOT NULL,
  body        text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 2000),
  created_at  timestamptz NOT NULL DEFAULT now(),
  -- Soft-delete: row stays so the counter trigger logic doesn't have to
  -- track DELETEs and so threads can render "[removed]" inline.
  deleted_at  timestamptz
);

CREATE INDEX IF NOT EXISTS idx_replay_comments_replay
  ON replay_comments(replay_id, created_at DESC);

ALTER TABLE replay_comments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public reads comments on published replays" ON replay_comments;
CREATE POLICY "Public reads comments on published replays" ON replay_comments
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM replay_publications rp
      WHERE rp.id = replay_comments.replay_id AND rp.is_published = true
    )
  );

DROP POLICY IF EXISTS "Authed users post comments" ON replay_comments;
CREATE POLICY "Authed users post comments" ON replay_comments
  FOR INSERT
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND viewer_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM replay_publications rp
      WHERE rp.id = replay_id AND rp.is_published = true
    )
  );

-- Author can soft-delete their comment; the host of the replay can
-- moderate (delete) any comment on their replay.
DROP POLICY IF EXISTS "Author or host soft-deletes comments" ON replay_comments;
CREATE POLICY "Author or host soft-deletes comments" ON replay_comments
  FOR UPDATE
  USING (
    viewer_id = auth.uid()
    OR EXISTS (
      SELECT 1
      FROM replay_publications rp
      JOIN hosts h ON h.id = rp.host_id
      WHERE rp.id = replay_comments.replay_id
        AND h.user_id = auth.uid()
    )
  )
  WITH CHECK (
    viewer_id = auth.uid()
    OR EXISTS (
      SELECT 1
      FROM replay_publications rp
      JOIN hosts h ON h.id = rp.host_id
      WHERE rp.id = replay_comments.replay_id
        AND h.user_id = auth.uid()
    )
  );

-- ─── Counter triggers ──────────────────────────────────────────────────
-- like_count: bumps on INSERT, drops on DELETE.
CREATE OR REPLACE FUNCTION public.replay_likes_bump_counter()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE replay_publications
       SET like_count = like_count + 1
     WHERE id = NEW.replay_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE replay_publications
       SET like_count = GREATEST(like_count - 1, 0)
     WHERE id = OLD.replay_id;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS trg_replay_likes_counter ON replay_likes;
CREATE TRIGGER trg_replay_likes_counter
  AFTER INSERT OR DELETE ON replay_likes
  FOR EACH ROW EXECUTE FUNCTION public.replay_likes_bump_counter();

-- comment_count: only counts non-deleted rows. INSERT bumps; UPDATE
-- watches deleted_at flipping non-null (soft-delete) and bumps it
-- back if a soft-deleted row is restored. DELETE (hard) drops if
-- still visible.
CREATE OR REPLACE FUNCTION public.replay_comments_bump_counter()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.deleted_at IS NULL THEN
    UPDATE replay_publications
       SET comment_count = comment_count + 1
     WHERE id = NEW.replay_id;
  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN
      UPDATE replay_publications
         SET comment_count = GREATEST(comment_count - 1, 0)
       WHERE id = NEW.replay_id;
    ELSIF OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL THEN
      UPDATE replay_publications
         SET comment_count = comment_count + 1
       WHERE id = NEW.replay_id;
    END IF;
  ELSIF TG_OP = 'DELETE' AND OLD.deleted_at IS NULL THEN
    UPDATE replay_publications
       SET comment_count = GREATEST(comment_count - 1, 0)
     WHERE id = OLD.replay_id;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS trg_replay_comments_counter ON replay_comments;
CREATE TRIGGER trg_replay_comments_counter
  AFTER INSERT OR UPDATE OR DELETE ON replay_comments
  FOR EACH ROW EXECUTE FUNCTION public.replay_comments_bump_counter();

-- ─── View counter RPC ─────────────────────────────────────────────────
-- Anonymous visitors need to bump view_count without our giving them
-- an UPDATE policy on replay_publications. SECURITY DEFINER lets the
-- function run with the table owner's privileges; we keep the surface
-- minimal (one column, only on published rows).
CREATE OR REPLACE FUNCTION public.increment_replay_view(p_replay_id uuid)
RETURNS void AS $$
BEGIN
  UPDATE replay_publications
     SET view_count = view_count + 1
   WHERE id = p_replay_id
     AND is_published = true;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION public.increment_replay_view(uuid) TO anon, authenticated;

-- ─── Public archive read for the player ───────────────────────────────
-- The replay page renders <video src={archive.public_url}>. Anonymous
-- users can't read stream_archives by default (migration 020 only
-- allows the owning host). Add a narrow SELECT policy that lets the
-- public read ONLY the archives backing a currently-published replay.
DROP POLICY IF EXISTS "Public reads archives behind published replays" ON stream_archives;
CREATE POLICY "Public reads archives behind published replays" ON stream_archives
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM replay_publications rp
      WHERE rp.archive_id = stream_archives.id
        AND rp.is_published = true
    )
  );
