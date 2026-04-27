"use client";

/**
 * ReplayPanel — host-only UI for managing in-session section recordings.
 *
 * RENDERED FROM
 *   components/host/stream-interface.tsx (inside a feature-flag-gated tab).
 *
 * BEHAVIOUR
 *   - Lists every section recorded this session, with state badge + duration.
 *   - For state="ready" rows, renders an inline <video> player using the
 *     in-memory blob URL — immediate replay, no network round-trip.
 *   - "Save to drive" button per ready section, using the export helper
 *     (File System Access API where supported, anchor-download fallback).
 *   - "Mark Section End" primary action at the top while a section is
 *     recording — closes the current section and starts a fresh one without
 *     interrupting the live stream.
 *
 * SAFETY
 *   - Pure presentational. Receives sections + callbacks from the parent.
 *   - All errors are surfaced inline as toasts/badges — never propagate.
 *   - When sections list is empty (e.g. flag just turned on, no recording
 *     started yet), shows a clear empty-state explanation.
 */

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import {
  Circle,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  Save,
  Scissors,
  Trash2,
  Download,
  Info,
  Cloud,
  CloudOff,
  ExternalLink,
} from "lucide-react";
import type { Section, SectionRecorderApi } from "@/lib/replay/types";
import { exportSection, fsAccessSupported } from "@/lib/replay/export";
import { uploadSectionToCloud } from "@/lib/replay/cloud-upload";
import {
  REPLAY_LOCAL_EXPORT_ENABLED,
  REPLAY_MAX_SECTION_MINUTES,
} from "@/lib/replay/config";

interface ReplayPanelProps {
  /** From useSectionRecorder. */
  recorder: SectionRecorderApi;
  /** True while the host's live stream is broadcasting. */
  isLive: boolean;
  /** Used to compose export filenames. */
  roomCode: string;
  streamTitle: string;
  /**
   * Stream UUID. Required for the per-section "Save to cloud" button
   * — it's posted to /api/streams/:streamId/archive/start so the
   * archive row is correctly attributed back to this live stream. The
   * old name is `roomCode` (a short code) which is NOT the same thing.
   */
  streamId: string;
}

const formatDuration = (ms: number): string => {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  return `${m}:${s.toString().padStart(2, "0")}`;
};

const formatBytes = (n: number): string => {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
};

/** Live ticker for the currently-recording section duration. */
const useLiveDuration = (startedAt: number, active: boolean): number => {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [active]);
  return Math.max(0, now - startedAt);
};

// ─── Per-section state badge ───────────────────────────────────────────────
function StateBadge({ state }: { state: Section["state"] }) {
  const map: Record<
    Section["state"],
    { label: string; className: string; Icon: typeof Circle }
  > = {
    recording: {
      label: "Recording",
      className: "bg-red-500/15 text-red-600 border-red-500/30",
      Icon: Circle,
    },
    finalizing: {
      label: "Finalising",
      className: "bg-amber-500/15 text-amber-600 border-amber-500/30",
      Icon: Loader2,
    },
    ready: {
      label: "Ready",
      className: "bg-emerald-500/15 text-emerald-600 border-emerald-500/30",
      Icon: CheckCircle2,
    },
    failed: {
      label: "Failed",
      className: "bg-red-500/15 text-red-600 border-red-500/30",
      Icon: AlertTriangle,
    },
    exporting: {
      label: "Exporting",
      className: "bg-blue-500/15 text-blue-600 border-blue-500/30",
      Icon: Loader2,
    },
    exported: {
      label: "Saved",
      className: "bg-emerald-500/15 text-emerald-600 border-emerald-500/30",
      Icon: CheckCircle2,
    },
    "export-cancelled": {
      label: "Export cancelled",
      className: "bg-muted text-muted-foreground border-border",
      Icon: Info,
    },
    "export-failed": {
      label: "Export failed",
      className: "bg-red-500/15 text-red-600 border-red-500/30",
      Icon: AlertTriangle,
    },
  };
  const { label, className, Icon } = map[state];
  const animated = state === "recording" || state === "finalizing" || state === "exporting";
  return (
    <Badge variant="outline" className={`gap-1 ${className}`}>
      <Icon
        className={`w-3 h-3 ${state === "recording" ? "fill-red-500" : ""} ${
          animated && state !== "recording" ? "animate-spin" : ""
        }`}
      />
      {label}
    </Badge>
  );
}

// ─── Per-row cloud upload state machine ─────────────────────────────
// Lives entirely inside SectionRow. We deliberately don't lift it
// onto the recorder API: cloud uploads are a presentational concern
// (the recorder owns chunks; the panel owns destination choices).
type CloudPhase =
  | { kind: "idle" }
  | { kind: "uploading"; progress: number; archiveId: string | null }
  | { kind: "saved"; archiveUrl: string | null }
  | { kind: "failed"; message: string };

// ─── A single section row ──────────────────────────────────────
function SectionRow({
  section,
  onForget,
  baseExportName,
  streamId,
}: {
  section: Section;
  onForget: () => void;
  baseExportName: string;
  streamId: string;
}) {
  const [isExporting, setIsExporting] = useState(false);
  const [exportState, setExportState] = useState<Section["state"]>(section.state);
  const [cloud, setCloud] = useState<CloudPhase>({ kind: "idle" });

  // Sync local UI state with parent state — but allow local optimistic
  // exports to render before propagating up (we never DO propagate up
  // for now — Phase 1 keeps export UI state local to the row).
  useEffect(() => {
    setExportState(section.state);
  }, [section.state]);

  const live = section.state === "recording";
  const liveDuration = useLiveDuration(section.startedAt, live);
  const finalDuration =
    section.endedAt != null ? section.endedAt - section.startedAt : liveDuration;

  const handleExport = useCallback(async () => {
    if (!section.blob) return;
    setIsExporting(true);
    setExportState("exporting");
    const result = await exportSection({
      blob: section.blob,
      baseName: `${baseExportName}_section-${section.index}`,
    });
    setIsExporting(false);
    if (result.status === "saved") {
      setExportState("exported");
      toast.success(
        result.method === "fs-access"
          ? "Recording saved to your chosen folder."
          : "Recording downloaded to your device."
      );
    } else if (result.status === "cancelled") {
      setExportState("export-cancelled");
      // Not fatal — replay still works. Reset to "ready" after a moment.
      setTimeout(() => setExportState("ready"), 2500);
    } else {
      setExportState("export-failed");
      toast.error(`Export failed: ${result.message}`);
    }
  }, [section.blob, section.index, baseExportName]);

  // Save the section to R2 + the host's Replay Library. This is the
  // closure of the loop the Phase 1 recorder left open: a section
  // recorded here ends up listed at studio.isunday.me/studio/replay
  // ready to publish.
  const handleSaveToCloud = useCallback(async () => {
    if (!section.blob) return;
    setCloud({ kind: "uploading", progress: 0, archiveId: null });
    const result = await uploadSectionToCloud({
      streamId,
      blob: section.blob,
      contentType: section.mimeType || "video/webm",
      onStarted: (archiveId) =>
        setCloud((prev) =>
          prev.kind === "uploading" ? { ...prev, archiveId } : prev,
        ),
      onProgress: (fraction) =>
        setCloud((prev) =>
          prev.kind === "uploading"
            ? { ...prev, progress: fraction }
            : prev,
        ),
    });
    if (result.status === "saved") {
      setCloud({ kind: "saved", archiveUrl: result.publicUrl });
      toast.success(
        "Section saved to your Replay Library. Open Studio to publish it.",
      );
    } else {
      setCloud({ kind: "failed", message: result.message });
      toast.error(`Couldn't save to cloud: ${result.message}`);
    }
  }, [section.blob, section.mimeType, streamId]);

  return (
    <div className="rounded-lg border border-border bg-card/60 p-3 space-y-2.5">
      {/* Row header */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="font-medium text-sm">Section {section.index}</span>
        <StateBadge state={exportState} />
        <span className="text-xs text-muted-foreground ml-auto">
          {formatDuration(finalDuration)}
          {section.byteSize > 0 && ` · ${formatBytes(section.byteSize)}`}
        </span>
      </div>

      {/* Inline replay player when ready */}
      {section.blobUrl && section.state !== "recording" && (
        <video
          key={section.blobUrl}
          src={section.blobUrl}
          controls
          playsInline
          preload="metadata"
          className="w-full rounded-md bg-black aspect-video"
        />
      )}

      {/* Recording placeholder while the section is mid-flight */}
      {section.state === "recording" && (
        <div className="rounded-md bg-black/80 aspect-video flex items-center justify-center text-white text-xs gap-2">
          <Circle className="w-3 h-3 fill-red-500 text-red-500 animate-pulse" />
          Recording in progress · {formatDuration(liveDuration)}
        </div>
      )}

      {/* Cloud upload progress / outcome */}
      {cloud.kind === "uploading" && (
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="w-3 h-3 animate-spin" />
            Uploading to your Replay Library… {Math.round(cloud.progress * 100)}%
          </div>
          <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full bg-primary transition-all"
              style={{ width: `${Math.max(2, cloud.progress * 100)}%` }}
            />
          </div>
        </div>
      )}
      {cloud.kind === "saved" && (
        <div className="flex items-center gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-1.5 text-xs text-emerald-600 dark:text-emerald-400">
          <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
          <span className="flex-1">In your Replay Library.</span>
          <a
            href="https://studio.isunday.me/studio/replay"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-0.5 font-medium hover:underline"
          >
            Open <ExternalLink className="w-3 h-3" />
          </a>
        </div>
      )}
      {cloud.kind === "failed" && (
        <div className="flex items-start gap-1.5 rounded-md border border-destructive/30 bg-destructive/10 px-2 py-1.5 text-xs text-destructive">
          <CloudOff className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          <span className="flex-1">{cloud.message}</span>
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center gap-2 flex-wrap">
        {section.state === "ready" || section.state === "exported" ||
        section.state === "export-cancelled" || section.state === "export-failed" ? (
          <>
            {/* Save to cloud — the only path that gets the section into
                the host's Replay Library. "Save to drive" below is
                local-only and never reaches the studio. */}
            {cloud.kind !== "saved" && (
              <Button
                size="sm"
                variant="default"
                onClick={handleSaveToCloud}
                disabled={cloud.kind === "uploading" || !section.blob}
                className="gap-1.5"
                title="Upload to your Replay Library so you can publish it as a public replay."
              >
                {cloud.kind === "uploading" ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : cloud.kind === "failed" ? (
                  <Cloud className="w-3.5 h-3.5" />
                ) : (
                  <Cloud className="w-3.5 h-3.5" />
                )}
                {cloud.kind === "uploading"
                  ? "Uploading…"
                  : cloud.kind === "failed"
                    ? "Retry upload"
                    : "Save to cloud"}
              </Button>
            )}
            {REPLAY_LOCAL_EXPORT_ENABLED && (
              <Button
                size="sm"
                variant="outline"
                onClick={handleExport}
                disabled={isExporting || !section.blob}
                className="gap-1.5"
                title="Save a copy to your computer. Local-only — will not appear in your Replay Library."
              >
                {fsAccessSupported() ? (
                  <Save className="w-3.5 h-3.5" />
                ) : (
                  <Download className="w-3.5 h-3.5" />
                )}
                {fsAccessSupported() ? "Save to drive" : "Download"}
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              onClick={onForget}
              disabled={cloud.kind === "uploading"}
              className="gap-1.5 text-muted-foreground hover:text-destructive"
              title="Drop this section from memory"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Forget
            </Button>
          </>
        ) : null}

        {section.state === "failed" && section.errorMessage && (
          <span className="text-xs text-destructive">{section.errorMessage}</span>
        )}
      </div>
    </div>
  );
}

// ─── The main panel ───────────────────────────────────────────
export function ReplayPanel({
  recorder,
  isLive,
  roomCode,
  streamTitle,
  streamId,
}: ReplayPanelProps) {
  const { sections, isRecording, markSectionEnd, forgetSection } = recorder;

  const baseExportName = `${streamTitle || "stream"}_${roomCode}`;

  const handleMarkEnd = useCallback(async () => {
    try {
      await markSectionEnd();
      toast.success("Section finalised. New section started.");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`Could not finalise section: ${msg}`);
    }
  }, [markSectionEnd]);

  // Soft advisory if the active section has been running a long time.
  const activeSection = sections.find((s) => s.state === "recording");
  const liveDuration = useLiveDuration(
    activeSection?.startedAt ?? Date.now(),
    !!activeSection
  );
  const overSoftLimit =
    activeSection && liveDuration > REPLAY_MAX_SECTION_MINUTES * 60_000;

  return (
    <div className="flex flex-col h-full">
      {/* Header / primary action */}
      <div className="shrink-0 px-4 py-3 border-b border-border space-y-2">
        <div className="flex items-center justify-between gap-2">
          <div className="text-sm font-medium">Sections & Replay</div>
          <Badge variant="outline" className="text-[10px]">
            {sections.length} total
          </Badge>
        </div>
        <Button
          size="sm"
          className="w-full gap-1.5"
          variant={isRecording ? "default" : "outline"}
          onClick={handleMarkEnd}
          disabled={!isRecording || !isLive}
          title={
            !isLive
              ? "Live is not active"
              : !isRecording
                ? "No section is currently recording"
                : "Finalise this section and start a new one"
          }
        >
          <Scissors className="w-3.5 h-3.5" />
          Mark Section End
        </Button>
        {overSoftLimit && (
          <div className="text-[11px] text-amber-600 dark:text-amber-400 flex items-start gap-1.5">
            <Info className="w-3 h-3 mt-0.5 shrink-0" />
            <span>
              This section has been recording for over {REPLAY_MAX_SECTION_MINUTES}{" "}
              minutes. Marking a section end now keeps the file size manageable.
            </span>
          </div>
        )}
      </div>

      {/* Section list */}
      <ScrollArea className="flex-1 min-h-0">
        <div className="p-3 space-y-2.5">
          {sections.length === 0 && (
            <div className="text-xs text-muted-foreground text-center py-8 px-4">
              {isLive
                ? "Recording will start automatically. Sections appear here as you mark them."
                : "No sections yet. Start the live stream and the first section will begin recording."}
            </div>
          )}
          {sections.map((s) => (
            <SectionRow
              key={s.id}
              section={s}
              onForget={() => forgetSection(s.id)}
              baseExportName={baseExportName}
              streamId={streamId}
            />
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}
