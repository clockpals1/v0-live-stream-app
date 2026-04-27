"use client";

/**
 * Short-video clip panel for the host's Media deck.
 *
 * Host workflow:
 *   1. Upload a short mp4 / webm (≤ 30 MB) — stored in the same
 *      stream-overlays bucket the watermark and slideshow already use.
 *   2. Optionally write a caption shown over the clip on the viewer side.
 *   3. Toggle "Mute mic while playing" — recommended ON because the clip
 *      already has its own audio.
 *   4. Click Play. We persist `clip_active = true` and broadcast a
 *      `stream-clip` event over the existing chat channel; viewers
 *      render a fullscreen <video autoplay loop> over the live stream.
 *      If "mute mic" was on, we call onClipActiveChange so the parent
 *      can mute the host's outgoing audio track for the duration.
 *   5. Click Stop. Persists `clip_active = false`, broadcasts the off
 *      event, and the parent restores the host's pre-clip mic state.
 *
 * State lives in streams.clip_* (migration 028) so it survives a page
 * reload. If migration 028 hasn't been applied yet, every operation
 * fails soft (logged warning, UI shows the clip as un-loaded) — same
 * forward-compat strategy used by branding / scenes.
 *
 * This component never touches WebRTC directly. It only:
 *   - reads / writes Supabase (storage + streams row)
 *   - calls .send() on the chat channel
 *   - calls the optional onClipActiveChange callback so the parent
 *     can adjust the host mic. That's the cleanest seam: this panel
 *     stays focused on the clip, the parent stays focused on the WebRTC
 *     audio track.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Film,
  Loader2,
  MicOff,
  Play,
  Square,
  Trash2,
  Upload,
} from "lucide-react";
import { ICON_CHIP, SURFACE, TYPO } from "@/lib/control-room/styles";

interface Props {
  streamId: string;
  /** Existing chat broadcast channel — we only call .send(). */
  chatChannelRef: React.MutableRefObject<unknown>;
  /**
   * Fired whenever the clip's active flag flips. The parent uses it to
   * mute / restore the host's outgoing mic when `muteMic` is true.
   */
  onClipActiveChange?: (active: boolean, muteMic: boolean) => void;
  /**
   * Fired on EVERY clip state change (including caption / url edits).
   * The host's program preview uses this to render the same clip
   * overlay viewers see, so the host knows what's actually on screen.
   */
  onStateChange?: (state: {
    active: boolean;
    url: string | null;
    caption: string;
    muteMic: boolean;
  }) => void;
  /**
   * Current stream status from the parent. When the stream transitions
   * to 'ended' while a clip is playing, we auto-stop the clip — both as
   * defense (so a stale clip_active=true row can't ghost-play on the
   * next stream) and as UX (the broadcast is over, the clip should be
   * over too).
   */
  streamStatus?: "waiting" | "live" | "ended";
}

interface ClipState {
  url: string | null;
  active: boolean;
  muteMic: boolean;
  caption: string;
}

const DEFAULT_STATE: ClipState = {
  url: null,
  active: false,
  muteMic: true,
  caption: "",
};

export function VideoClipPanel({
  streamId,
  chatChannelRef,
  onClipActiveChange,
  onStateChange,
  streamStatus,
}: Props) {
  const supabaseRef = useRef(createClient());
  const supabase = supabaseRef.current;
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [state, setState] = useState<ClipState>(DEFAULT_STATE);
  const [uploading, setUploading] = useState(false);
  const [uploadPct, setUploadPct] = useState<number | null>(null);
  const [hydrated, setHydrated] = useState(false);

  // Hydrate from streams.clip_* columns on mount.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from("streams")
        .select("clip_url, clip_active, clip_mute_mic, clip_caption")
        .eq("id", streamId)
        .single();
      if (cancelled) return;
      if (error) {
        // Migration 028 may not be applied yet — fail soft.
        console.warn("[VideoClip] hydrate failed:", error.message);
        setHydrated(true);
        return;
      }
      const d = data as {
        clip_url: string | null;
        clip_active: boolean | null;
        clip_mute_mic: boolean | null;
        clip_caption: string | null;
      };
      setState({
        url: d.clip_url ?? null,
        active: !!d.clip_active,
        muteMic: d.clip_mute_mic !== false,
        caption: d.clip_caption ?? "",
      });
      setHydrated(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [streamId, supabase]);

  // Notify the parent of every state change so the host's program
  // preview can render the same overlay viewers see. Runs after every
  // setState — kept in a ref so the effect doesn't depend on a stale
  // closure of the callback.
  const onStateChangeRef = useRef(onStateChange);
  useEffect(() => {
    onStateChangeRef.current = onStateChange;
  }, [onStateChange]);
  useEffect(() => {
    onStateChangeRef.current?.({
      active: state.active,
      url: state.url,
      caption: state.caption,
      muteMic: state.muteMic,
    });
  }, [state.active, state.url, state.caption, state.muteMic]);

  // Persist + broadcast helper. We always broadcast the FULL state so a
  // viewer that joins mid-playback can render the clip without a separate
  // hydration round-trip — the broadcast IS the hydration.
  const pushState = useCallback(
    async (next: ClipState) => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (chatChannelRef.current as any)?.send?.({
          type: "broadcast",
          event: "stream-clip",
          payload: {
            active: next.active,
            url: next.url ?? "",
            caption: next.caption ?? "",
            muteMic: next.muteMic,
          },
        });
      } catch (err) {
        console.error("[VideoClip] broadcast failed:", err);
      }
      try {
        await supabase
          .from("streams")
          .update({
            clip_url: next.url,
            clip_active: next.active,
            clip_mute_mic: next.muteMic,
            clip_caption: next.caption,
          })
          .eq("id", streamId);
      } catch (err) {
        console.warn("[VideoClip] persist failed:", err);
      }
    },
    [chatChannelRef, supabase, streamId],
  );

  // ── Upload from device ───────────────────────────────────────────────
  const handleFile = async (file: File) => {
    if (!file.type.startsWith("video/")) {
      toast.error("Choose a video file (mp4 or webm).");
      return;
    }
    if (file.size > 30 * 1024 * 1024) {
      toast.error("Video must be under 30 MB.");
      return;
    }
    setUploading(true);
    setUploadPct(0);
    try {
      const ext = file.name.split(".").pop()?.toLowerCase() ?? "mp4";
      const path = `${streamId}/clips/${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from("stream-overlays")
        .upload(path, file, { cacheControl: "3600", upsert: false });
      if (upErr) throw upErr;
      const { data } = supabase.storage
        .from("stream-overlays")
        .getPublicUrl(path);
      const next: ClipState = { ...state, url: data.publicUrl, active: false };
      setState(next);
      // Persist URL only — we do NOT auto-play. Host clicks Play.
      await pushState(next);
      toast.success("Clip uploaded — press Play to roll it.");
    } catch (err: unknown) {
      console.error("[VideoClip] upload failed:", err);
      const msg = err instanceof Error ? err.message : "unknown";
      toast.error(`Upload failed: ${msg}`);
    } finally {
      setUploading(false);
      setUploadPct(null);
    }
  };

  const removeClip = async () => {
    if (state.active) {
      toast.error("Stop the clip before removing it.");
      return;
    }
    const next: ClipState = { ...state, url: null, active: false };
    setState(next);
    await pushState(next);
    toast.success("Clip removed");
  };

  const playClip = async () => {
    if (!state.url) {
      toast.error("Upload a clip first.");
      return;
    }
    const next: ClipState = { ...state, active: true };
    setState(next);
    await pushState(next);
    onClipActiveChange?.(true, next.muteMic);
  };

  const stopClip = async () => {
    const next: ClipState = { ...state, active: false };
    setState(next);
    await pushState(next);
    onClipActiveChange?.(false, state.muteMic);
  };

  // Auto-stop the clip when the stream transitions to 'ended'. This
  // guards against a stale clip_active=true row haunting the next
  // stream (the host's clip would otherwise auto-resume on the next
  // viewer load). We do NOT clear the URL — the host might want to
  // re-roll the same clip on the next stream — only the active flag.
  useEffect(() => {
    if (streamStatus === "ended" && state.active) {
      const next: ClipState = { ...state, active: false };
      setState(next);
      void pushState(next);
      onClipActiveChange?.(false, state.muteMic);
    }
    // Only watch streamStatus — we don't want this firing on every
    // unrelated state mutation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [streamStatus]);

  const updateCaption = (v: string) => {
    const trimmed = v.slice(0, 140);
    const next: ClipState = { ...state, caption: trimmed };
    setState(next);
    // If active, re-broadcast immediately so viewers see the updated caption.
    if (state.active) void pushState(next);
  };

  const updateMuteMic = (v: boolean) => {
    const next: ClipState = { ...state, muteMic: v };
    setState(next);
    void pushState(next);
  };

  // ── Render ───────────────────────────────────────────────────────────
  return (
    <div className={`${SURFACE.inline} p-3.5`}>
      <div className="flex items-center gap-2.5 mb-3">
        <span className={ICON_CHIP.primary}>
          <Film className="w-4 h-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className={TYPO.title}>Short video clip</p>
          <p className={`${TYPO.sub} truncate`}>
            Roll a B-roll, sponsor spot, or "be right back" video over your live stream.
          </p>
        </div>
        {state.active && (
          <span className="shrink-0 inline-flex items-center gap-1 h-6 px-2 rounded-full text-[10px] font-semibold uppercase tracking-[0.12em] bg-gradient-to-r from-emerald-500 to-emerald-600 text-white shadow-[0_0_0_3px_rgba(16,185,129,0.18)]">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full rounded-full bg-current opacity-60 animate-ping" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-current" />
            </span>
            Playing live
          </span>
        )}
      </div>

      {/* Upload OR loaded preview */}
      <input
        ref={fileInputRef}
        type="file"
        accept="video/mp4,video/webm,video/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void handleFile(f);
          e.target.value = "";
        }}
      />

      {state.url ? (
        <div className="flex flex-col gap-2.5">
          <div className="relative rounded-md overflow-hidden bg-black aspect-video ring-1 ring-border">
            <video
              src={state.url}
              className="w-full h-full object-cover"
              muted
              preload="metadata"
              playsInline
            />
            <div className="absolute top-2 left-2 inline-flex items-center gap-1 h-5 px-1.5 rounded text-[10px] font-semibold uppercase tracking-[0.12em] bg-black/60 text-white backdrop-blur">
              <Film className="w-3 h-3" />
              Loaded
            </div>
          </div>
          <Input
            placeholder="Optional caption (e.g. Be right back…)"
            value={state.caption}
            onChange={(e) => updateCaption(e.target.value)}
            maxLength={140}
            className="h-8 text-sm"
          />
          <label className="flex items-center justify-between gap-3 px-2.5 py-2 rounded-md bg-muted/40 ring-1 ring-border">
            <div className="flex items-center gap-2 min-w-0">
              <MicOff className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
              <div className="min-w-0">
                <p className="text-[12px] font-medium leading-tight">
                  Mute mic while playing
                </p>
                <p className="text-[10px] text-muted-foreground leading-tight">
                  Recommended — restored when you press Stop.
                </p>
              </div>
            </div>
            <Switch
              checked={state.muteMic}
              onCheckedChange={updateMuteMic}
            />
          </label>
          <div className="flex items-center justify-between gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={removeClip}
              disabled={state.active || uploading}
              className="h-8 text-destructive hover:text-destructive"
            >
              <Trash2 className="w-3.5 h-3.5 mr-1" />
              Remove
            </Button>
            {state.active ? (
              <Button size="sm" variant="destructive" onClick={stopClip} className="h-8">
                <Square className="w-3.5 h-3.5 mr-1.5 fill-current" />
                Stop clip
              </Button>
            ) : (
              <Button size="sm" onClick={playClip} className="h-8">
                <Play className="w-3.5 h-3.5 mr-1.5 fill-current" />
                Play to viewers
              </Button>
            )}
          </div>
        </div>
      ) : (
        <Button
          type="button"
          variant="outline"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading || !hydrated}
          className="w-full justify-center h-9"
        >
          {uploading ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Uploading{uploadPct !== null ? ` ${uploadPct}%` : "…"}
            </>
          ) : (
            <>
              <Upload className="w-4 h-4 mr-2" />
              Upload clip (mp4 / webm, ≤ 30 MB)
            </>
          )}
        </Button>
      )}
    </div>
  );
}
