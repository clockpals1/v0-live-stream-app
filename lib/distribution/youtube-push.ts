/**
 * Distribution — YouTube push helper.
 *
 * Flow
 * ----
 * 1. Call /api/host/archives/[id]/push/youtube  → { r2Url, uploadUrl, contentLength }
 * 2. XHR-fetch the blob from r2Url (R2 presigned GET).
 * 3. PUT blob to uploadUrl (YouTube resumable session).
 *
 * Both transfers are done in the browser so Workers never handle the
 * video bytes — the same architecture as the R2 archive upload.
 * XHR is used over fetch so we get download AND upload progress events.
 *
 * Error handling
 * --------------
 * Returns a discriminated union; never throws. The caller controls all
 * user-facing feedback.
 */

export type YoutubePushResult =
  | { status: "pushed" }
  | { status: "failed"; message: string; phase: "init" | "download" | "upload" };

export interface YoutubePushOptions {
  archiveId: string;
  title?: string;
  description?: string;
  privacyStatus?: "private" | "unlisted" | "public";
  tags?: string[];
  /** Called with 0..1 during download phase. */
  onDownloadProgress?: (fraction: number) => void;
  /** Called with 0..1 during upload phase. */
  onUploadProgress?: (fraction: number) => void;
}

interface PushSession {
  r2Url: string;
  uploadUrl: string;
  contentType: string;
  contentLength: number;
}

export async function pushArchiveToYoutube({
  archiveId,
  title,
  description,
  privacyStatus = "private",
  tags,
  onDownloadProgress,
  onUploadProgress,
}: YoutubePushOptions): Promise<YoutubePushResult> {
  // ─── 1. Init — get R2 URL + YouTube upload session URL ─────────────
  let session: PushSession;
  try {
    const res = await fetch(`/api/host/archives/${archiveId}/push/youtube`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, description, privacyStatus, tags }),
    });
    const json = (await res.json()) as Partial<PushSession> & { error?: string };
    if (!res.ok) {
      return { status: "failed", phase: "init", message: json.error ?? `Server error (${res.status}).` };
    }
    if (!json.r2Url || !json.uploadUrl) {
      return { status: "failed", phase: "init", message: "Server returned incomplete push session." };
    }
    session = json as PushSession;
  } catch (err) {
    return { status: "failed", phase: "init", message: err instanceof Error ? err.message : "Network error." };
  }

  // ─── 2. Download from R2 ───────────────────────────────────────────
  let blob: Blob;
  try {
    blob = await new Promise<Blob>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("GET", session.r2Url, true);
      xhr.responseType = "blob";
      xhr.onprogress = (e) => {
        if (e.lengthComputable && onDownloadProgress) {
          onDownloadProgress(e.loaded / e.total);
        }
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve(xhr.response as Blob);
        } else {
          reject(new Error(`R2 download failed: HTTP ${xhr.status}`));
        }
      };
      xhr.onerror = () => reject(new Error("Network error during download."));
      xhr.onabort = () => reject(new Error("Download was aborted."));
      xhr.send();
    });
  } catch (err) {
    return { status: "failed", phase: "download", message: err instanceof Error ? err.message : "Download failed." };
  }

  // ─── 3. Upload to YouTube ──────────────────────────────────────────
  try {
    await new Promise<void>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("PUT", session.uploadUrl, true);
      xhr.setRequestHeader("Content-Type", session.contentType);
      xhr.setRequestHeader("Content-Length", String(session.contentLength));
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable && onUploadProgress) {
          onUploadProgress(e.loaded / e.total);
        }
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) resolve();
        else reject(new Error(`YouTube upload failed: HTTP ${xhr.status}`));
      };
      xhr.onerror = () => reject(new Error("Network error during YouTube upload."));
      xhr.onabort = () => reject(new Error("YouTube upload was aborted."));
      xhr.send(blob);
    });
  } catch (err) {
    return { status: "failed", phase: "upload", message: err instanceof Error ? err.message : "YouTube upload failed." };
  }

  return { status: "pushed" };
}
