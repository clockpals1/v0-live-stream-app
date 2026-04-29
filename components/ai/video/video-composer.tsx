"use client";

/**
 * VideoComposer
 *
 * Canvas-based short-video assembler that runs entirely in the browser.
 * No server processing, no external render farm — everything happens in
 * the tab using the Web APIs that are already available.
 *
 * Flow:
 *   1. Preview  — click "Preview" to play a looping canvas slideshow
 *                 with text overlays + voiceover audio (no recording yet).
 *   2. Record   — click "Record Video" to capture the canvas + audio
 *                 with MediaRecorder. Real-time progress bar while the
 *                 animation plays through once.
 *   3. Review   — inline <video> player to review the assembled take.
 *   4. Save     — "Save to Replay Library" uploads the blob to R2 via
 *                 presigned PUT, then calls finalize-render to mark the
 *                 project as published and make it findable in the
 *                 Replay Library and Distribution queues.
 *
 * Technical notes
 * ───────────────
 * - canvas.captureStream(30) → 30fps video track
 * - audioEl.captureStream() → audio track (Chrome/Edge only; Firefox/Safari
 *   fall back to video-only silently)
 * - MediaRecorder codec: video/webm;codecs=vp9 with fallback to video/webm
 * - 9:16 canvas (1080×1920) scaled down to 540×960 for rendering speed
 * - Image cross-origin: data: URLs never trigger CORS; R2 public URLs need
 *   CORS enabled on the bucket (common setup). Falls back to placeholder
 *   coloured background if the image load fails.
 */

import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import {
  Play,
  StopCircle,
  Video,
  Upload,
  Check,
  Loader2,
  BookOpen,
  Send,
  AlertCircle,
  RefreshCw,
  Download,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ComposerScene {
  id: string;
  order: number;
  duration: number;
  on_screen_text?: string;
  script?: string;
  image_url?: string;
}

interface VideoComposerProps {
  projectId: string;
  scenes: ComposerScene[];
  voiceoverUrl: string | null;
  onSaved?: (renderId: string, publicUrl: string | null) => void;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function cn(...cls: (string | boolean | undefined)[]) {
  return cls.filter(Boolean).join(" ");
}

const CANVAS_W = 540;
const CANVAS_H = 960;

const SCENE_BG_COLORS = [
  "#1e293b", "#1e1b4b", "#14532d", "#7c1d1d",
  "#1c1917", "#0c4a6e", "#3b0764", "#064e3b",
];

/** Load an image element from a URL, resolving to null on error/timeout.
 * NOTE: crossOrigin is intentionally NOT set — Pollinations.ai and similar
 * CDNs do not return CORS headers, so setting crossOrigin="anonymous" causes
 * an immediate network error. The canvas will be tainted for toDataURL/toBlob
 * but captureStream() + MediaRecorder still works correctly. */
function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    if (!src) return resolve(null);
    const img = new Image();
    const timer = setTimeout(() => resolve(null), 12000);
    img.onload = () => { clearTimeout(timer); resolve(img); };
    img.onerror = () => { clearTimeout(timer); resolve(null); };
    img.src = src;
  });
}

/** Draw a single frame for the given scene. */
function drawFrame(
  ctx: CanvasRenderingContext2D,
  scene: ComposerScene,
  image: HTMLImageElement | null,
  index: number,
) {
  const W = CANVAS_W;
  const H = CANVAS_H;

  // Background
  if (image) {
    const scale = Math.max(W / image.width, H / image.height);
    const sw = image.width * scale;
    const sh = image.height * scale;
    ctx.drawImage(image, (W - sw) / 2, (H - sh) / 2, sw, sh);
  } else {
    ctx.fillStyle = SCENE_BG_COLORS[index % SCENE_BG_COLORS.length];
    ctx.fillRect(0, 0, W, H);
  }

  // Dark vignette gradient at bottom for text legibility
  const grad = ctx.createLinearGradient(0, H * 0.55, 0, H);
  grad.addColorStop(0, "rgba(0,0,0,0)");
  grad.addColorStop(1, "rgba(0,0,0,0.82)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, H * 0.55, W, H * 0.45);

  // On-screen text overlay
  if (scene.on_screen_text) {
    ctx.font = "bold 34px Inter, system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    // Shadow for readability
    ctx.shadowColor = "rgba(0,0,0,0.8)";
    ctx.shadowBlur = 8;
    ctx.fillStyle = "#ffffff";
    const maxW = W - 60;
    wrapText(ctx, scene.on_screen_text, W / 2, H - 70, maxW, 44);
    ctx.shadowBlur = 0;
  }
}

/** Wrap text across multiple lines. */
function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
) {
  const words = text.split(" ");
  let line = "";
  const lines: string[] = [];
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  const startY = y - (lines.length - 1) * lineHeight;
  for (let i = 0; i < lines.length; i++) {
    ctx.fillText(lines[i], x, startY + i * lineHeight);
  }
}

// ─── Main component ───────────────────────────────────────────────────────────

export function VideoComposer({
  projectId,
  scenes,
  voiceoverUrl,
  onSaved,
}: VideoComposerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const rafRef = useRef<number>(0);
  const chunksRef = useRef<Blob[]>([]);
  const startTimeRef = useRef<number>(0);

  const [images, setImages] = useState<(HTMLImageElement | null)[]>([]);
  const [imagesLoading, setImagesLoading] = useState(false);
  const [mode, setMode] = useState<"idle" | "preview" | "recording" | "recorded" | "uploading" | "saved">("idle");
  const [progress, setProgress] = useState(0);
  const [recordedUrl, setRecordedUrl] = useState<string | null>(null);
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [savedPublicUrl, setSavedPublicUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const sortedScenes = useMemo(
    () => [...scenes].sort((a, b) => a.order - b.order),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [scenes.map((s) => `${s.id}:${s.image_url}`).join(",")],
  );
  const totalDuration = useMemo(
    () => sortedScenes.reduce((s, sc) => s + sc.duration, 0),
    [sortedScenes],
  );

  // Pre-load images sequentially (staggered) to avoid CDN rate limits
  useEffect(() => {
    if (sortedScenes.length === 0) return;
    let cancelled = false;
    setImagesLoading(true);
    (async () => {
      const imgs: (HTMLImageElement | null)[] = [];
      for (let i = 0; i < sortedScenes.length; i++) {
        if (cancelled) return;
        if (i > 0) await new Promise((r) => setTimeout(r, 600));
        imgs.push(await loadImage(sortedScenes[i].image_url ?? ""));
      }
      if (!cancelled) {
        setImages(imgs);
        setImagesLoading(false);
      }
    })();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sortedScenes]);

  // ── Animation loop ────────────────────────────────────────────────
  const runAnimation = useCallback(
    (
      canvas: HTMLCanvasElement,
      isRecording: boolean,
      onComplete?: () => void,
    ) => {
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      let cumMs = 0;
      const sceneBoundaries = sortedScenes.map((sc) => {
        const start = cumMs;
        cumMs += sc.duration * 1000;
        return { scene: sc, start, end: cumMs };
      });
      const total = cumMs;

      const tick = (now: number) => {
        if (!startTimeRef.current) startTimeRef.current = now;
        const elapsed = now - startTimeRef.current;
        const clamped = Math.min(elapsed, total);

        if (isRecording) setProgress(Math.round((clamped / total) * 100));

        // Find active scene
        let activeIdx = sceneBoundaries.length - 1;
        for (let i = 0; i < sceneBoundaries.length; i++) {
          if (clamped < sceneBoundaries[i].end) { activeIdx = i; break; }
        }
        const { scene } = sceneBoundaries[activeIdx];
        const img = images[activeIdx] ?? null;
        drawFrame(ctx, scene, img, activeIdx);

        if (elapsed >= total && isRecording) {
          onComplete?.();
        } else if (elapsed >= total && !isRecording) {
          // Loop preview
          startTimeRef.current = now;
          rafRef.current = requestAnimationFrame(tick);
        } else {
          rafRef.current = requestAnimationFrame(tick);
        }
      };

      startTimeRef.current = 0;
      rafRef.current = requestAnimationFrame(tick);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [images, sortedScenes],
  );

  // ── Start preview ─────────────────────────────────────────────────
  const handlePreview = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    setMode("preview");
    cancelAnimationFrame(rafRef.current);
    if (audioRef.current) {
      audioRef.current.currentTime = 0;
      audioRef.current.play().catch(() => {});
    }
    runAnimation(canvas, false);
  };

  const handleStopPreview = () => {
    cancelAnimationFrame(rafRef.current);
    audioRef.current?.pause();
    setMode("idle");
  };

  // ── Record ────────────────────────────────────────────────────────
  const handleRecord = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    setError(null);
    setMode("recording");
    setProgress(0);
    chunksRef.current = [];
    cancelAnimationFrame(rafRef.current);

    // Build combined stream: canvas video + optional audio
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const videoStream: MediaStream = (canvas as any).captureStream(30);
    const audioEl = audioRef.current;
    if (audioEl) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const audioStream: MediaStream = (audioEl as any).captureStream?.();
        if (audioStream) {
          audioStream.getAudioTracks().forEach((t) => videoStream.addTrack(t));
        }
      } catch {
        /* audio capture not supported — video only */
      }
    }

    const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp9")
      ? "video/webm;codecs=vp9"
      : "video/webm";
    const recorder = new MediaRecorder(videoStream, { mimeType });
    recorderRef.current = recorder;

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };

    recorder.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: "video/webm" });
      if (recordedUrl) URL.revokeObjectURL(recordedUrl);
      const url = URL.createObjectURL(blob);
      setRecordedBlob(blob);
      setRecordedUrl(url);
      setMode("recorded");
      setProgress(100);
    };

    recorder.start(100);

    // Restart audio from the beginning
    if (audioEl) {
      audioEl.currentTime = 0;
      audioEl.play().catch(() => {});
    }

    // Run animation once — when done stop recorder
    runAnimation(canvas, true, () => {
      recorder.stop();
      audioEl?.pause();
    });
  }, [runAnimation, recordedUrl]);

  const handleCancelRecord = () => {
    cancelAnimationFrame(rafRef.current);
    recorderRef.current?.stop();
    audioRef.current?.pause();
    setMode("idle");
    setProgress(0);
  };

  // ── Save to Replay Library ────────────────────────────────────────
  const handleSave = useCallback(async () => {
    if (!recordedBlob) return;
    setError(null);
    setMode("uploading");
    setUploadProgress(0);

    try {
      // 1. Mint presigned R2 upload URL
      const startRes = await fetch(`/api/ai/video/${projectId}/start-render`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contentType: "video/webm" }),
      });
      const startJson = await startRes.json();
      if (!startRes.ok)
        throw new Error(startJson.error ?? "Could not start upload.");
      const { renderId, uploadUrl, headers } = startJson as {
        renderId: string;
        uploadUrl: string;
        headers: Record<string, string>;
        publicUrl: string | null;
      };

      // 2. PUT blob to R2 via XHR for progress events
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("PUT", uploadUrl, true);
        for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v);
        xhr.upload.onprogress = (ev) => {
          if (ev.lengthComputable)
            setUploadProgress(Math.round((ev.loaded / ev.total) * 100));
        };
        xhr.onload = () =>
          xhr.status >= 200 && xhr.status < 300
            ? resolve()
            : reject(new Error(`R2 upload failed (HTTP ${xhr.status})`));
        xhr.onerror = () => reject(new Error("Network error during upload."));
        xhr.send(recordedBlob);
      });

      // 3. Finalize
      const finalRes = await fetch(
        `/api/ai/video/${projectId}/finalize-render`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            renderId,
            byteSize: recordedBlob.size,
          }),
        },
      );
      const finalJson = await finalRes.json();
      if (!finalRes.ok)
        throw new Error(finalJson.error ?? "Could not finalize render.");

      const url: string | null = finalJson.publicUrl ?? null;
      setSavedPublicUrl(url);
      setMode("saved");
      onSaved?.(renderId, url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed.");
      setMode("recorded");
    }
  }, [projectId, recordedBlob, onSaved]);

  const imagesWithUrls = sortedScenes.filter((s) => s.image_url).length;

  // ── Render ────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      {/* Hidden audio element for voiceover playback + capture */}
      {voiceoverUrl && (
        // eslint-disable-next-line jsx-a11y/media-has-caption
        <audio ref={audioRef} src={voiceoverUrl} preload="auto" className="hidden" />
      )}

      {/* Canvas */}
      <div className="relative overflow-hidden rounded-xl border border-border/60 bg-black">
        <canvas
          ref={canvasRef}
          width={CANVAS_W}
          height={CANVAS_H}
          className="mx-auto block"
          style={{ maxHeight: "480px", width: "auto" }}
        />

        {/* Idle overlay */}
        {mode === "idle" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/60">
            {imagesLoading ? (
              <Loader2 className="h-8 w-8 animate-spin text-white/60" />
            ) : (
              <>
                <Video className="h-10 w-10 text-white/40" />
                <p className="text-sm text-white/60">
                  {imagesWithUrls === 0
                    ? "Generate scene visuals first to preview"
                    : "Canvas preview ready"}
                </p>
              </>
            )}
          </div>
        )}

        {/* Recording progress overlay */}
        {mode === "recording" && (
          <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-4">
            <div className="flex items-center gap-3">
              <span className="flex h-2.5 w-2.5 animate-pulse rounded-full bg-rose-500" />
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/20">
                <div
                  className="h-full rounded-full bg-rose-500 transition-all duration-200"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <span className="text-xs tabular-nums text-white/80">{progress}%</span>
            </div>
          </div>
        )}
      </div>

      {/* Recorded video review */}
      {(mode === "recorded" || mode === "saved") && recordedUrl && (
        // eslint-disable-next-line jsx-a11y/media-has-caption
        <video
          src={recordedUrl}
          controls
          playsInline
          className="mx-auto block w-full max-w-xs rounded-xl border border-border/60 bg-black"
        />
      )}

      {/* Error */}
      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
          {error}
        </div>
      )}

      {/* Upload progress */}
      {mode === "uploading" && (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Uploading to Replay Library…</span>
            <span className="tabular-nums">{uploadProgress}%</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-violet-500 transition-all duration-200"
              style={{ width: `${uploadProgress}%` }}
            />
          </div>
        </div>
      )}

      {/* Saved confirmation */}
      {mode === "saved" && (
        <div className="flex items-start gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/5 px-4 py-3">
          <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-emerald-700 dark:text-emerald-300">
              Saved to Replay Library
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Your video is now available in the Replay Library and can be
              queued for Distribution or pushed to the Publishing Hub.
            </p>
          </div>
        </div>
      )}

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-2">
        {/* Preview / Stop preview */}
        {mode === "idle" || mode === "recorded" ? (
          <button
            type="button"
            onClick={handlePreview}
            disabled={imagesLoading || sortedScenes.length === 0}
            className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-[12px] text-muted-foreground hover:bg-muted transition-colors disabled:opacity-40"
          >
            <Play className="h-3.5 w-3.5" />
            {mode === "recorded" ? "Re-preview" : "Preview"}
          </button>
        ) : mode === "preview" ? (
          <button
            type="button"
            onClick={handleStopPreview}
            className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-[12px] text-muted-foreground hover:bg-muted transition-colors"
          >
            <StopCircle className="h-3.5 w-3.5" />
            Stop Preview
          </button>
        ) : null}

        {/* Record */}
        {(mode === "idle" || mode === "preview" || mode === "recorded") && (
          <button
            type="button"
            onClick={handleRecord}
            disabled={imagesLoading || sortedScenes.length === 0}
            className="flex items-center gap-1.5 rounded-md bg-rose-600 px-3 py-1.5 text-[12px] font-medium text-white hover:bg-rose-700 transition-colors disabled:opacity-40"
          >
            <Video className="h-3.5 w-3.5" />
            {mode === "recorded" ? "Re-record" : "Record Video"}
          </button>
        )}

        {/* Cancel recording */}
        {mode === "recording" && (
          <button
            type="button"
            onClick={handleCancelRecord}
            className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-[12px] text-muted-foreground hover:bg-muted transition-colors"
          >
            <StopCircle className="h-3.5 w-3.5" />
            Cancel
          </button>
        )}

        {/* Download local copy */}
        {mode === "recorded" && recordedUrl && (
          <a
            href={recordedUrl}
            download="short-video.webm"
            className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-[12px] text-muted-foreground hover:bg-muted transition-colors"
          >
            <Download className="h-3.5 w-3.5" />
            Download
          </a>
        )}

        {/* Save to Replay Library */}
        {mode === "recorded" && (
          <button
            type="button"
            onClick={handleSave}
            className="flex items-center gap-1.5 rounded-md bg-violet-600 px-3 py-1.5 text-[12px] font-medium text-white hover:bg-violet-700 transition-colors"
          >
            <BookOpen className="h-3.5 w-3.5" />
            Save to Replay Library
          </button>
        )}

        {/* Uploading spinner */}
        {mode === "uploading" && (
          <div className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Saving…
          </div>
        )}

        {/* Re-record after save */}
        {mode === "saved" && (
          <>
            <button
              type="button"
              onClick={() => setMode("recorded")}
              className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-[12px] text-muted-foreground hover:bg-muted transition-colors"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Re-record
            </button>
            <a
              href="/studio/replay"
              className="flex items-center gap-1.5 rounded-md border border-emerald-500/40 px-3 py-1.5 text-[12px] font-medium text-emerald-700 dark:text-emerald-400 hover:bg-emerald-500/10 transition-colors"
            >
              <BookOpen className="h-3.5 w-3.5" />
              Open Replay Library
            </a>
            <a
              href="/ai/publish"
              className="flex items-center gap-1.5 rounded-md bg-violet-600 px-3 py-1.5 text-[12px] font-medium text-white hover:bg-violet-700 transition-colors"
            >
              <Send className="h-3.5 w-3.5" />
              Queue for Distribution
            </a>
          </>
        )}

        {/* Upload fallback */}
        {mode === "idle" && imagesWithUrls === 0 && (
          <p className="text-[11px] text-muted-foreground">
            Generate scene visuals first — then come back here to assemble.
          </p>
        )}
      </div>

      {/* Stats bar */}
      {sortedScenes.length > 0 && (
        <div className="flex items-center gap-4 rounded-lg border border-border/50 bg-muted/20 px-3 py-2 text-[11px] text-muted-foreground">
          <span>{sortedScenes.length} scenes</span>
          <span>~{totalDuration}s</span>
          <span>{imagesWithUrls}/{sortedScenes.length} visuals ready</span>
          {voiceoverUrl && (
            <span className="text-emerald-600 dark:text-emerald-400">
              ✓ Voiceover ready
            </span>
          )}
          {!voiceoverUrl && (
            <span className="text-amber-600 dark:text-amber-400">
              No voiceover — video will be silent
            </span>
          )}
        </div>
      )}
    </div>
  );
}
