-- Host-controlled image slideshow for viewers.
-- Design: each stream owns a small library of slides (URLs + captions). The
-- host picks which slide is currently shown and toggles the slideshow on/off.
-- Current state lives on the streams row so mid-stream joiners see the
-- correct slide on their initial fetch.

CREATE TABLE IF NOT EXISTS stream_slides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stream_id uuid NOT NULL REFERENCES streams(id) ON DELETE CASCADE,
  image_url text NOT NULL,
  caption text NOT NULL DEFAULT '',
  position integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS stream_slides_stream_id_position_idx
  ON stream_slides(stream_id, position);

ALTER TABLE streams
  ADD COLUMN IF NOT EXISTS slideshow_active boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS slideshow_current_url text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS slideshow_current_caption text NOT NULL DEFAULT '';

-- Enable RLS and basic policies (same pattern as chat_messages / streams).
ALTER TABLE stream_slides ENABLE ROW LEVEL SECURITY;

-- Anyone with the stream URL can see the slides list (public viewer experience).
DROP POLICY IF EXISTS "Public read stream_slides" ON stream_slides;
CREATE POLICY "Public read stream_slides" ON stream_slides
  FOR SELECT USING (true);

-- Only the stream owner (or co-hosts) can write. Mirrors the existing
-- permission model on streams: host_id = auth.uid().
DROP POLICY IF EXISTS "Host write stream_slides" ON stream_slides;
CREATE POLICY "Host write stream_slides" ON stream_slides
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM streams s
      WHERE s.id = stream_slides.stream_id
        AND s.host_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM streams s
      WHERE s.id = stream_slides.stream_id
        AND s.host_id = auth.uid()
    )
  );
