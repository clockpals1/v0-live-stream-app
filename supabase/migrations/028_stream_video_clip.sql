-- 028_stream_video_clip.sql
--
-- Add per-stream short-video clip state. A "clip" is a host-uploaded
-- video (mp4 / webm, < 30 MB) that the host can roll over their live
-- stream — typical use is a B-roll, intro bumper, sponsor spot, or
-- "we'll be right back" interstitial.
--
-- The columns mirror the slideshow_* / overlay_* pattern already used
-- elsewhere on the streams table so the live-control-room hydration
-- effect stays consistent (single SELECT, simple flat fields).
--
--   clip_url       text     — public URL of the uploaded video.
--                              Stored in the stream-overlays bucket
--                              under {stream_id}/clips/{ts}.{ext}.
--                              Null when no clip is loaded.
--   clip_active    boolean  — true while the clip is being played to
--                              viewers; flipped by the host's Play /
--                              Stop buttons. Survives a page reload
--                              so accidental refreshes don't kill the
--                              broadcast.
--   clip_mute_mic  boolean  — host preference: when true, the host's
--                              microphone is muted for the duration of
--                              the clip's playback (the clip's own
--                              audio fills the space) and restored to
--                              its previous state on Stop.
--   clip_caption   text     — optional short caption shown over the
--                              clip on the viewer side.
--
-- All columns default to safe values so the client tolerates rows on
-- un-migrated databases (treats nulls as "no clip"). RLS is unchanged.

ALTER TABLE public.streams
  ADD COLUMN IF NOT EXISTS clip_url       text,
  ADD COLUMN IF NOT EXISTS clip_active    boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS clip_mute_mic  boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS clip_caption   text;

COMMENT ON COLUMN public.streams.clip_url
  IS 'Host-uploaded short video (mp4/webm) overlaid on the live stream during playback.';
COMMENT ON COLUMN public.streams.clip_active
  IS 'Whether the clip is currently being played to viewers.';
COMMENT ON COLUMN public.streams.clip_mute_mic
  IS 'When true, mute host mic while clip plays; restore prior state on stop.';
COMMENT ON COLUMN public.streams.clip_caption
  IS 'Optional caption shown over the clip on the viewer side.';
