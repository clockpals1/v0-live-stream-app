import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { deleteObject } from "@/lib/storage/r2";
import { reportError } from "@/lib/observability/sentry";

/**
 * GET/POST /api/cron/archives/cleanup
 *
 * Sweeps stream_archives and hard-deletes any whose retention window
 * has expired. Intended to be called by a Cloudflare Cron Trigger
 * (see wrangler.toml) on a daily schedule, but also callable manually
 * from a curl with the right secret for backfills.
 *
 * Selection rule (see migration 023):
 *     deleted_at IS NULL
 *   AND status = 'ready'
 *   AND delete_after_at IS NOT NULL
 *   AND delete_after_at <= now()
 *
 * The matching partial index `idx_stream_archives_due_for_deletion`
 * makes this query O(matches), so the job is cheap even with millions
 * of historical archive rows.
 *
 * AUTH
 * ----
 * Two valid callers:
 *   1. Cloudflare's Cron Trigger — the platform sets a header
 *      `cf-cron: 1` and routes through a privileged path; we don't
 *      receive arbitrary headers from the public internet.
 *   2. Manual operator with `Authorization: Bearer <CRON_SECRET>`.
 *      Set CRON_SECRET as a Worker secret.
 *
 * Without one of these the route 401s. We do NOT use Supabase auth
 * here — there's no human user driving this.
 *
 * SAFETY
 * ------
 * - `limit` query param caps the batch size (default 200, max 1000).
 *   This bounds Worker CPU/wall-clock time per invocation. Larger
 *   backlogs simply require multiple runs; the cron will catch up
 *   over a few days. Use the `limit` cap deliberately.
 * - On any per-archive R2 failure we log + skip — the row stays
 *   `deleted_at IS NULL` so the next run picks it up again.
 * - We never delete the row, only flag it. If you need to purge old
 *   audit rows, do that in a separate, deliberate migration.
 */

export async function GET(req: NextRequest) {
  return handleCleanup(req);
}

export async function POST(req: NextRequest) {
  return handleCleanup(req);
}

async function handleCleanup(req: NextRequest): Promise<NextResponse> {
  // ─── 1. Authorise ─────────────────────────────────────────────────
  const expected = process.env.CRON_SECRET;
  const authz = req.headers.get("authorization") ?? "";
  const bearer = authz.startsWith("Bearer ")
    ? authz.slice("Bearer ".length).trim()
    : null;
  // Cloudflare Cron triggers come in via the Worker's scheduled handler
  // which OpenNext maps to a fetch with this header. Either path counts.
  const isCron = req.headers.get("cf-cron") === "1";
  const isOperator = !!expected && bearer === expected;
  if (!isCron && !isOperator) {
    return NextResponse.json({ error: "Unauthorised." }, { status: 401 });
  }

  // ─── 2. Find candidates ───────────────────────────────────────────
  const url = new URL(req.url);
  const limitRaw = Number(url.searchParams.get("limit") ?? "200");
  const limit = Math.min(Math.max(1, Number.isFinite(limitRaw) ? limitRaw : 200), 1000);
  const dryRun = url.searchParams.get("dryRun") === "1";

  const admin = createAdminClient();
  const nowIso = new Date().toISOString();

  const { data: candidates, error: queryErr } = await admin
    .from("stream_archives")
    .select("id, object_key, host_id, stream_id, delete_after_at, byte_size")
    .is("deleted_at", null)
    .eq("status", "ready")
    .not("delete_after_at", "is", null)
    .lte("delete_after_at", nowIso)
    .order("delete_after_at", { ascending: true })
    .limit(limit);
  if (queryErr) {
    void reportError(queryErr, { source: "cron/archives/cleanup" });
    return NextResponse.json({ error: queryErr.message }, { status: 500 });
  }

  const targets = candidates ?? [];
  if (targets.length === 0) {
    return NextResponse.json({
      ok: true,
      scanned: 0,
      deleted: 0,
      failed: 0,
      message: "No expired archives.",
    });
  }

  if (dryRun) {
    return NextResponse.json({
      ok: true,
      dryRun: true,
      scanned: targets.length,
      preview: targets.slice(0, 10).map((t) => ({
        id: t.id,
        object_key: t.object_key,
        delete_after_at: t.delete_after_at,
      })),
    });
  }

  // ─── 3. Delete one at a time ─────────────────────────────────────
  // Sequential is intentional: bursting parallel R2 deletes risks
  // hitting the rate limit on a token, and the savings are tiny (each
  // delete is ~50ms). If we ever need higher throughput, batch with
  // a Promise.allSettled chunk size of 10.
  let deleted = 0;
  let failed = 0;
  let bytesFreed = 0;
  const errors: Array<{ id: string; reason: string }> = [];

  for (const t of targets) {
    const r2 = await deleteObject({ objectKey: t.object_key });
    if (!r2.ok) {
      failed++;
      errors.push({ id: t.id, reason: r2.error ?? `HTTP ${r2.status}` });
      continue;
    }

    const { error: updErr } = await admin
      .from("stream_archives")
      .update({
        status: "deleted",
        deleted_at: new Date().toISOString(),
        deleted_by: null,
        delete_reason: "retention",
        public_url: null,
      })
      .eq("id", t.id);
    if (updErr) {
      failed++;
      errors.push({ id: t.id, reason: `DB: ${updErr.message}` });
      // R2 object is gone but row didn't update — log hard.
      console.error(
        `[cron/cleanup] CRITICAL: ${t.object_key} deleted from R2 but DB update failed: ${updErr.message}`,
      );
      continue;
    }

    // Best-effort: clear streams.recording_url if it referenced this archive.
    if (t.stream_id) {
      await admin
        .from("streams")
        .update({ recording_url: null })
        .eq("id", t.stream_id);
    }

    deleted++;
    if (typeof t.byte_size === "number") bytesFreed += t.byte_size;
  }

  if (failed > 0) {
    void reportError(
      new Error(`${failed}/${targets.length} archive deletes failed`),
      {
        source: "cron/archives/cleanup",
        level: "warning",
        extra: { errors: errors.slice(0, 20) },
      },
    );
  }

  console.info(
    `[cron/cleanup] scanned=${targets.length} deleted=${deleted} failed=${failed} bytesFreed=${bytesFreed}`,
  );

  return NextResponse.json({
    ok: failed === 0,
    scanned: targets.length,
    deleted,
    failed,
    bytesFreed,
    errors: errors.slice(0, 20),
  });
}
