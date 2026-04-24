-- Add scrolling-ticker (news-crawl) fields to streams.
-- Host broadcasts `stream-ticker` on the existing chat channel AND persists
-- current state in these columns so mid-stream joiners see the current ticker.

ALTER TABLE streams
  ADD COLUMN IF NOT EXISTS ticker_active boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS ticker_message text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS ticker_speed text NOT NULL DEFAULT 'normal'
    CHECK (ticker_speed IN ('slow', 'normal', 'fast')),
  ADD COLUMN IF NOT EXISTS ticker_style text NOT NULL DEFAULT 'default'
    CHECK (ticker_style IN ('default', 'urgent', 'info'));
