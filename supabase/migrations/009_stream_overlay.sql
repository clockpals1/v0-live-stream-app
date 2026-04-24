-- Add host-controlled overlay fields to streams for real-time announcement/cue overlays
-- The host broadcasts `stream-overlay` events via the existing chat-room channel AND
-- persists current state in these columns so mid-stream joiners see the current overlay.

ALTER TABLE streams
  ADD COLUMN IF NOT EXISTS overlay_active boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS overlay_message text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS overlay_background text NOT NULL DEFAULT 'dark'
    CHECK (overlay_background IN ('dark', 'light', 'branded'));

-- Public viewers already have SELECT on streams via existing policies, so no extra
-- RLS needed. Hosts can UPDATE their own streams via existing policy.
