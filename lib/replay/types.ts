/**
 * Types for the section-replay subsystem.
 *
 * A "section" is a single continuous MediaRecorder run. A live stream can
 * contain multiple sections — the host marks boundaries via "Mark Section
 * End", and the final section is auto-finalised when the stream ends.
 *
 * All section state lives in memory for Phase 1 (this PR). The Phase 2
 * follow-up will persist sections to the `stream_sections` table so they
 * survive tab refreshes; that migration is intentionally NOT in this PR.
 */

/**
 * Lifecycle states of a single section. Mirrors the user spec exactly:
 *   recording -> finalizing -> ready | failed
 *   ready -> exporting -> exported | export-cancelled | export-failed
 */
export type SectionState =
  | "recording"
  | "finalizing"
  | "ready"
  | "failed"
  | "exporting"
  | "exported"
  | "export-cancelled"
  | "export-failed";

export interface Section {
  /** Stable per-tab id. Not a DB id (no DB rows exist in Phase 1). */
  id: string;
  /** 1-based ordinal within the current live session. */
  index: number;
  state: SectionState;
  /** Wall-clock timestamps (ms). */
  startedAt: number;
  endedAt: number | null;
  /** Final blob — only set once state === "ready" or later. */
  blob: Blob | null;
  /** Object URL for the blob — created lazily for replay; revoked on cleanup. */
  blobUrl: string | null;
  /** Bytes; populated alongside blob. */
  byteSize: number;
  /** MIME type chosen by MediaRecorder for this section. */
  mimeType: string;
  /** Last error message, if any. Surfaced in the UI. */
  errorMessage: string | null;
}

/** Public surface returned by the useSectionRecorder hook. */
export interface SectionRecorderApi {
  /** All sections produced during this live session, in chronological order. */
  sections: Section[];
  /** True while the underlying MediaRecorder is actively writing chunks. */
  isRecording: boolean;
  /**
   * Finalise the current section and start a new one. Safe to call mid-stream.
   * No-op if there is no active recorder. Resolves once the just-finalised
   * section has transitioned to "ready" or "failed".
   */
  markSectionEnd: () => Promise<void>;
  /**
   * Finalise the current section without starting a new one. Used by the
   * host's "End Stream" flow so the final segment lands in the replay panel.
   */
  finaliseAndStop: () => Promise<void>;
  /**
   * Drop the in-memory blob for a section. Frees memory and revokes the URL.
   * The section row remains in the list with state="expired-locally".
   */
  forgetSection: (id: string) => void;
}
