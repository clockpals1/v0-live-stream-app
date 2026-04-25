/**
 * Section export — save a finalised section blob to the host's local drive.
 *
 * STRATEGY
 * --------
 * 1. PREFERRED: File System Access API (`window.showSaveFilePicker`).
 *    Available on Chromium desktop, Edge, Opera. Lets the host pick a
 *    folder/file and writes directly there with no Downloads-folder detour.
 *
 * 2. FALLBACK: classic anchor-click download. Universally supported.
 *    Same mechanism the existing useHostStream stopStream() uses today,
 *    so behaviour is identical to the current "End Stream" auto-download
 *    on browsers without the FS Access API (iOS Safari, Firefox, mobile
 *    Chromium variants in some configs).
 *
 * RESULTS
 * -------
 * Returns a discriminated union so callers can distinguish:
 *   - "saved"     → file is on disk
 *   - "cancelled" → host dismissed the picker (FS Access API only)
 *   - "failed"    → an actual error occurred
 *
 * The replay panel maps these to the spec's required UI states:
 *   - saved     → "Export available"
 *   - cancelled → "Export cancelled" (recoverable, replay still works)
 *   - failed    → "Export failed"   (recoverable, replay still works)
 *
 * Failure NEVER throws to the caller. All paths resolve.
 */

export type ExportResult =
  | { status: "saved"; method: "fs-access" | "anchor"; filename: string }
  | { status: "cancelled" }
  | { status: "failed"; message: string };

interface ExportOptions {
  blob: Blob;
  /** Suggested filename — extension is added automatically based on MIME. */
  baseName: string;
}

const extensionFor = (mime: string): string => {
  if (!mime) return "webm";
  if (mime.startsWith("video/webm")) return "webm";
  if (mime.startsWith("video/mp4")) return "mp4";
  // Fall back to last token of the MIME subtype.
  const sub = mime.split("/")[1] ?? "webm";
  return sub.split(";")[0] || "webm";
};

const sanitise = (s: string): string =>
  s.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "");

const hasFsAccessApi = (): boolean => {
  if (typeof window === "undefined") return false;
  return typeof (window as unknown as { showSaveFilePicker?: unknown })
    .showSaveFilePicker === "function";
};

/**
 * The FS Access API path. Throws AbortError on cancel — we catch and report
 * "cancelled". Any other error is reported as "failed".
 */
async function exportViaFsAccess(
  blob: Blob,
  filename: string
): Promise<ExportResult> {
  type FsAccessGlobal = {
    showSaveFilePicker: (opts: {
      suggestedName: string;
      types?: Array<{ description: string; accept: Record<string, string[]> }>;
    }) => Promise<{
      createWritable: () => Promise<{
        write: (data: Blob) => Promise<void>;
        close: () => Promise<void>;
      }>;
    }>;
  };
  const w = window as unknown as FsAccessGlobal;
  try {
    const handle = await w.showSaveFilePicker({
      suggestedName: filename,
      types: [
        {
          description: "Video recording",
          accept: { [blob.type || "video/webm"]: [`.${extensionFor(blob.type)}`] },
        },
      ],
    });
    const writable = await handle.createWritable();
    await writable.write(blob);
    await writable.close();
    return { status: "saved", method: "fs-access", filename };
  } catch (err) {
    // The spec uses a DOMException with name "AbortError" for user cancel.
    if (
      err instanceof Error &&
      (err.name === "AbortError" || /aborted|cancel/i.test(err.message))
    ) {
      return { status: "cancelled" };
    }
    const msg = err instanceof Error ? err.message : String(err);
    return { status: "failed", message: msg };
  }
}

/** Universal fallback: programmatic anchor click. Cannot be cancelled. */
function exportViaAnchor(blob: Blob, filename: string): ExportResult {
  try {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.style.display = "none";
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    // Defer revoke so the download has time to start. 60s is generous.
    setTimeout(() => {
      try {
        URL.revokeObjectURL(url);
      } catch {
        /* ignore */
      }
    }, 60_000);
    return { status: "saved", method: "anchor", filename };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { status: "failed", message: msg };
  }
}

/**
 * Save `blob` to the host's local drive. Picks the best available mechanism.
 * Always resolves — never throws.
 */
export async function exportSection({
  blob,
  baseName,
}: ExportOptions): Promise<ExportResult> {
  const ext = extensionFor(blob.type);
  const filename = `${sanitise(baseName)}.${ext}`;
  if (hasFsAccessApi()) {
    return exportViaFsAccess(blob, filename);
  }
  return exportViaAnchor(blob, filename);
}

/** Whether the running browser supports the picker-based export path. */
export const fsAccessSupported = hasFsAccessApi;
