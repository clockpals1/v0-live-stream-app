"use client";

/**
 * useSectionRecorder
 * ------------------
 * A self-contained MediaRecorder lifecycle manager for "sections". A section
 * is a single continuous recorder run; the host can split a live into many
 * sections by calling markSectionEnd().
 *
 * SAFETY GUARANTEES
 * -----------------
 * 1. This hook does NOT touch the existing useHostStream recorder. They run
 *    in parallel on the SAME MediaStream. MediaRecorder is well-defined for
 *    multiple simultaneous instances on one stream — both browsers and the
 *    spec allow it.
 *
 * 2. Every error path is caught locally. A failure to start the recorder, a
 *    failure to stop it, a Blob assembly error — none of these propagate up
 *    or affect the live WebRTC pipeline. The worst that happens is the
 *    section ends up in state="failed" and the host can still mark the next
 *    section start.
 *
 * 3. When `enabled` is false (feature flag off), this hook is a complete
 *    no-op. No recorder is constructed. No memory is consumed. No effect
 *    bodies run beyond the early return.
 *
 * 4. Cleanup on unmount: any active recorder is stopped, all blob URLs are
 *    revoked. No leaks across page navigations.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { Section, SectionRecorderApi, SectionState } from "./types";

interface Options {
  /** When false, the hook is a no-op. Wire to REPLAY_ENABLED. */
  enabled: boolean;
  /**
   * The MediaStream to record. Typically the host's local
   * getUserMedia() result. Pass null to suspend recording cleanly
   * (e.g. host went off-air with no relay active).
   */
  mediaStream: MediaStream | null;
  /**
   * True while the live stream is broadcasting. We only START a new
   * section while live is true; finalisation works regardless so a
   * section can be closed even after the live transitions to ended.
   */
  isLive: boolean;
}

/** Best-effort MIME selection. Mirrors the existing useHostStream choices. */
const SECTION_MIME_CANDIDATES = [
  "video/webm;codecs=vp9,opus",
  "video/webm;codecs=vp8,opus",
  "video/webm;codecs=h264,opus",
  "video/webm",
  "video/mp4",
];

const pickMimeType = (): string => {
  if (typeof MediaRecorder === "undefined") return "";
  for (const t of SECTION_MIME_CANDIDATES) {
    try {
      if (MediaRecorder.isTypeSupported(t)) return t;
    } catch {
      /* keep trying */
    }
  }
  return "";
};

const newSectionId = () =>
  `sec-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

export function useSectionRecorder({
  enabled,
  mediaStream,
  isLive,
}: Options): SectionRecorderApi {
  const [sections, setSections] = useState<Section[]>([]);
  const [isRecording, setIsRecording] = useState(false);

  // Refs hold mutable internals so callbacks have stable identities and
  // can read the freshest values without retriggering effects.
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const currentSectionIdRef = useRef<string | null>(null);
  const indexCounterRef = useRef(0);
  // Tracks blob object URLs we created so we can revoke them on cleanup.
  const blobUrlsRef = useRef<Set<string>>(new Set());

  // ─── helpers (no React state churn) ────────────────────────────────────────
  const updateSection = useCallback(
    (id: string, patch: Partial<Section>) => {
      setSections((prev) =>
        prev.map((s) => (s.id === id ? { ...s, ...patch } : s))
      );
    },
    []
  );

  const setSectionState = useCallback(
    (id: string, state: SectionState, errorMessage?: string) => {
      updateSection(id, {
        state,
        ...(errorMessage !== undefined ? { errorMessage } : {}),
      });
    },
    [updateSection]
  );

  // ─── start a new section ───────────────────────────────────────────────────
  const startNewSection = useCallback(() => {
    if (!enabled) return;
    if (!mediaStream) {
      console.log("[Replay] startNewSection: no mediaStream, skipping");
      return;
    }
    if (recorderRef.current && recorderRef.current.state !== "inactive") {
      console.log("[Replay] startNewSection: a section is already recording");
      return;
    }

    const id = newSectionId();
    indexCounterRef.current += 1;
    const index = indexCounterRef.current;
    const startedAt = Date.now();
    const mimeType = pickMimeType();

    // Create the section row IMMEDIATELY in "recording" state so the host
    // sees the active section in the UI as soon as live begins.
    setSections((prev) => [
      ...prev,
      {
        id,
        index,
        state: "recording",
        startedAt,
        endedAt: null,
        blob: null,
        blobUrl: null,
        byteSize: 0,
        mimeType,
        errorMessage: null,
      },
    ]);
    currentSectionIdRef.current = id;
    chunksRef.current = [];

    try {
      const recorder = new MediaRecorder(
        mediaStream,
        mimeType ? { mimeType } : {}
      );

      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };

      recorder.onerror = (event: Event) => {
        const err = (event as unknown as { error?: Error }).error;
        const msg = err?.message ?? "MediaRecorder error";
        console.error("[Replay] recorder.onerror:", msg);
        // We mark the section failed but do NOT throw — live path is unaffected.
        setSectionState(id, "failed", msg);
      };

      recorderRef.current = recorder;
      recorder.start(1000); // 1s timeslice — same cadence as the existing pipeline
      setIsRecording(true);
      console.log(
        `[Replay] section ${index} started, mime=${mimeType || "(default)"}`
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[Replay] failed to start MediaRecorder:", msg);
      setSectionState(id, "failed", msg);
      recorderRef.current = null;
      currentSectionIdRef.current = null;
      setIsRecording(false);
    }
  }, [enabled, mediaStream, setSectionState]);

  // ─── finalise the active section ───────────────────────────────────────────
  /**
   * Stops the current MediaRecorder, awaits its final chunk, assembles a
   * Blob, transitions the section to "ready" (or "failed").
   * If startNext is true, calls startNewSection() afterwards.
   */
  const finaliseSection = useCallback(
    async (startNext: boolean): Promise<void> => {
      const recorder = recorderRef.current;
      const id = currentSectionIdRef.current;
      if (!recorder || !id || recorder.state === "inactive") {
        // Nothing to do — but if asked, still try to begin the next one.
        if (startNext && enabled) startNewSection();
        return;
      }

      setSectionState(id, "finalizing");

      // Wait for the recorder's "stop" event so the final chunk lands.
      // Hard-cap with a 30-second timeout so a wedged recorder cannot
      // permanently block the host's next section.
      let timedOut = false;
      try {
        await new Promise<void>((resolve, reject) => {
          const onStop = () => {
            recorder.removeEventListener("stop", onStop);
            recorder.removeEventListener("error", onError);
            resolve();
          };
          const onError = (event: Event) => {
            recorder.removeEventListener("stop", onStop);
            recorder.removeEventListener("error", onError);
            const err = (event as unknown as { error?: Error }).error;
            reject(err ?? new Error("MediaRecorder error during stop"));
          };
          recorder.addEventListener("stop", onStop);
          recorder.addEventListener("error", onError);
          setTimeout(() => {
            timedOut = true;
            recorder.removeEventListener("stop", onStop);
            recorder.removeEventListener("error", onError);
            reject(new Error("Section finalisation timed out after 30s"));
          }, 30_000);
          try {
            recorder.stop();
          } catch (err) {
            recorder.removeEventListener("stop", onStop);
            recorder.removeEventListener("error", onError);
            reject(err);
          }
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(
          `[Replay] section ${id} finalise failed:`,
          msg,
          timedOut ? "(timeout)" : ""
        );
        setSectionState(id, "failed", msg);
        recorderRef.current = null;
        currentSectionIdRef.current = null;
        setIsRecording(false);
        if (startNext && enabled) startNewSection();
        return;
      }

      // Recorder stopped cleanly. Build the blob.
      try {
        const mimeType = recorder.mimeType || "video/webm";
        if (chunksRef.current.length === 0) {
          throw new Error("No data chunks captured for this section");
        }
        const blob = new Blob(chunksRef.current, { type: mimeType });
        const blobUrl = URL.createObjectURL(blob);
        blobUrlsRef.current.add(blobUrl);

        updateSection(id, {
          state: "ready",
          endedAt: Date.now(),
          blob,
          blobUrl,
          byteSize: blob.size,
          mimeType,
          errorMessage: null,
        });
        console.log(
          `[Replay] section ${id} ready: ${(blob.size / 1024 / 1024).toFixed(1)} MB`
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[Replay] section ${id} blob assembly failed:`, msg);
        setSectionState(id, "failed", msg);
      } finally {
        chunksRef.current = [];
        recorderRef.current = null;
        currentSectionIdRef.current = null;
        setIsRecording(false);
      }

      if (startNext && enabled) startNewSection();
    },
    [enabled, setSectionState, startNewSection, updateSection]
  );

  const markSectionEnd = useCallback(
    () => finaliseSection(/* startNext */ true),
    [finaliseSection]
  );

  const finaliseAndStop = useCallback(
    () => finaliseSection(/* startNext */ false),
    [finaliseSection]
  );

  const forgetSection = useCallback((id: string) => {
    setSections((prev) => {
      const next = prev.filter((s) => s.id !== id);
      const target = prev.find((s) => s.id === id);
      if (target?.blobUrl) {
        try {
          URL.revokeObjectURL(target.blobUrl);
        } catch {
          /* ignore */
        }
        blobUrlsRef.current.delete(target.blobUrl);
      }
      return next;
    });
  }, []);

  // ─── lifecycle: auto-start a section when live + mediaStream exist ─────────
  // Triggered by transitions live=false→true and mediaStream=null→stream.
  // Does NOT auto-restart after a section is manually marked end while live —
  // markSectionEnd() handles that itself.
  useEffect(() => {
    if (!enabled) return;
    if (!isLive) return;
    if (!mediaStream) return;
    if (recorderRef.current && recorderRef.current.state !== "inactive") {
      return;
    }
    startNewSection();
  }, [enabled, isLive, mediaStream, startNewSection]);

  // ─── lifecycle: when live ends externally, finalise the current section ────
  // The host's End Stream button calls finaliseAndStop() explicitly so we
  // never double-finalise. This effect is a safety net for cases where
  // isLive flips false through some other path (host kicked, etc.).
  useEffect(() => {
    if (!enabled) return;
    if (isLive) return;
    if (!recorderRef.current) return;
    if (recorderRef.current.state === "inactive") return;
    console.log("[Replay] live ended externally — auto-finalising last section");
    void finaliseSection(false);
  }, [enabled, isLive, finaliseSection]);

  // ─── cleanup on unmount ────────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      // Stop any live recorder. We don't await — unmount is synchronous.
      const recorder = recorderRef.current;
      if (recorder && recorder.state !== "inactive") {
        try {
          recorder.stop();
        } catch {
          /* ignore */
        }
      }
      // Revoke all blob URLs we own.
      blobUrlsRef.current.forEach((url) => {
        try {
          URL.revokeObjectURL(url);
        } catch {
          /* ignore */
        }
      });
      blobUrlsRef.current.clear();
    };
  }, []);

  // When the hook is disabled at runtime (flag toggle on a route we re-enter)
  // ensure no stale state lingers.
  if (!enabled) {
    return {
      sections: [],
      isRecording: false,
      markSectionEnd: async () => {},
      finaliseAndStop: async () => {},
      forgetSection: () => {},
    };
  }

  return {
    sections,
    isRecording,
    markSectionEnd,
    finaliseAndStop,
    forgetSection,
  };
}
