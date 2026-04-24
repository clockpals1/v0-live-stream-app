"use client";

/**
 * Host-side overlay music card.
 *
 * Self-contained module:
 *   - Drag / browse upload of an audio file to the `stream-overlays` bucket
 *   - Play / Pause / Stop controls
 *   - Volume slider (0..1)
 *   - Mix-with-mic toggle (viewers hear mic + music together, or music only)
 *
 * When the host hits Play:
 *   1. An HTMLAudioElement loads the uploaded URL.
 *   2. createOverlayAudioMixer() wires [mic track] + [<audio>] into a single
 *      mixed MediaStreamTrack.
 *   3. onLiveAudioTrack(mixedTrack) is called — the parent pushes it through
 *      useHostStream.setLiveAudioTrack() → sender.replaceTrack() on every
 *      viewer's audio sender (no WebRTC renegotiation required).
 *
 * On Stop: destroys the mixer and calls onLiveAudioTrack(null) so the parent
 * restores the live mic track to every viewer.
 *
 * This component is fully opt-in: until the host clicks Play, viewers hear
 * exactly what they heard before (the host's mic). Publishing flow is
 * unchanged.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import {
  Music,
  Upload,
  X,
  Loader2,
  Play,
  Pause,
  Square,
  Volume2,
} from "lucide-react";
import {
  createOverlayAudioMixer,
  type OverlayAudioMixer,
} from "@/lib/webrtc/audio-mixer";

const MAX_BYTES = 20 * 1024 * 1024; // 20 MB — enough for a ~20 min mp3
const ALLOWED_TYPES = [
  "audio/mpeg",
  "audio/mp3",
  "audio/wav",
  "audio/wave",
  "audio/x-wav",
  "audio/ogg",
  "audio/webm",
  "audio/aac",
  "audio/mp4",
  "audio/x-m4a",
];

interface OverlayMusicProps {
  streamId: string;
  currentUrl: string;
  /** Host's mic track — used for mixing. May be null if host has no mic. */
  micTrack: MediaStreamTrack | null;
  /** True only when the stream is actively sending to viewers. */
  isStreaming: boolean;
  /** Persisted state from DB. */
  initial: {
    active: boolean;
    volume: number;
    mixWithMic: boolean;
  };
  /** Called with a new mixed track (to push to viewers) or null to restore mic. */
  onLiveAudioTrack: (track: MediaStreamTrack | null) => void;
  /** Called after a successful upload with the new public URL. */
  onUploaded: (url: string) => void;
  /** Called when the host clears the uploaded file. */
  onCleared: () => void;
  /** Called whenever playing/volume/mix changes — parent persists + broadcasts. */
  onStateChange: (state: {
    active: boolean;
    volume: number;
    mixWithMic: boolean;
  }) => void;
}

export function OverlayMusic({
  streamId,
  currentUrl,
  micTrack,
  isStreaming,
  initial,
  onLiveAudioTrack,
  onUploaded,
  onCleared,
  onStateChange,
}: OverlayMusicProps) {
  const supabaseRef = useRef(createClient());
  const supabase = supabaseRef.current;
  const inputRef = useRef<HTMLInputElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const mixerRef = useRef<OverlayAudioMixer | null>(null);

  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [isDragging, setIsDragging] = useState(false);

  const [playing, setPlaying] = useState(false);
  const [volume, setVolume] = useState(initial.volume ?? 0.8);
  const [mixWithMic, setMixWithMic] = useState(initial.mixWithMic ?? true);
  const [duration, setDuration] = useState(0);
  const [position, setPosition] = useState(0);

  // ── Upload ────────────────────────────────────────────────────────────────
  const doUpload = useCallback(
    async (file: File) => {
      // Browsers sometimes report empty MIME for .m4a; accept by extension too.
      const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
      const okByExt = ["mp3", "wav", "ogg", "webm", "m4a", "aac"].includes(ext);
      if (!ALLOWED_TYPES.includes(file.type) && !okByExt) {
        toast.error("Unsupported format. Use MP3, WAV, OGG, M4A, or AAC.");
        return;
      }
      if (file.size > MAX_BYTES) {
        toast.error(
          `File is ${(file.size / 1024 / 1024).toFixed(1)} MB — max is ${MAX_BYTES / 1024 / 1024} MB.`
        );
        return;
      }

      setUploading(true);
      setProgress(10);
      try {
        const safeName = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext || "bin"}`;
        const path = `${streamId}/music/${safeName}`;

        setProgress(40);
        const { error: upErr } = await supabase.storage
          .from("stream-overlays")
          .upload(path, file, {
            cacheControl: "3600",
            contentType: file.type || "audio/mpeg",
            upsert: false,
          });
        if (upErr) throw upErr;

        setProgress(80);
        const { data: urlData } = supabase.storage
          .from("stream-overlays")
          .getPublicUrl(path);
        if (!urlData?.publicUrl) throw new Error("Could not resolve public URL");

        setProgress(100);
        onUploaded(urlData.publicUrl);
        toast.success("Music uploaded");
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "unknown error";
        console.error("[overlay-music] upload failed:", err);
        toast.error("Upload failed: " + msg);
      } finally {
        setUploading(false);
        setProgress(0);
      }
    },
    [streamId, supabase, onUploaded]
  );

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) doUpload(file);
    if (inputRef.current) inputRef.current.value = "";
  };

  const onDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) doUpload(file);
  };

  // ── Playback control ──────────────────────────────────────────────────────
  const teardown = useCallback(() => {
    // Stop playback first so the mixer sees no more source data.
    const el = audioRef.current;
    if (el) {
      try {
        el.pause();
      } catch {
        /* ignore */
      }
    }
    mixerRef.current?.destroy();
    mixerRef.current = null;
    audioRef.current = null;
    onLiveAudioTrack(null);
  }, [onLiveAudioTrack]);

  const handlePlay = useCallback(async () => {
    if (!currentUrl) {
      toast.error("Upload a music file first.");
      return;
    }
    if (!isStreaming) {
      toast.error("Start the stream before playing overlay music.");
      return;
    }
    try {
      // Fresh element each play — avoids stale MediaElementSource routing.
      const el = new Audio();
      el.crossOrigin = "anonymous"; // Supabase public URLs allow CORS
      el.src = currentUrl;
      el.loop = false;
      el.preload = "auto";
      el.volume = 1; // Gain is controlled by Web Audio, keep element at 1.
      audioRef.current = el;

      el.addEventListener("loadedmetadata", () => {
        setDuration(el.duration || 0);
      });
      el.addEventListener("timeupdate", () => {
        setPosition(el.currentTime || 0);
      });
      el.addEventListener("ended", () => {
        setPlaying(false);
        teardown();
        onStateChange({ active: false, volume, mixWithMic });
      });

      const mixer = createOverlayAudioMixer({
        micTrack,
        audioElement: el,
        mixWithMic,
        volume,
      });
      mixerRef.current = mixer;

      // Push mixed track to all viewers BEFORE play() so the first audio
      // samples also reach them.
      onLiveAudioTrack(mixer.outputTrack);

      await el.play();
      setPlaying(true);
      onStateChange({ active: true, volume, mixWithMic });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "unknown error";
      console.error("[overlay-music] play failed:", err);
      toast.error("Could not start music: " + msg);
      teardown();
      setPlaying(false);
    }
  }, [
    currentUrl,
    isStreaming,
    micTrack,
    mixWithMic,
    volume,
    onLiveAudioTrack,
    onStateChange,
    teardown,
  ]);

  const handlePause = useCallback(() => {
    const el = audioRef.current;
    if (!el) return;
    el.pause();
    setPlaying(false);
    onStateChange({ active: false, volume, mixWithMic });
  }, [mixWithMic, volume, onStateChange]);

  const handleStop = useCallback(() => {
    teardown();
    setPlaying(false);
    setPosition(0);
    onStateChange({ active: false, volume, mixWithMic });
  }, [mixWithMic, volume, teardown, onStateChange]);

  // Resume path (pause → play) re-uses the same element + mixer if still alive.
  const handleResume = useCallback(async () => {
    const el = audioRef.current;
    if (!el || !mixerRef.current) {
      await handlePlay();
      return;
    }
    try {
      await el.play();
      setPlaying(true);
      onStateChange({ active: true, volume, mixWithMic });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "unknown error";
      toast.error("Could not resume music: " + msg);
    }
  }, [handlePlay, mixWithMic, volume, onStateChange]);

  // Propagate live volume + mix changes WITHOUT restarting playback.
  useEffect(() => {
    mixerRef.current?.setVolume(volume);
  }, [volume]);
  useEffect(() => {
    mixerRef.current?.setMixWithMic(mixWithMic);
  }, [mixWithMic]);

  // Clean up if unmounted mid-play.
  useEffect(() => {
    return () => {
      teardown();
    };
    // teardown is stable (useCallback with onLiveAudioTrack dep)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // If streaming ends externally, stop music so we don't leak tracks.
  useEffect(() => {
    if (!isStreaming && playing) {
      handleStop();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isStreaming]);

  const fmt = (s: number) => {
    if (!Number.isFinite(s)) return "0:00";
    const m = Math.floor(s / 60);
    const r = Math.floor(s % 60);
    return `${m}:${r.toString().padStart(2, "0")}`;
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col gap-3">
      {!currentUrl ? (
        <div
          onDrop={onDrop}
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={(e) => {
            e.preventDefault();
            setIsDragging(false);
          }}
          onClick={() => !uploading && inputRef.current?.click()}
          role="button"
          tabIndex={0}
          className={`relative rounded-md border-2 border-dashed p-4 text-center cursor-pointer transition-all ${
            isDragging
              ? "border-primary bg-primary/5"
              : "border-border hover:border-foreground/40 bg-muted/10"
          } ${uploading ? "pointer-events-none opacity-70" : ""}`}
        >
          <input
            ref={inputRef}
            type="file"
            accept={ALLOWED_TYPES.join(",") + ",.mp3,.wav,.ogg,.m4a,.aac,.webm"}
            onChange={onFileChange}
            className="hidden"
          />
          {uploading ? (
            <div className="flex flex-col items-center gap-2 py-2">
              <Loader2 className="w-6 h-6 text-primary animate-spin" />
              <p className="text-xs text-foreground">Uploading… {progress}%</p>
              <div className="w-full max-w-xs h-1.5 rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full bg-primary transition-all"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-1.5 py-1">
              <Music className="w-7 h-7 text-muted-foreground" />
              <p className="text-sm font-medium">
                {isDragging
                  ? "Drop audio to upload"
                  : "Drag an audio file here or click to browse"}
              </p>
              <p className="text-[11px] text-muted-foreground">
                MP3, WAV, OGG, M4A, AAC · up to 20 MB
              </p>
            </div>
          )}
        </div>
      ) : (
        <div className="rounded-md border border-border bg-muted/20 p-3 flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <Music className="w-4 h-4 text-primary shrink-0" />
            <span className="text-xs text-muted-foreground truncate flex-1">
              Music ready · {fmt(position)} / {fmt(duration)}
            </span>
            <Button
              size="sm"
              variant="outline"
              onClick={() => inputRef.current?.click()}
              disabled={uploading || playing}
            >
              <Upload className="w-3.5 h-3.5 mr-1.5" />
              Replace
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="text-red-500 hover:text-red-600"
              onClick={() => {
                if (playing) handleStop();
                onCleared();
              }}
              disabled={uploading}
            >
              <X className="w-3.5 h-3.5" />
            </Button>
            <input
              ref={inputRef}
              type="file"
              accept={ALLOWED_TYPES.join(",") + ",.mp3,.wav,.ogg,.m4a,.aac,.webm"}
              onChange={onFileChange}
              className="hidden"
            />
          </div>

          <div className="flex items-center gap-2">
            {!playing ? (
              <Button
                size="sm"
                onClick={audioRef.current ? handleResume : handlePlay}
                disabled={!isStreaming}
                className="bg-green-600 hover:bg-green-700"
              >
                <Play className="w-3.5 h-3.5 mr-1.5" />
                {audioRef.current ? "Resume" : "Play live"}
              </Button>
            ) : (
              <Button size="sm" variant="secondary" onClick={handlePause}>
                <Pause className="w-3.5 h-3.5 mr-1.5" />
                Pause
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              onClick={handleStop}
              disabled={!audioRef.current}
            >
              <Square className="w-3.5 h-3.5 mr-1.5" />
              Stop
            </Button>
          </div>

          <div className="flex items-center gap-3">
            <Volume2 className="w-4 h-4 text-muted-foreground shrink-0" />
            <Slider
              value={[Math.round(volume * 100)]}
              min={0}
              max={100}
              step={1}
              onValueChange={(v) => setVolume((v[0] ?? 0) / 100)}
              className="flex-1"
            />
            <span className="text-[11px] text-muted-foreground w-8 text-right">
              {Math.round(volume * 100)}%
            </span>
          </div>

          <div className="flex items-center justify-between gap-2 pt-1 border-t border-border">
            <div className="flex flex-col">
              <Label htmlFor="mix-mic" className="text-xs cursor-pointer">
                Mix with microphone
              </Label>
              <span className="text-[11px] text-muted-foreground">
                {mixWithMic
                  ? "Viewers hear you and the music together"
                  : "Viewers hear only the music"}
              </span>
            </div>
            <Switch
              id="mix-mic"
              checked={mixWithMic}
              onCheckedChange={(c) => {
                setMixWithMic(c);
                if (playing) {
                  onStateChange({ active: true, volume, mixWithMic: c });
                }
              }}
            />
          </div>

          {!isStreaming && (
            <p className="text-[11px] text-amber-600">
              Start the stream to play music live.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
