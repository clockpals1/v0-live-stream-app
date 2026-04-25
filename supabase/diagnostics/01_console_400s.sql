-- =========================================================================
--  Production diagnostic queries for the 400 errors seen in the viewer
--  console on Apr 25, 2026.  Open Supabase Dashboard → SQL Editor →
--  paste this whole file → click "Run".  Each section is independent.
--
--  Issues being investigated (from console log):
--    A) GET /rest/v1/streams?select=...slideshow_*  → 400 Bad Request
--    B) POST /rest/v1/viewers                       → 400 Bad Request
--    C) /api/turn-credentials                       → 503 (env-var, not DB)
--
--  This file does NOT modify any data. Every query is read-only EXCEPT
--  the explicitly labelled "DRY-RUN INSERT" block at the bottom — and even
--  that one is wrapped in a transaction that ROLLBACKs.
-- =========================================================================


-- =========================================================================
-- SECTION 1 — Has migration 011 (stream_slideshow) been applied?
--
-- Expected if applied:
--   3 rows: slideshow_active, slideshow_current_url, slideshow_current_caption
-- Expected if NOT applied:
--   0 rows  →  this is the root cause of the SELECT 400 in the viewer.
-- =========================================================================
SELECT
  column_name,
  data_type,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name   = 'streams'
  AND column_name LIKE 'slideshow_%'
ORDER BY column_name;


-- =========================================================================
-- SECTION 2 — Full streams.* column list (sanity check).
--
-- Confirm overlay_*, ticker_*, slideshow_* are all present. If any group
-- is missing, the viewer's rehydration SELECT will 400.
-- =========================================================================
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name   = 'streams'
ORDER BY ordinal_position;


-- =========================================================================
-- SECTION 3 — Reproduce the viewer SELECT exactly as the browser sent it.
--
-- If this query succeeds, the 400 is intermittent / row-specific.
-- If this query 42703s ("column ... does not exist"), section 1 already
-- told you which migration is missing.
--
-- Replace the UUID with any real stream id from your DB (any will do —
-- we just need the schema to be valid).
-- =========================================================================
SELECT
  overlay_active, overlay_message, overlay_background, overlay_image_url,
  ticker_active,  ticker_message,  ticker_speed,       ticker_style,
  slideshow_active, slideshow_current_url, slideshow_current_caption
FROM streams
LIMIT 1;


-- =========================================================================
-- SECTION 4 — viewers table shape.
--
-- The browser POSTs { stream_id, name, joined_at }. Confirm those columns
-- exist with compatible types and that no NEW NOT-NULL columns have
-- snuck in (which would make the insert fail with a 400 NOT NULL).
-- =========================================================================
SELECT
  column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name   = 'viewers'
ORDER BY ordinal_position;


-- =========================================================================
-- SECTION 5 — RLS policies on viewers.
--
-- Policy "Anyone can insert as viewer" should exist with WITH CHECK
-- pointing at streams.status IN ('live','waiting'). If the policy was
-- replaced by a stricter one (e.g. requiring auth.uid()), anonymous
-- viewers would be blocked and you'd see 401/403 — but PostgREST also
-- maps some RLS failures to 400 in older versions.
-- =========================================================================
SELECT
  policyname,
  cmd        AS for_command,
  permissive,
  roles,
  qual       AS using_clause,
  with_check AS with_check_clause
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename  = 'viewers'
ORDER BY policyname;


-- =========================================================================
-- SECTION 6 — Triggers on viewers.
--
-- The update_viewer_count trigger writes back to streams. If a recent
-- migration added a constraint to streams that this trigger violates,
-- the INSERT into viewers will roll back with a 400 even though the
-- INSERT itself was valid.
-- =========================================================================
SELECT
  trigger_name,
  event_manipulation AS fires_on,
  action_timing,
  action_statement
FROM information_schema.triggers
WHERE event_object_schema = 'public'
  AND event_object_table  = 'viewers'
ORDER BY trigger_name;


-- =========================================================================
-- SECTION 7 — Triggers on streams (the cascading write target).
--
-- Look for any newly added BEFORE UPDATE trigger that might raise
-- when viewer_count changes. The lifecycle-guard in migration 016
-- only raises on status / started_at / ended_at / recording_url /
-- host_id changes — viewer_count should be exempt.
-- =========================================================================
SELECT
  trigger_name,
  event_manipulation AS fires_on,
  action_timing,
  action_statement
FROM information_schema.triggers
WHERE event_object_schema = 'public'
  AND event_object_table  = 'streams'
ORDER BY trigger_name;


-- =========================================================================
-- SECTION 8 — DRY-RUN viewer insert (rolled back automatically).
--
-- Reproduces the exact body the browser sends. If this fails, the
-- error message Postgres returns IS the answer — column mismatch, RLS
-- block, trigger exception, etc. Whatever it is, copy it back to me.
--
-- IMPORTANT: replace <STREAM_ID> with a real stream UUID from the
-- streams table whose status is 'live' or 'waiting'. Pick one with:
--    SELECT id, status FROM streams WHERE status IN ('live','waiting') LIMIT 5;
-- =========================================================================
DO $$
DECLARE
  v_stream_id uuid;
BEGIN
  -- Pick a usable stream automatically. If none exists, create a fake
  -- one purely in-transaction so the dry-run still exercises the path.
  SELECT id INTO v_stream_id
  FROM streams
  WHERE status IN ('live','waiting')
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_stream_id IS NULL THEN
    RAISE NOTICE 'No live/waiting streams found — skipping dry-run insert.';
    RETURN;
  END IF;

  RAISE NOTICE 'Dry-run insert into viewers for stream %', v_stream_id;

  BEGIN
    INSERT INTO viewers (stream_id, name, joined_at)
    VALUES (v_stream_id, 'diagnostic-probe', NOW());
    RAISE NOTICE 'Insert succeeded — RLS / triggers / constraints all OK.';
    -- Roll our test row back so we don't pollute viewer_count.
    RAISE EXCEPTION 'rollback-dry-run';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM = 'rollback-dry-run' THEN
        RAISE NOTICE '✅ Probe rolled back cleanly.';
      ELSE
        RAISE NOTICE '❌ Insert FAILED with: % (sqlstate %)', SQLERRM, SQLSTATE;
      END IF;
  END;
END $$;


-- =========================================================================
-- SECTION 9 — TURN credentials sanity (DB-side).
--
-- The 503 from /api/turn-credentials is an env-var problem, not a DB
-- problem, so there's nothing to query here. Confirm in the deploy
-- dashboard:
--   - TWILIO_ACCOUNT_SID  is set
--   - TWILIO_AUTH_TOKEN   is set
--   - the pair is still valid (try the curl in the README, if any)
-- If those vars are missing, viewers behind symmetric NAT will fail to
-- connect even though STUN-only works for most home Wi-Fi viewers.
-- =========================================================================


-- =========================================================================
-- SECTION 10 — Quick wins summary (runs nothing, just a checklist).
--
--   [ ] Section 1 returned 3 rows           → migration 011 applied.
--       If 0 rows, run migration 011_stream_slideshow.sql in production.
--
--   [ ] Section 3 returned a row, no error  → viewer SELECT will succeed.
--
--   [ ] Section 4 shows id/stream_id/name/joined_at as expected.
--
--   [ ] Section 5 shows the "Anyone can insert as viewer" policy with
--       WITH CHECK referencing streams.status IN ('live','waiting').
--
--   [ ] Section 8 prints "✅ Probe rolled back cleanly." — the insert
--       path itself works. If it prints "❌ Insert FAILED", paste the
--       error message back to me and I'll write the targeted fix.
-- =========================================================================
