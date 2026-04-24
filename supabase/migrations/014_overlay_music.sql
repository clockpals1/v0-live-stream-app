-- Adds music support to the image overlay workflow.
-- Host uploads an audio file and plays it live; the audio is attached to
-- the outgoing WebRTC stream by track replacement (no renegotiation).
-- Audio files are stored in the existing 'stream-overlays' public bucket.

ALTER TABLE streams
  ADD COLUMN IF NOT EXISTS overlay_music_url      text    NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS overlay_music_active   boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS overlay_music_volume   real    NOT NULL DEFAULT 0.8
    CHECK (overlay_music_volume >= 0 AND overlay_music_volume <= 1),
  ADD COLUMN IF NOT EXISTS overlay_music_mix_mic  boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN streams.overlay_music_url IS 'Public URL of uploaded overlay music (empty = none)';
COMMENT ON COLUMN streams.overlay_music_active IS 'True while host is playing the music into the live stream';
COMMENT ON COLUMN streams.overlay_music_volume IS 'Music volume 0..1 (applied by host-side Web Audio gain)';
COMMENT ON COLUMN streams.overlay_music_mix_mic IS 'When true, host mic is mixed with music; when false, mic is muted while playing';
