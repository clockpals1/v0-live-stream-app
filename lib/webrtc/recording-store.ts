"use client";

/**
 * recording-store.ts
 * ──────────────────
 * Tiny IndexedDB wrapper for durable MediaRecorder-chunk persistence.
 *
 * Why this exists:
 *   MediaRecorder chunks delivered via `ondataavailable` were previously kept
 *   ONLY in a React state array. A host refresh, browser crash, or accidental
 *   tab-close silently wiped the entire recording — often many minutes of
 *   irreplaceable live content.
 *
 *   This module persists every chunk to IndexedDB the moment it arrives, so
 *   that after a crash / close / refresh we can still offer the host a
 *   downloadable file reconstructed from disk.
 *
 * Honest limitation:
 *   This does NOT let a new MediaRecorder resume the same WebM file after a
 *   refresh. On refresh, the MediaStream is destroyed; a fresh recorder writes
 *   a NEW init segment with different codec parameters, and concatenating the
 *   two produces a corrupt file in most players. We therefore treat each
 *   mount as a separate *session* — the host ends up with one clean .webm
 *   per session, which is the safest achievable fallback in browser-only.
 *
 * Data model (single object store "chunks"):
 *   key  : auto-incremented
 *   value: { streamId, sessionId, seq, startedAt, mimeType, blob }
 *
 *   The first record for a session carries blob = null and serves as the
 *   session header (holds mimeType + startedAt). Every subsequent record is a
 *   chunk with seq > 0.
 */

const DB_NAME = "clockpals-recording";
const DB_VERSION = 1;
const STORE = "chunks";

export interface RecordingHeader {
  streamId: string;
  sessionId: string;
  seq: 0;
  startedAt: number;
  mimeType: string;
  blob: null;
}

export interface RecordingChunk {
  streamId: string;
  sessionId: string;
  seq: number; // >= 1
  startedAt: number;
  mimeType: string;
  blob: Blob;
}

type RecordingRecord = RecordingHeader | RecordingChunk;

export interface PendingSessionSummary {
  streamId: string;
  sessionId: string;
  startedAt: number;
  mimeType: string;
  chunkCount: number;
  totalBytes: number;
}

function isBrowser(): boolean {
  return typeof window !== "undefined" && typeof indexedDB !== "undefined";
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!isBrowser()) {
      reject(new Error("IndexedDB not available"));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, {
          keyPath: "id",
          autoIncrement: true,
        });
        // Fast lookup by (streamId, sessionId) during append + recovery.
        store.createIndex("streamId", "streamId", { unique: false });
        store.createIndex("session", ["streamId", "sessionId"], {
          unique: false,
        });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => Promise<T> | T
): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const store = tx.objectStore(STORE);
      let result: T;
      Promise.resolve(fn(store))
        .then((r) => {
          result = r;
        })
        .catch((err) => {
          try {
            tx.abort();
          } catch {
            /* noop */
          }
          reject(err);
        });
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error ?? new Error("tx aborted"));
    });
  } finally {
    db.close();
  }
}

/**
 * Begin a new recording session. Writes the session header (mimeType +
 * startedAt) so that recovery logic can reconstruct a playable Blob later.
 * Safe to call before any chunks arrive.
 */
export async function beginSession(
  streamId: string,
  sessionId: string,
  mimeType: string,
  startedAt = Date.now()
): Promise<void> {
  if (!isBrowser()) return;
  const header: RecordingHeader = {
    streamId,
    sessionId,
    seq: 0,
    startedAt,
    mimeType,
    blob: null,
  };
  await withStore("readwrite", (store) => {
    store.add(header);
  });
}

/**
 * Append a chunk emitted by MediaRecorder.ondataavailable. `seq` should be a
 * monotonically increasing integer per session so chunks can be reassembled
 * in the exact order they were captured.
 */
export async function appendChunk(
  streamId: string,
  sessionId: string,
  seq: number,
  blob: Blob,
  mimeType: string,
  startedAt: number
): Promise<void> {
  if (!isBrowser()) return;
  if (!blob || blob.size === 0) return;
  const rec: RecordingChunk = {
    streamId,
    sessionId,
    seq,
    startedAt,
    mimeType,
    blob,
  };
  await withStore("readwrite", (store) => {
    store.add(rec);
  });
}

/**
 * Read all records for a given session back, sorted by seq. Returns null if
 * the session has no header (never started or fully cleared).
 */
export async function readSession(
  streamId: string,
  sessionId: string
): Promise<{
  header: RecordingHeader;
  chunks: RecordingChunk[];
} | null> {
  if (!isBrowser()) return null;
  return await withStore<{
    header: RecordingHeader;
    chunks: RecordingChunk[];
  } | null>("readonly", (store) => {
    return new Promise((resolve, reject) => {
      const idx = store.index("session");
      const range = IDBKeyRange.only([streamId, sessionId]);
      const req = idx.getAll(range);
      req.onsuccess = () => {
        const all = (req.result ?? []) as RecordingRecord[];
        if (all.length === 0) {
          resolve(null);
          return;
        }
        const header = all.find((r) => r.seq === 0) as
          | RecordingHeader
          | undefined;
        const chunks = (all.filter((r) => r.seq >= 1) as RecordingChunk[]).sort(
          (a, b) => a.seq - b.seq
        );
        if (!header) {
          // Recover with a synthetic header if only chunks survived.
          const first = chunks[0];
          if (!first) {
            resolve(null);
            return;
          }
          resolve({
            header: {
              streamId,
              sessionId,
              seq: 0,
              startedAt: first.startedAt,
              mimeType: first.mimeType,
              blob: null,
            },
            chunks,
          });
          return;
        }
        resolve({ header, chunks });
      };
      req.onerror = () => reject(req.error);
    });
  });
}

/**
 * Delete every record for a given session (header + chunks). Called after a
 * successful download so we don't hoard megabytes of stale data in IDB.
 */
export async function clearSession(
  streamId: string,
  sessionId: string
): Promise<void> {
  if (!isBrowser()) return;
  await withStore("readwrite", (store) => {
    return new Promise<void>((resolve, reject) => {
      const idx = store.index("session");
      const range = IDBKeyRange.only([streamId, sessionId]);
      const req = idx.openCursor(range);
      req.onsuccess = () => {
        const cursor = req.result;
        if (cursor) {
          cursor.delete();
          cursor.continue();
        } else {
          resolve();
        }
      };
      req.onerror = () => reject(req.error);
    });
  });
}

/**
 * List any pending (unsaved) sessions for the given streamId. Used by the
 * recovery banner: if the host refreshed/crashed mid-stream, this surfaces
 * the prior session so they can download or discard it before starting a new
 * one.
 */
export async function listPendingSessions(
  streamId: string
): Promise<PendingSessionSummary[]> {
  if (!isBrowser()) return [];
  return await withStore<PendingSessionSummary[]>("readonly", (store) => {
    return new Promise((resolve, reject) => {
      const idx = store.index("streamId");
      const req = idx.getAll(IDBKeyRange.only(streamId));
      req.onsuccess = () => {
        const all = (req.result ?? []) as RecordingRecord[];
        const bySession = new Map<string, PendingSessionSummary>();
        for (const r of all) {
          const key = r.sessionId;
          const cur = bySession.get(key) ?? {
            streamId: r.streamId,
            sessionId: r.sessionId,
            startedAt: r.startedAt,
            mimeType: r.mimeType,
            chunkCount: 0,
            totalBytes: 0,
          };
          if (r.seq >= 1 && r.blob) {
            cur.chunkCount += 1;
            cur.totalBytes += r.blob.size;
          }
          bySession.set(key, cur);
        }
        // Only return sessions that actually have chunks — a header-only
        // session is useless to recover.
        resolve(
          Array.from(bySession.values())
            .filter((s) => s.chunkCount > 0)
            .sort((a, b) => b.startedAt - a.startedAt)
        );
      };
      req.onerror = () => reject(req.error);
    });
  });
}

/**
 * Reconstruct a downloadable Blob from a session's chunks. Returns null when
 * the session has no usable chunks.
 */
export async function buildSessionBlob(
  streamId: string,
  sessionId: string
): Promise<{ blob: Blob; mimeType: string; startedAt: number } | null> {
  const session = await readSession(streamId, sessionId);
  if (!session || session.chunks.length === 0) return null;
  const mimeType = session.header.mimeType || "video/webm";
  const blob = new Blob(
    session.chunks.map((c) => c.blob),
    { type: mimeType }
  );
  return { blob, mimeType, startedAt: session.header.startedAt };
}

/**
 * Trigger a browser download for the given blob. Kept here (rather than in
 * the host hook) so recovery UI can reuse it without pulling in the rest of
 * the WebRTC module.
 */
export function downloadBlob(blob: Blob, filename: string): void {
  if (!isBrowser()) return;
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  } finally {
    // Give the browser a tick to start the download before revoking.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

export function newSessionId(): string {
  const rand = Math.random().toString(36).slice(2, 10);
  return `${Date.now()}-${rand}`;
}

/**
 * Best-effort global cleanup (e.g. nuke-everything admin action). Not wired
 * into normal flows — exposed for completeness only.
 */
export async function clearAll(): Promise<void> {
  if (!isBrowser()) return;
  await withStore("readwrite", (store) => {
    store.clear();
  });
}
