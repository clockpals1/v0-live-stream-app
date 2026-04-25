"use client";

/**
 * Operator-side audio control room.
 *
 * Lets a Super User / cohost / admin remotely drive the owner's microphone
 * and overlay-music playback. The operator's browser can't push audio to
 * viewers directly (only the owner's WebRTC peer connections do that), so
 * every action here is dispatched as an `operator-command` message on the
 * stream's broadcast channel. The owner listens for those commands and
 * executes them locally (see HostStreamInterface).
 *
 * State reflected in the UI comes from the DB row on `streams` so every seat
 * (operator, admin dialog, dashboard) shows the same truth.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import {
  Mic,
  MicOff,
  Music,
  Play,
  Pause,
  Square,
  Upload,
  Loader2,
  Volume2,
  Radio,
  X,
} from "lucide-react";
import type { OperatorCommand, OperatorCommandEnvelope } from "@/lib/stream-ops";
import { OPERATOR_COMMAND_EVENT } from "@/lib/stream-ops";

const MAX_BYTES = 20 * 1024 * 1024;
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

interface Props {
  streamId: string;
  isStreamLive: boolean;
  /** Name of the operator issuing commands (shown in owner's toasts). */
  operatorName: string;
  /** Pass the same channel used for chat/overlay broadcasts so we piggy-back. */
  channelRef: React.MutableRefObject<any>;
}

interface AudioState {
  micMuted: boolean;
  musicUrl: string;
  musicActive: boolean;
  musicVolume: number;
  musicMixMic: boolean;
}

const defaultState: AudioState = {
  micMuted: false,
  musicUrl: "",
  musicActive: false,
  musicVolume: 0.8,
  musicMixMic: true,
};

export function OperatorAudioPanel({ streamId, isStreamLive, operatorName, channelRef }: Props) {
  const supabaseRef = useRef(createClient());
  const supabase = supabaseRef.current;
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [state, setState] = useState<AudioState>(defaultState);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [sending, setSending] = useState<string | null>(null); // op id currently dispatching

  // ── Operator's OWN browser microphone (local — separate from the remote
  // command that controls the host's mic above). This lets the operator
  // mute / unmute their own input device for things like talking over a
  // separate voice channel (Discord / Zoom) or recording voice notes,
  // without interfering with the broadcast itself. The operator's mic is
  // NOT pushed to viewers — only the host publishes audio to peers.
  const localMicStreamRef = useRef<MediaStream | null>(null);
  const [localMicReady, setLocalMicReady] = useState(false);
  const [localMicMuted, setLocalMicMuted] = useState(true); // default: muted until user clicks
  const [localMicError, setLocalMicError] = useState<string | null>(null);
  const [localMicBusy, setLocalMicBusy] = useState(false);

  // ── Load + subscribe to live state from DB ──────────────────────────────
  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      const { data } = await supabase
        .from("streams")
        .select(
          "overlay_music_url, overlay_music_active, overlay_music_volume, overlay_music_mix_mic",
        )
        .eq("id", streamId)
        .single();
      if (cancelled || !data) return;
      const d = data as any;
      setState((prev) => ({
        ...prev,
        musicUrl: d.overlay_music_url ?? "",
        musicActive: !!d.overlay_music_active,
        musicVolume: typeof d.overlay_music_volume === "number" ? d.overlay_music_volume : 0.8,
        musicMixMic: d.overlay_music_mix_mic !== false,
      }));
    };
    load();

    const ch = supabase
      .channel(`stream-audio-${streamId}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "streams", filter: `id=eq.${streamId}` },
        (payload: any) => {
          const d = payload.new ?? {};
          setState((prev) => ({
            ...prev,
            musicUrl: "overlay_music_url" in d ? d.overlay_music_url ?? "" : prev.musicUrl,
            musicActive:
              "overlay_music_active" in d ? !!d.overlay_music_active : prev.musicActive,
            musicVolume:
              "overlay_music_volume" in d && typeof d.overlay_music_volume === "number"
                ? d.overlay_music_volume
                : prev.musicVolume,
            musicMixMic:
              "overlay_music_mix_mic" in d ? d.overlay_music_mix_mic !== false : prev.musicMixMic,
          }));
        },
      )
      .subscribe();

    // Listen on the broadcast channel for the owner's mic-state echo so the
    // button reflects reality instead of our optimistic guess.
    const extra = channelRef.current;
    const micHandler = ({ payload }: { payload: any }) => {
      if (typeof payload?.muted === "boolean") {
        setState((p) => ({ ...p, micMuted: payload.muted }));
      }
    };
    try {
      extra?.on?.("broadcast", { event: "mic-state" }, micHandler);
    } catch {
      /* older supabase-js may not support on() post-subscribe; ignore */
    }

    return () => {
      cancelled = true;
      supabase.removeChannel(ch);
    };
  }, [streamId, supabase]);

  // ── Command dispatch ────────────────────────────────────────────────────
  const dispatch = useCallback(
    async (command: OperatorCommand, opLabel: string) => {
      if (!channelRef.current) {
        toast.error("Control channel not ready yet — try again in a moment.");
        return false;
      }
      setSending(opLabel);
      try {
        const env: OperatorCommandEnvelope = {
          command,
          issuedBy: operatorName,
          at: new Date().toISOString(),
        };
        await channelRef.current.send({
          type: "broadcast",
          event: OPERATOR_COMMAND_EVENT,
          payload: env,
        });
        return true;
      } catch (err: any) {
        console.error("[operator-audio] dispatch failed:", err);
        toast.error("Could not send command: " + (err?.message ?? "unknown"));
        return false;
      } finally {
        setSending(null);
      }
    },
    [channelRef, operatorName],
  );

  // ── Mic toggle ──────────────────────────────────────────────────────────
  const toggleMic = async () => {
    const nextEnable = state.micMuted; // muted → enable; unmuted → disable
    const ok = await dispatch({ op: "mic-toggle", enable: nextEnable }, "mic");
    if (ok) {
      // Optimistic flip — owner will echo authoritative state on `mic-state`.
      setState((p) => ({ ...p, micMuted: !nextEnable }));
      toast.success(nextEnable ? "Asked host to unmute mic" : "Asked host to mute mic");
    }
  };

  // ── Operator's OWN microphone (local browser only) ───────────────────────
  // First click opens the OS permission prompt and acquires the device.
  // Subsequent toggles just flip MediaStreamTrack.enabled — no re-prompt,
  // no track stop / restart, no glitch. We deliberately START muted so the
  // operator hears no surprise echo if their headphones are off the head.
  const toggleLocalMic = useCallback(async () => {
    setLocalMicError(null);
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setLocalMicError("Microphone API is not available in this browser.");
      return;
    }

    setLocalMicBusy(true);
    try {
      // Lazy-acquire the device on the first toggle.
      if (!localMicStreamRef.current) {
        const ms = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
          video: false,
        });
        // Start muted — explicit toggle by the user is what flips it on.
        ms.getAudioTracks().forEach((t) => (t.enabled = false));
        localMicStreamRef.current = ms;
        setLocalMicReady(true);
        setLocalMicMuted(true);
        // Now perform the toggle the user just clicked.
      }

      const tracks = localMicStreamRef.current.getAudioTracks();
      if (tracks.length === 0) {
        setLocalMicError("No microphone tracks available on the captured stream.");
        return;
      }

      const next = !tracks[0].enabled;
      tracks.forEach((t) => (t.enabled = next));
      setLocalMicMuted(!next);
      toast.success(next ? "Your mic is now ON (local only)" : "Your mic is now OFF");
    } catch (err: any) {
      console.error("[operator-audio] local mic toggle failed:", err);
      const msg =
        err?.name === "NotAllowedError"
          ? "Microphone permission was blocked. Allow it in your browser site settings to use this toggle."
          : err?.message ?? "Could not access the microphone.";
      setLocalMicError(msg);
      toast.error(msg);
    } finally {
      setLocalMicBusy(false);
    }
  }, []);

  // Stop the device when the panel unmounts so we don't leave the indicator
  // light on / the OS busy state stuck after the operator navigates away.
  useEffect(() => {
    return () => {
      const ms = localMicStreamRef.current;
      if (ms) {
        ms.getTracks().forEach((t) => {
          try { t.stop(); } catch { /* ignore */ }
        });
        localMicStreamRef.current = null;
      }
    };
  }, []);

  // ── Music upload ────────────────────────────────────────────────────────
  const doUpload = async (file: File) => {
    const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
    const okByExt = ["mp3", "wav", "ogg", "webm", "m4a", "aac"].includes(ext);
    if (!ALLOWED_TYPES.includes(file.type) && !okByExt) {
      toast.error("Unsupported format. Use MP3, WAV, OGG, M4A, or AAC.");
      return;
    }
    if (file.size > MAX_BYTES) {
      toast.error(`File is ${(file.size / 1024 / 1024).toFixed(1)} MB — max 20 MB.`);
      return;
    }

    setUploading(true);
    setProgress(20);
    try {
      const safeName = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext || "bin"}`;
      const path = `${streamId}/music/${safeName}`;
      setProgress(50);
      const { error } = await supabase.storage
        .from("stream-overlays")
        .upload(path, file, { cacheControl: "3600", contentType: file.type || "audio/mpeg" });
      if (error) throw error;

      setProgress(80);
      const { data: urlData } = supabase.storage.from("stream-overlays").getPublicUrl(path);
      if (!urlData?.publicUrl) throw new Error("Could not resolve public URL");

      // Persist the URL — the owner's OverlayMusic will pick it up via its
      // own DB subscription / initial load; operator's next render also reflects
      // it via the postgres_changes stream above.
      await supabase
        .from("streams")
        .update({ overlay_music_url: urlData.publicUrl })
        .eq("id", streamId);

      setProgress(100);
      toast.success("Music uploaded — ready for the host to play.");
    } catch (err: any) {
      console.error("[operator-audio] upload failed:", err);
      toast.error("Upload failed: " + (err?.message ?? "unknown"));
    } finally {
      setUploading(false);
      setProgress(0);
    }
  };

  const clearMusic = async () => {
    if (state.musicActive) {
      await dispatch({ op: "music-stop" }, "music-stop");
    }
    await supabase
      .from("streams")
      .update({ overlay_music_url: "", overlay_music_active: false })
      .eq("id", streamId);
    toast.success("Cleared music file.");
  };

  // ── Music commands ──────────────────────────────────────────────────────
  const playMusic = async () => {
    if (!state.musicUrl) {
      toast.error("Upload a music file first.");
      return;
    }
    if (!isStreamLive) {
      toast.error("Host must be live before music can play.");
      return;
    }
    await dispatch({ op: "music-play" }, "music-play");
  };
  const pauseMusic = () => dispatch({ op: "music-pause" }, "music-pause");
  const stopMusic = () => dispatch({ op: "music-stop" }, "music-stop");

  // Debounced volume/mix commands — only send on release to keep bandwidth sane.
  const onVolumeCommit = async (v: number[]) => {
    const vol = (v[0] ?? 0) / 100;
    await dispatch({ op: "music-volume", volume: vol }, "music-volume");
  };
  const onMixToggle = async (checked: boolean) => {
    await dispatch({ op: "music-mix-mic", mixWithMic: checked }, "music-mix");
  };

  const fmtVol = Math.round(state.musicVolume * 100);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <Radio className="w-4 h-4 text-primary" />
          Audio Control Room
          {state.micMuted && (
            <Badge className="bg-red-500/15 text-red-400 border border-red-500/30 text-[10px] h-5 px-1.5">
              MIC MUTED
            </Badge>
          )}
          {state.musicActive && (
            <Badge className="bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 text-[10px] h-5 px-1.5">
              MUSIC LIVE
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {/* ── Operator's OWN microphone (local browser only — does NOT
             reach viewers; only the host publishes audio over WebRTC). ── */}
        <div className="flex items-center gap-3 p-3 rounded-md border border-border bg-muted/10">
          <div
            className={`w-10 h-10 rounded-full flex items-center justify-center ${
              localMicReady && !localMicMuted
                ? "bg-emerald-500/15 text-emerald-400"
                : "bg-muted text-muted-foreground"
            }`}
          >
            {localMicReady && !localMicMuted ? (
              <Mic className="w-5 h-5" />
            ) : (
              <MicOff className="w-5 h-5" />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-foreground flex items-center gap-1.5 flex-wrap">
              Your microphone
              <Badge
                variant="outline"
                className="text-[9px] h-4 px-1.5 border-border text-muted-foreground"
              >
                LOCAL
              </Badge>
            </p>
            <p className="text-[11px] text-muted-foreground">
              {!localMicReady
                ? "Click to enable your mic (will request permission)."
                : localMicMuted
                ? "Off — your mic is muted on this device."
                : "On — your mic is active locally. Viewers do NOT hear it."}
            </p>
            {localMicError && (
              <p className="text-[11px] text-red-400 mt-0.5">{localMicError}</p>
            )}
          </div>
          <Button
            size="sm"
            variant={localMicReady && !localMicMuted ? "secondary" : "default"}
            onClick={toggleLocalMic}
            disabled={localMicBusy}
            title={
              localMicReady && !localMicMuted
                ? "Mute your local microphone"
                : "Turn on your local microphone"
            }
          >
            {localMicBusy ? (
              <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
            ) : localMicReady && !localMicMuted ? (
              <MicOff className="w-3.5 h-3.5 mr-1.5" />
            ) : (
              <Mic className="w-3.5 h-3.5 mr-1.5" />
            )}
            {localMicReady && !localMicMuted ? "Turn off" : "Turn on"}
          </Button>
        </div>

        {/* ── Host microphone (remote command — actual broadcast audio) ── */}
        <div className="flex items-center gap-3 p-3 rounded-md border border-border bg-muted/20">
          <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
            state.micMuted ? "bg-red-500/15 text-red-400" : "bg-emerald-500/15 text-emerald-400"
          }`}>
            {state.micMuted ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-foreground flex items-center gap-1.5 flex-wrap">
              Host microphone
              <Badge
                variant="outline"
                className="text-[9px] h-4 px-1.5 border-amber-500/40 text-amber-500"
              >
                ON AIR
              </Badge>
            </p>
            <p className="text-[11px] text-muted-foreground">
              {state.micMuted ? "Currently muted — viewers can't hear the host" : "Live — viewers hear the host"}
            </p>
          </div>
          <Button
            size="sm"
            variant={state.micMuted ? "default" : "secondary"}
            onClick={toggleMic}
            disabled={sending === "mic"}
          >
            {sending === "mic" ? (
              <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
            ) : state.micMuted ? (
              <Mic className="w-3.5 h-3.5 mr-1.5" />
            ) : (
              <MicOff className="w-3.5 h-3.5 mr-1.5" />
            )}
            {state.micMuted ? "Unmute" : "Mute"}
          </Button>
        </div>

        {/* ── Music upload / remote playback ── */}
        <div className="flex flex-col gap-3 p-3 rounded-md border border-border bg-muted/20">
          <div className="flex items-center gap-2">
            <Music className="w-4 h-4 text-primary" />
            <span className="text-sm font-medium">Overlay music</span>
          </div>

          {!state.musicUrl ? (
            <div
              onClick={() => !uploading && fileInputRef.current?.click()}
              role="button"
              tabIndex={0}
              className={`rounded-md border-2 border-dashed p-3 text-center cursor-pointer transition ${
                uploading ? "opacity-70 pointer-events-none border-primary bg-primary/5" : "border-border hover:border-foreground/40"
              }`}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept={ALLOWED_TYPES.join(",") + ",.mp3,.wav,.ogg,.m4a,.aac,.webm"}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) doUpload(f);
                  if (fileInputRef.current) fileInputRef.current.value = "";
                }}
                className="hidden"
              />
              {uploading ? (
                <div className="flex flex-col items-center gap-1.5 py-1">
                  <Loader2 className="w-5 h-5 text-primary animate-spin" />
                  <span className="text-xs">Uploading… {progress}%</span>
                  <div className="w-full max-w-xs h-1 rounded-full bg-muted overflow-hidden">
                    <div className="h-full bg-primary transition-all" style={{ width: `${progress}%` }} />
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-1 py-1">
                  <Upload className="w-5 h-5 text-muted-foreground" />
                  <p className="text-xs font-medium">Click to upload audio</p>
                  <p className="text-[10px] text-muted-foreground">MP3 / WAV / OGG / M4A · up to 20 MB</p>
                </div>
              )}
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground truncate flex-1">
                  Ready · {decodeURIComponent(state.musicUrl.split("/").pop() ?? "music")}
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading || state.musicActive}
                >
                  <Upload className="w-3.5 h-3.5 mr-1.5" />
                  Replace
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-red-400 hover:text-red-500"
                  onClick={clearMusic}
                  disabled={uploading}
                >
                  <X className="w-3.5 h-3.5" />
                </Button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept={ALLOWED_TYPES.join(",") + ",.mp3,.wav,.ogg,.m4a,.aac,.webm"}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) doUpload(f);
                    if (fileInputRef.current) fileInputRef.current.value = "";
                  }}
                  className="hidden"
                />
              </div>

              <div className="flex items-center gap-2">
                {!state.musicActive ? (
                  <Button
                    size="sm"
                    onClick={playMusic}
                    disabled={!isStreamLive || sending === "music-play"}
                    className="bg-emerald-600 hover:bg-emerald-700"
                  >
                    {sending === "music-play" ? (
                      <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                    ) : (
                      <Play className="w-3.5 h-3.5 mr-1.5" />
                    )}
                    Play on air
                  </Button>
                ) : (
                  <Button size="sm" variant="secondary" onClick={pauseMusic} disabled={sending === "music-pause"}>
                    {sending === "music-pause" ? (
                      <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                    ) : (
                      <Pause className="w-3.5 h-3.5 mr-1.5" />
                    )}
                    Pause
                  </Button>
                )}
                <Button size="sm" variant="outline" onClick={stopMusic} disabled={sending === "music-stop"}>
                  {sending === "music-stop" ? (
                    <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                  ) : (
                    <Square className="w-3.5 h-3.5 mr-1.5" />
                  )}
                  Stop
                </Button>
              </div>

              <div className="flex items-center gap-3">
                <Volume2 className="w-4 h-4 text-muted-foreground shrink-0" />
                <Slider
                  value={[fmtVol]}
                  min={0}
                  max={100}
                  step={5}
                  onValueChange={(v) =>
                    setState((p) => ({ ...p, musicVolume: (v[0] ?? 0) / 100 }))
                  }
                  onValueCommit={onVolumeCommit}
                  className="flex-1"
                  disabled={sending === "music-volume"}
                />
                <span className="text-[11px] text-muted-foreground w-8 text-right">{fmtVol}%</span>
              </div>

              <div className="flex items-center justify-between gap-2 pt-1 border-t border-border">
                <div className="flex flex-col">
                  <Label htmlFor="op-mix-mic" className="text-xs cursor-pointer">
                    Mix with host mic
                  </Label>
                  <span className="text-[11px] text-muted-foreground">
                    {state.musicMixMic ? "Viewers hear host + music" : "Viewers hear music only"}
                  </span>
                </div>
                <Switch
                  id="op-mix-mic"
                  checked={state.musicMixMic}
                  disabled={sending === "music-mix"}
                  onCheckedChange={onMixToggle}
                />
              </div>
            </>
          )}

          {!isStreamLive && (
            <p className="text-[11px] text-amber-500">
              Stream must be live before music can be heard by viewers.
            </p>
          )}
        </div>

        <p className="text-[10px] text-muted-foreground leading-relaxed">
          All actions are relayed to the stream owner&apos;s browser over the live control channel.
          The owner remains in full ownership of the broadcast.
        </p>
      </CardContent>
    </Card>
  );
}
