-- ─── 020: Stream archives — cloud copy of recorded streams ──────────
--
-- Phase 3 of the subscription/storage system. Adds a stream_archives
-- table that records each cloud-stored copy of a recorded stream.
-- Today the only supported provider is Cloudflare R2; the column is
-- broad enough to add Backblaze, S3, GCS, etc. without a migration.
--
-- DESIGN
-- ------
-- One row per archive attempt. The lifecycle is:
--
--   pending  → host requested an archive; presigned URL was minted.
--   uploading → browser is PUTting the blob (best-effort; we may not
--               see this state if the browser crashes mid-upload).
--   ready    → finalize endpoint confirmed the object is visible in R2.
--   failed   → finalize failed or the host abandoned the upload.
--
-- We never delete archive rows when the underlying stream is deleted —
-- a host who paid for archive storage should be able to download their
-- archives even after the stream row is gone. RLS uses host_id (not
-- stream_id) so the linkage survives stream deletion.
--
-- SAFETY
-- ------
-- - Additive only: no existing tables touched.
-- - RLS: hosts read/write their own; admins read all (for support).
-- - Object keys are scoped under "hosts/{host_id}/streams/{stream_id}/"
--   in the bucket, but that prefix is enforced in code, not here, so
--   admins can rebucket without a schema change.

CREATE TABLE IF NOT EXISTS stream_archives (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Stream may be deleted later; we keep the archive row.
  stream_id UUID REFERENCES streams(id) ON DELETE SET NULL,
  host_id UUID NOT NULL REFERENCES hosts(id) ON DELETE CASCADE,
  -- 'r2' for now. Future: 'b2', 's3', 'gcs'.
  provider TEXT NOT NULL DEFAULT 'r2',
  -- Bucket + key uniquely identify the object inside the provider.
  bucket TEXT NOT NULL,
  object_key TEXT NOT NULL,
  -- MIME type as reported by MediaRecorder. Used to render <video>.
  content_type TEXT NOT NULL DEFAULT 'video/webm',
  -- File size in bytes. Populated at finalize; null while uploading.
  byte_size BIGINT,
  -- Lifecycle. CHECK keeps a typo from rotting the dashboard.
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','uploading','ready','failed')),
  -- Public URL (if bucket is public) or null (signed-url-on-demand).
  public_url TEXT,
  -- Optional human-friendly title (defaults to stream.title at archive time).
  title TEXT,
  -- Free-form note from the host or admin.
  note TEXT,
  -- Set when the host marks the archive as failed or cancels mid-upload.
  failure_reason TEXT,
  -- Timestamps.
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  -- Per-row uniqueness on the bucket key so duplicate finalizes can't
  -- create dupe rows.
  UNIQUE (provider, bucket, object_key)
);

CREATE INDEX IF NOT EXISTS idx_stream_archives_host_id ON stream_archives (host_id);
CREATE INDEX IF NOT EXISTS idx_stream_archives_stream_id ON stream_archives (stream_id);
CREATE INDEX IF NOT EXISTS idx_stream_archives_status ON stream_archives (status);

-- ─── RLS ─────────────────────────────────────────────────────────────

ALTER TABLE stream_archives ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Hosts read own archives" ON stream_archives;
CREATE POLICY "Hosts read own archives" ON stream_archives
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM hosts
      WHERE hosts.id = stream_archives.host_id
        AND hosts.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Hosts write own archives" ON stream_archives;
CREATE POLICY "Hosts write own archives" ON stream_archives
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM hosts
      WHERE hosts.id = stream_archives.host_id
        AND hosts.user_id = auth.uid()
    )
  ) WITH CHECK (
    EXISTS (
      SELECT 1 FROM hosts
      WHERE hosts.id = stream_archives.host_id
        AND hosts.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Admins read all archives" ON stream_archives;
CREATE POLICY "Admins read all archives" ON stream_archives
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM hosts
      WHERE hosts.user_id = auth.uid()
        AND (hosts.role = 'admin' OR hosts.is_admin = TRUE)
    )
  );
