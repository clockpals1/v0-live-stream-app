-- =========================================================================
--  ONE-SHOT diagnostic. Returns a single JSONB row with everything I need
--  to pinpoint both 400 errors. Read-only / self-cleaning.
--
--  Usage:
--    1. Supabase Dashboard → SQL Editor → New query
--    2. Paste this whole file
--    3. Run
--    4. Click the cell value to expand the JSON → "Copy"
--    5. Paste back to me
-- =========================================================================

-- Step A: try the viewer insert in isolation. Whatever happens, we capture
-- the outcome (success or exact Postgres error) into a session-temp table.
-- The temp table evaporates at end of session, so this leaves no trace.
DROP TABLE IF EXISTS _diag_insert_result;
CREATE TEMP TABLE _diag_insert_result (status text, detail text);

DO $$
DECLARE
  v_stream_id uuid;
  v_inserted  uuid;
BEGIN
  SELECT id INTO v_stream_id
    FROM streams
   WHERE status IN ('live','waiting')
   ORDER BY created_at DESC
   LIMIT 1;

  IF v_stream_id IS NULL THEN
    INSERT INTO _diag_insert_result VALUES
      ('NO_LIVE_OR_WAITING_STREAM', 'no streams matched status in (live,waiting)');
    RETURN;
  END IF;

  BEGIN
    INSERT INTO viewers (stream_id, name, joined_at)
    VALUES (v_stream_id, '__diagnostic_probe__', NOW())
    RETURNING id INTO v_inserted;

    DELETE FROM viewers WHERE id = v_inserted;

    INSERT INTO _diag_insert_result VALUES
      ('OK_insert_and_delete_succeeded',
       format('probed against stream %s', v_stream_id));
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _diag_insert_result VALUES
      ('INSERT_FAILED',
       format('sqlstate=%s message=%s', SQLSTATE, SQLERRM));
  END;
END $$;

-- Step B: build the unified JSON report.
SELECT jsonb_pretty(jsonb_build_object(

  'slideshow_columns_present',
    (SELECT jsonb_agg(column_name ORDER BY column_name)
       FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name   = 'streams'
        AND column_name LIKE 'slideshow_%'),

  'streams_columns_all',
    (SELECT jsonb_agg(column_name ORDER BY ordinal_position)
       FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name   = 'streams'),

  'viewers_columns_all',
    (SELECT jsonb_agg(jsonb_build_object(
            'name',     column_name,
            'type',     data_type,
            'nullable', is_nullable,
            'default',  column_default))
       FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name   = 'viewers'),

  'viewers_rls_policies',
    (SELECT jsonb_agg(jsonb_build_object(
            'name',       policyname,
            'cmd',        cmd,
            'roles',      roles,
            'using',      qual,
            'with_check', with_check))
       FROM pg_policies
      WHERE schemaname = 'public' AND tablename = 'viewers'),

  'viewers_triggers',
    (SELECT jsonb_agg(jsonb_build_object(
            'name',  trigger_name,
            'when',  action_timing,
            'event', event_manipulation,
            'stmt',  action_statement))
       FROM information_schema.triggers
      WHERE event_object_schema = 'public'
        AND event_object_table  = 'viewers'),

  'streams_triggers',
    (SELECT jsonb_agg(jsonb_build_object(
            'name',  trigger_name,
            'when',  action_timing,
            'event', event_manipulation,
            'stmt',  action_statement))
       FROM information_schema.triggers
      WHERE event_object_schema = 'public'
        AND event_object_table  = 'streams'),

  'sample_live_streams',
    (SELECT jsonb_agg(jsonb_build_object(
            'id',     id,
            'status', status,
            'code',   room_code))
       FROM (SELECT id, status, room_code FROM streams
              ORDER BY created_at DESC LIMIT 5) t),

  'reproduce_viewer_select',
    (SELECT CASE WHEN COUNT(*) = 0 THEN to_jsonb('NO_STREAMS_TO_TEST'::text)
                 ELSE to_jsonb('OK_select_succeeded'::text) END
       FROM (
         SELECT 1
           FROM streams
          WHERE id IN (SELECT id FROM streams LIMIT 1)
       ) probe),

  'dry_run_viewer_insert',
    (SELECT jsonb_build_object('status', status, 'detail', detail)
       FROM _diag_insert_result LIMIT 1),

  'postgres_version',
    (SELECT to_jsonb(version()))

)) AS diagnostic_report;
