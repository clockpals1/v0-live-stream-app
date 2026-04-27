/**
 * Section → cloud archive uploader.
 *
 * WHY THIS EXISTS
 * ---------------
 * Phase 1 of the section recorder (lib/replay/use-section-recorder.ts)
 * kept every section in browser memory + offered an FS-Access-API local
 * export. There was NO path from a recorded section to the host's
 * Replay Library — sections never reached `stream_archives` and so
 * studio.isunday.me/studio/replay always rendered "No archives yet."
 *
 * This helper closes that gap by reusing the cloud-archive endpoints
 * the post-stream dialog already speaks:
 *
 *   1. POST /api/streams/:streamId/archive/start
 *      → mints presigned R2 PUT URL, inserts a stream_archives row in
 *        status='uploading'
 *
 *   2. PUT to the presigned URL with the section blob
 *      → object lands in R2; no proxy through the Worker
 *
 *   3. POST /api/streams/:streamId/archive/:archiveId/finalize
 *      → flips the row to status='ready', stamps byte_size + completed_at
 *
 * The Replay Library query reads stream_archives.byte_size for the host,
 * so once finalize succeeds the section appears in the library on the
 * next page load (no realtime needed; refresh picks it up).
 *
 * DESIGN NOTES
 * ------------
 * - This is a pure function. No React state, no React imports, no DOM
 *   reads. It can be unit-tested by stubbing fetch + XMLHttpRequest.
 * - The progress callback is wired to the actual PUT bytes, not to a
 *   linear timer estimate. Fast networks finish before the bar moves;
 *   slow networks see steady progress.
 * - Errors are returned, never thrown. The caller decides whether to
 *   surface a toast, retry, or update its own state machine. This keeps
 *   the helper composable from both the section panel and any future
 *   integrations (e.g. an "upload all sections" batch action).
 */

export type CloudUploadResult =
  | {
      status: "saved";
      archiveId: string;
      publicUrl: string | null;
    }
  | {
      status: "failed";
      message: string;
      /**
       * Phase the failure happened in. Useful for diagnostics — a
       * "start" failure means the host's plan/storage is misconfigured;
       * an "uploading" failure usually means the network died mid-PUT.
       */
      phase: "start" | "uploading" | "finalize";
    };

export interface CloudUploadOptions {
  streamId: string;
  blob: Blob;
  /** Defaults to the blob's type, falling back to video/webm. */
  contentType?: string;
  /**
   * Receives values in [0, 1] during the PUT phase. Not called during
   * start or finalize because those are sub-second round trips.
   */
  onProgress?: (fraction: number) => void;
  /**
   * Called once the start endpoint returns successfully. Lets the UI
   * transition from "preparing…" to "uploading 0%" with the archive id
   * known, so a cancel/retry could target the same row.
   */
  onStarted?: (archiveId: string) => void;
}

interface StartResponse {
  archiveId: string;
  uploadUrl: string;
  headers: Record<string, string>;
  publicUrl: string | null;
}

export async function uploadSectionToCloud({
  streamId,
  blob,
  contentType,
  onProgress,
  onStarted,
}: CloudUploadOptions): Promise<CloudUploadResult> {
  const ct = contentType || blob.type || "video/webm";

  // ─── 1. start ──────────────────────────────────────────────────────
  let started: StartResponse;
  try {
    const res = await fetch(`/api/streams/${streamId}/archive/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contentType: ct }),
    });
    const json = (await res.json()) as Partial<StartResponse> & {
      error?: string;
    };
    if (!res.ok) {
      return {
        status: "failed",
        phase: "start",
        message: json.error ?? `Could not start upload (HTTP ${res.status}).`,
      };
    }
    if (!json.archiveId || !json.uploadUrl || !json.headers) {
      return {
        status: "failed",
        phase: "start",
        message: "Server returned an incomplete upload session.",
      };
    }
    started = json as StartResponse;
  } catch (err) {
    return {
      status: "failed",
      phase: "start",
      message: err instanceof Error ? err.message : "Network error.",
    };
  }
  onStarted?.(started.archiveId);

  // ─── 2. PUT to R2 ──────────────────────────────────────────────────
  // We use XMLHttpRequest, not fetch, because fetch's upload-progress
  // event listener (`Request.body` upload streams) is not yet
  // implemented in Safari and is gated behind a flag in some Chromium
  // versions. XHR upload progress is universal.
  try {
    await new Promise<void>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("PUT", started.uploadUrl, true);
      for (const [name, value] of Object.entries(started.headers)) {
        xhr.setRequestHeader(name, value);
      }
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable && onProgress) {
          onProgress(event.loaded / event.total);
        }
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) resolve();
        else reject(new Error(`R2 PUT failed: HTTP ${xhr.status}`));
      };
      xhr.onerror = () => reject(new Error("Network error during upload."));
      xhr.onabort = () => reject(new Error("Upload was aborted."));
      xhr.send(blob);
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Upload failed.";
    // Best-effort: tell the server the upload failed so the row moves
    // to status='failed' and doesn't sit in 'uploading' forever. Never
    // await this — the user is already waiting on the error path.
    void fetch(
      `/api/streams/${streamId}/archive/${started.archiveId}/finalize`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ success: false, failureReason: msg }),
      },
    ).catch(() => {
      /* swallow — we already have the user-facing error */
    });
    return { status: "failed", phase: "uploading", message: msg };
  }

  // ─── 3. finalize ───────────────────────────────────────────────────
  try {
    const res = await fetch(
      `/api/streams/${streamId}/archive/${started.archiveId}/finalize`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ success: true, byteSize: blob.size }),
      },
    );
    const json = (await res.json()) as { error?: string };
    if (!res.ok) {
      return {
        status: "failed",
        phase: "finalize",
        message: json.error ?? `Finalize failed (HTTP ${res.status}).`,
      };
    }
  } catch (err) {
    return {
      status: "failed",
      phase: "finalize",
      message: err instanceof Error ? err.message : "Finalize failed.",
    };
  }

  return {
    status: "saved",
    archiveId: started.archiveId,
    publicUrl: started.publicUrl,
  };
}
