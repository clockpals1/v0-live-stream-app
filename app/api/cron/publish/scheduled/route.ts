import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getValidAccessToken, initResumableUpload } from "@/lib/integrations/youtube";
import { presignDownload } from "@/lib/storage/r2";

/**
 * GET /api/cron/publish/scheduled
 *
 * Runs every hour (see wrangler.toml). Sweeps publish_queue for items
 * where status='scheduled' AND scheduled_for <= now() and attempts
 * to publish them automatically.
 *
 * YouTube + archive_id — server-side streaming upload:
 *   1. Get valid access token (auto-refreshes if needed).
 *   2. Get archive metadata + presigned R2 download URL.
 *   3. Init YouTube resumable upload session.
 *   4. Stream R2 response body directly to YouTube PUT.
 *      Cloudflare Workers support ReadableStream bodies, so the video
 *      bytes flow through the Worker without buffering in memory.
 *   ⚠️  Practical limit: Works reliably for files up to ~200 MB.
 *      Very large recordings (>500 MB) may hit the Worker's 30s CPU
 *      time limit. For those, the item is re-queued (not deleted) and
 *      the creator is prompted to use "Publish Now" from the browser,
 *      which bypasses the Worker entirely (browser streams R2→YouTube).
 *
 * Other platforms — not yet supported:
 *   Marks the item as failed with a clear message. The creator can
 *   connect the platform and retry manually.
 *
 * Batch size: 10 items per invocation to stay within CPU budget.
 * The cron runs hourly so a burst of scheduled items spreads naturally.
 *
 * Auth: CRON_SECRET bearer token (same guard as other cron routes).
 */

const BATCH_SIZE = 10;

interface CronQueueItem {
  id: string;
  host_id: string;
  platform: string;
  title: string;
  body: string | null;
  platform_meta: Record<string, unknown> | null;
  archive_id: string | null;
  asset_id: string | null;
  attempt_count: number;
  status: string;
}
const LARGE_FILE_THRESHOLD_BYTES = 500 * 1024 * 1024; // 500 MB

function isCronAuthorized(req: NextRequest): boolean {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return true; // no secret configured — allow (dev mode)
  const auth = req.headers.get("Authorization") ?? "";
  return auth === `Bearer ${cronSecret}`;
}

export async function GET(req: NextRequest) {
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const now = new Date().toISOString();

  // ─── Find due items ─────────────────────────────────────────────────
  const { data: rawItems, error: fetchErr } = await admin
    .from("publish_queue")
    .select(
      "id, host_id, platform, title, body, platform_meta, " +
      "archive_id, asset_id, attempt_count, status",
    )
    .eq("status", "scheduled")
    .lte("scheduled_for", now)
    .order("scheduled_for", { ascending: true })
    .limit(BATCH_SIZE);
  const dueItems = rawItems as unknown as CronQueueItem[] | null;

  if (fetchErr) {
    console.error("[cron/publish] fetch failed:", fetchErr.message);
    return NextResponse.json({ error: fetchErr.message }, { status: 500 });
  }

  if (!dueItems?.length) {
    return NextResponse.json({ processed: 0, message: "No items due." });
  }

  const results: Array<{ id: string; outcome: string; error?: string }> = [];

  for (const item of dueItems) {
    // Mark as publishing immediately to prevent double-processing on overlap
    await admin
      .from("publish_queue")
      .update({ status: "publishing", last_attempt_at: now, attempt_count: item.attempt_count + 1 })
      .eq("id", item.id)
      .eq("status", "scheduled"); // optimistic lock — skip if another worker grabbed it

    if (item.platform === "youtube") {
      const result = await publishYoutube(admin, item);
      if (result.ok) {
        await admin.from("publish_queue").update({
          status: "published",
          published_at: new Date().toISOString(),
          platform_post_id: result.videoId ?? null,
          platform_post_url: result.videoId
            ? `https://www.youtube.com/watch?v=${result.videoId}`
            : null,
          last_error: null,
        }).eq("id", item.id);
        results.push({ id: item.id, outcome: "published" });
      } else {
        // Large files get re-queued (status back to scheduled); others fail
        const nextStatus = result.requeue ? "scheduled" : "failed";
        await admin.from("publish_queue").update({
          status: nextStatus,
          last_error: result.error,
        }).eq("id", item.id);
        results.push({ id: item.id, outcome: nextStatus, error: result.error });
      }
    } else {
      const msg = `Auto-publish for ${item.platform} is not yet available. Open the Publishing Hub and click "Publish Now" to publish manually once ${item.platform} is connected.`;
      await admin.from("publish_queue").update({
        status: "failed",
        last_error: msg,
      }).eq("id", item.id);
      results.push({ id: item.id, outcome: "failed", error: msg });
    }
  }

  console.log(
    `[cron/publish] processed ${results.length} items:`,
    results.map((r) => `${r.id.slice(0, 8)} → ${r.outcome}`).join(", "),
  );

  return NextResponse.json({ processed: results.length, results });
}

// ─── YouTube server-side upload ────────────────────────────────────────

type YoutubeResult =
  | { ok: true; videoId: string | null }
  | { ok: false; error: string; requeue: boolean };

async function publishYoutube(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  item: any,
): Promise<YoutubeResult> {
  if (!item.archive_id) {
    return { ok: false, error: "No archive linked to this queue item. Link a recording to enable YouTube auto-publish.", requeue: false };
  }

  // ── Token ─────────────────────────────────────────────────────────
  let tokenBundle: { accessToken: string } | null = null;
  try {
    tokenBundle = await getValidAccessToken(admin, item.host_id);
  } catch (e) {
    return { ok: false, error: `YouTube token error: ${e instanceof Error ? e.message : String(e)}`, requeue: false };
  }
  if (!tokenBundle) {
    return { ok: false, error: "YouTube is not connected. Connect it in the Publishing Hub → Connections tab.", requeue: false };
  }

  // ── Archive record ────────────────────────────────────────────────
  const { data: archive } = await admin
    .from("stream_archives")
    .select("id, object_key, public_url, status, content_type, byte_size, streams(title)")
    .eq("id", item.archive_id)
    .is("deleted_at", null)
    .single();

  if (!archive) return { ok: false, error: "Archive not found or deleted.", requeue: false };
  if (archive.status !== "ready") {
    return { ok: false, error: `Archive is not ready yet (status: ${archive.status}).`, requeue: true };
  }

  const byteSize = Number(archive.byte_size ?? 0);
  if (!byteSize) return { ok: false, error: "Archive byte size unknown — cannot upload.", requeue: false };

  // Large file guard: re-queue for manual browser upload
  if (byteSize > LARGE_FILE_THRESHOLD_BYTES) {
    return {
      ok: false,
      requeue: true,
      error: `File is ${Math.round(byteSize / 1024 / 1024)} MB — too large for automatic upload. Open the Publishing Hub and use "Publish Now" to upload from your browser.`,
    };
  }

  // ── R2 URL ────────────────────────────────────────────────────────
  let r2Url: string;
  try {
    r2Url = archive.public_url
      ? archive.public_url
      : await presignDownload({ objectKey: archive.object_key, expiresInSeconds: 7200 });
  } catch (e) {
    return { ok: false, error: `R2 access failed: ${e instanceof Error ? e.message : String(e)}`, requeue: false };
  }

  // ── YouTube upload session ────────────────────────────────────────
  const meta = (item.platform_meta ?? {}) as Record<string, string>;
  const streamTitle = archive.streams?.title ?? "Stream recording";
  let session: { uploadUrl: string; contentType: string; contentLength: number };
  try {
    session = await initResumableUpload({
      accessToken: tokenBundle.accessToken,
      title: (meta.title ?? item.title ?? streamTitle).slice(0, 100),
      description: meta.description ?? item.body ?? "",
      privacyStatus: (meta.privacy as "private" | "unlisted" | "public") ?? "private",
      tags: meta.tags ? (meta.tags as unknown as string[]) : undefined,
      contentType: archive.content_type ?? "video/webm",
      contentLength: byteSize,
    });
  } catch (e) {
    return { ok: false, error: `YouTube session init failed: ${e instanceof Error ? e.message : String(e)}`, requeue: false };
  }

  // ── Stream R2 → YouTube ───────────────────────────────────────────
  try {
    const r2Res = await fetch(r2Url);
    if (!r2Res.ok) throw new Error(`R2 download failed: HTTP ${r2Res.status}`);

    const ytRes = await fetch(session.uploadUrl, {
      method: "PUT",
      // Stream the R2 ReadableStream directly to YouTube — no buffering
      body: r2Res.body,
      headers: {
        "Content-Type": session.contentType,
        "Content-Length": String(session.contentLength),
      },
      // duplex: "half" is required by some runtimes for streaming bodies
      ...({ duplex: "half" } as unknown as RequestInit),
    });

    if (!ytRes.ok) {
      const text = await ytRes.text().catch(() => "");
      throw new Error(`YouTube upload rejected: HTTP ${ytRes.status} — ${text.slice(0, 200)}`);
    }

    // YouTube returns the video resource with ?part=snippet,status baked
    // into the resumable session URL.
    const videoData = (await ytRes.json().catch(() => null)) as { id?: string } | null;

    // Update last_used_at on the integration row
    await admin
      .from("host_integrations")
      .update({ last_used_at: new Date().toISOString() })
      .eq("host_id", item.host_id)
      .eq("provider", "youtube");

    return { ok: true, videoId: videoData?.id ?? null };
  } catch (e) {
    return {
      ok: false,
      error: `Upload failed: ${e instanceof Error ? e.message : String(e)}`,
      requeue: false,
    };
  }
}
