-- ===========================================================================
--  HOTFIX A — apply missing migration 010 (stream_ticker columns).
--  Safe to run mid-event:
--   * ADD COLUMN IF NOT EXISTS is idempotent.
--   * Every column has a NOT NULL DEFAULT, so existing rows backfill instantly.
--   * No data is read or modified anywhere else.
--   * Triggers, RLS, indexes, and the lifecycle guard are untouched.
-- ===========================================================================

ALTER TABLE streams
  ADD COLUMN IF NOT EXISTS ticker_active  boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS ticker_message text    NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS ticker_speed   text    NOT NULL DEFAULT 'normal'
    CHECK (ticker_speed IN ('slow', 'normal', 'fast')),
  ADD COLUMN IF NOT EXISTS ticker_style   text    NOT NULL DEFAULT 'default'
    CHECK (ticker_style IN ('default', 'urgent', 'info'));

-- Verify (should print 4 rows: ticker_active, ticker_message, ticker_speed, ticker_style)
SELECT column_name, data_type, column_default
  FROM information_schema.columns
 WHERE table_schema = 'public'
   AND table_name   = 'streams'
   AND column_name LIKE 'ticker_%'
 ORDER BY column_name;
