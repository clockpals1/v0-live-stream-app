-- ─── 023: Archive retention + soft delete ───────────────────────────
--
-- Adds the columns needed to enforce a per-plan retention window on
-- stream archives, plus host-initiated deletion. Without this,
-- recordings sit in R2 forever and storage costs grow unbounded.
--
-- DESIGN
-- ------
-- 1. Plan-driven retention.
--    Each billing_plans row gets a `retention_days` integer in its
--    `features` JSON column. Free plans get 30, paid plans 365 (admin
--    can override per plan via /admin/billing). NULL means no retention
--    cap (used for special plans / admins).
--
-- 2. Per-archive expiry.
--    `delete_after_at` is computed from the host's plan retention at
--    upload time and stored ON THE ROW. Storing it (instead of deriving
--    nightly from plan + completed_at) means a plan downgrade doesn't
--    retroactively shrink already-uploaded archives — important for
--    trust ("I paid for 365 days, you can't take that away").
--
-- 3. Soft delete.
--    `deleted_at` flips to a timestamp when (a) the host clicks the
--    delete button, (b) the cleanup cron runs and the archive is past
--    delete_after_at, or (c) an admin force-deletes. The R2 object is
--    deleted out-of-band by the cron worker; the row stays for the
--    audit trail (with deleted_by + delete_reason).
--
-- The cleanup cron only RUNS THE DELETE — it doesn't decide what to
-- delete. Anything where `deleted_at IS NULL AND delete_after_at <= now()`
-- is fair game. This keeps the schedule and policy decoupled.
-- ────────────────────────────────────────────────────────────────────

-- ─── Per-archive retention + delete columns ────────────────────────
ALTER TABLE stream_archives
  ADD COLUMN IF NOT EXISTS delete_after_at TIMESTAMPTZ;
COMMENT ON COLUMN stream_archives.delete_after_at IS
  'When the cron will hard-delete the R2 object. NULL = retain forever.';

ALTER TABLE stream_archives
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
COMMENT ON COLUMN stream_archives.deleted_at IS
  'Soft delete marker. Once set the row is no longer surfaced in any UI.';

ALTER TABLE stream_archives
  ADD COLUMN IF NOT EXISTS deleted_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE stream_archives
  ADD COLUMN IF NOT EXISTS delete_reason TEXT;
COMMENT ON COLUMN stream_archives.delete_reason IS
  '"host", "retention", "admin", or a free-form note for special cases.';

-- Allow the existing CHECK constraint to permit the new 'deleted' status
-- without touching legacy rows. We replace, not add a separate check.
ALTER TABLE stream_archives
  DROP CONSTRAINT IF EXISTS stream_archives_status_check;
ALTER TABLE stream_archives
  ADD CONSTRAINT stream_archives_status_check
  CHECK (status IN ('pending','uploading','ready','failed','deleted'));

-- Cleanup cron's hot path: "give me ready archives whose retention
-- window has expired." A partial index on the delete_after_at column
-- makes the cron O(targets-found) regardless of total archive count.
CREATE INDEX IF NOT EXISTS idx_stream_archives_due_for_deletion
  ON stream_archives (delete_after_at)
  WHERE deleted_at IS NULL AND status = 'ready';

-- Hosts looking at their dashboard want to filter out deleted rows
-- quickly; index supports `WHERE deleted_at IS NULL`.
CREATE INDEX IF NOT EXISTS idx_stream_archives_host_active
  ON stream_archives (host_id, completed_at DESC)
  WHERE deleted_at IS NULL;

-- ─── Plan default retention ───────────────────────────────────────
--
-- Backfill a sensible retention for the existing plans. Free → 30
-- days; everything else → 365 days. Admins can rewrite per-plan in the
-- billing UI; new plans created later will not have the key set, which
-- is treated as "no retention cap" (admin must opt in).
UPDATE billing_plans
   SET features = COALESCE(features, '{}'::jsonb) || jsonb_build_object('retention_days', 30)
 WHERE slug = 'free'
   AND NOT (features ? 'retention_days');

UPDATE billing_plans
   SET features = COALESCE(features, '{}'::jsonb) || jsonb_build_object('retention_days', 365)
 WHERE slug <> 'free'
   AND NOT (features ? 'retention_days');

-- Backfill delete_after_at on existing archives so the cron won't
-- immediately delete them. We use 365 days from completed_at as a
-- safe default — admins can run a one-off UPDATE if they want a
-- different window.
UPDATE stream_archives
   SET delete_after_at = COALESCE(completed_at, created_at) + INTERVAL '365 days'
 WHERE delete_after_at IS NULL
   AND deleted_at IS NULL;

COMMENT ON TABLE stream_archives IS
  'One row per archive attempt. Soft-deleted rows are kept for audit; the R2 object is hard-deleted by the retention cron.';
