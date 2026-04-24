-- Adds image support to the stream overlay (announcements / break screens).
-- Host can upload an image from their PC/device; viewers see it full-bleed
-- as the overlay background, with the optional text message on top.

ALTER TABLE streams
  ADD COLUMN IF NOT EXISTS overlay_image_url text NOT NULL DEFAULT '';

-- Create the public storage bucket for overlay images.
-- Public read so viewers can load the image; authenticated write so only
-- signed-in hosts can upload.
INSERT INTO storage.buckets (id, name, public)
VALUES ('stream-overlays', 'stream-overlays', true)
ON CONFLICT (id) DO UPDATE SET public = EXCLUDED.public;

-- Storage policies. Idempotent — drop then recreate so re-running is safe.
DROP POLICY IF EXISTS "stream-overlays public read" ON storage.objects;
CREATE POLICY "stream-overlays public read"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'stream-overlays');

DROP POLICY IF EXISTS "stream-overlays authed upload" ON storage.objects;
CREATE POLICY "stream-overlays authed upload"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'stream-overlays');

DROP POLICY IF EXISTS "stream-overlays owner delete" ON storage.objects;
CREATE POLICY "stream-overlays owner delete"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'stream-overlays' AND owner = auth.uid());

DROP POLICY IF EXISTS "stream-overlays owner update" ON storage.objects;
CREATE POLICY "stream-overlays owner update"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (bucket_id = 'stream-overlays' AND owner = auth.uid());
