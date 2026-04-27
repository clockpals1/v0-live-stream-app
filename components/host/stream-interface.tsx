"use client";

/**
 * Host live page — Live Control Room.
 *
 * This file is now the THIN orchestrator. It owns:
 *   - WebRTC plumbing wiring (useHostStream, useCohostReceiver, useStreamHealth)
 *   - Section-replay recorder hook
 *   - Producer state hook (useControlRoomState)
 *   - Chat broadcast subscription, including operator-command + mic-state echo
 *   - The 3-zone Live Control Room layout
 *
 * Producer modules (overlay / ticker / music / media / branding / health)
 * live in `components/host/control-room/` and read state through props.
 *
 * Hand-off to OperatorStreamInterface (operator/cohost surfaces) is unchanged.
 */

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { useHostStream } from "@/lib/webrtc/use-host-stream";
import { useCohostReceiver } from "@/lib/webrtc/use-cohost-receiver";
import { useStreamHealth } from "@/lib/webrtc/use-stream-health";
import { playNotificationSound, vibrateDevice } from "@/lib/utils/notification";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { OperatorStreamInterface } from "@/components/host/operator-stream-interface";
import { PrivateMessagesPanel } from "@/components/stream/private-messages-panel";
import { DirectorPanel } from "@/components/host/director-panel";
import { PostStreamDialog } from "@/components/host/post-stream-dialog";
import { resolveRole } from "@/lib/rbac";
import type { StreamAccess } from "@/lib/rbac";
import {
  OPERATOR_COMMAND_EVENT,
  type OperatorCommandEnvelope,
} from "@/lib/stream-ops";

// Replay subsystem (feature-flag-gated, additive only)
import { ReplayPanel } from "@/components/host/replay-panel";
import { useSectionRecorder } from "@/lib/replay/use-section-recorder";
import { REPLAY_ENABLED } from "@/lib/replay/config";

// Control Room modules
import { useControlRoomState } from "@/lib/control-room/use-control-room-state";
import { ControlRoomTopbar } from "@/components/host/control-room/topbar";
import { ProgramPreview } from "@/components/host/control-room/program-preview";
import { StageActions } from "@/components/host/control-room/stage-actions";
import { PostStreamBanner } from "@/components/host/control-room/post-stream-banner";
import { ScenesRail } from "@/components/host/control-room/scenes-rail";
import { GuestsRail } from "@/components/host/control-room/guests-rail";
import { CommsTabs } from "@/components/host/control-room/comms-tabs";
import { ProducerDeck } from "@/components/host/control-room/producer-deck";
import { OverlayDeck } from "@/components/host/control-room/decks/overlay-deck";
import { TickerDeck } from "@/components/host/control-room/decks/ticker-deck";
import { MusicDeck } from "@/components/host/control-room/decks/music-deck";
import { MediaDeck } from "@/components/host/control-room/decks/media-deck";
import { BrandingDeck } from "@/components/host/control-room/decks/branding-deck";
import { HealthDeck } from "@/components/host/control-room/decks/health-deck";
import type { OverlayMusicHandle } from "@/components/host/overlay-music";
import type { BillingPlan } from "@/lib/billing/plans";

import { AlertCircle, Copy, RefreshCw, Send, Users } from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────
interface Stream {
  id: string;
  room_code: string;
  title: string;
  status: "waiting" | "live" | "ended";
  viewer_count: number;
  recording_url: string | null;
  host_id: string;
  active_participant_id?: string | null;
}

interface Host {
  id: string;
  display_name: string | null;
  email: string;
  is_admin?: boolean;
}

interface ChatMessage {
  id: string;
  sender_name: string;
  message: string;
  created_at: string;
}

interface StreamParticipant {
  id: string;
  slot_label: string;
  status: "invited" | "ready" | "live" | "offline";
  host_id: string;
  host?: { display_name: string | null; email: string };
}

interface HostStreamInterfaceProps {
  stream: Stream;
  host: Host;
  accessMode?: StreamAccess;
  /** Resolved entitlements — passed from the page so plan-gated cards
   *  in the Branding deck render synchronously without a client fetch. */
  effectivePlan?: BillingPlan | null;
}

// ── Dispatcher ────────────────────────────────────────────────────────────
export function HostStreamInterface(props: HostStreamInterfaceProps) {
  const accessMode = props.accessMode ?? "owner";
  if (accessMode === "operator" || accessMode === "cohost") {
    return (
      <OperatorStreamInterface
        stream={props.stream}
        host={props.host}
        accessMode={accessMode}
      />
    );
  }
  return (
    <OwnerStreamInterface
      stream={props.stream}
      host={props.host}
      effectivePlan={props.effectivePlan ?? null}
    />
  );
}

// ── Owner / Live Control Room ─────────────────────────────────────────────
function OwnerStreamInterface({
  stream: initialStream,
  host,
  effectivePlan,
}: {
  stream: Stream;
  host: Host;
  effectivePlan: BillingPlan | null;
}) {
  const [stream, setStream] = useState(initialStream);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [newMessage, setNewMessage] = useState("");
  const [mediaInitialized, setMediaInitialized] = useState(false);
  const [cameraFacingMode, setCameraFacingMode] = useState<"user" | "environment">("environment");
  const [isSwitching, setIsSwitching] = useState(false);
  const [videoQuality, setVideoQuality] = useState<"auto" | "high" | "medium" | "low">("auto");
  const [isDataSaver, setIsDataSaver] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [activeParticipantId, setActiveParticipantId] = useState<string | null>(
    (initialStream as any).active_participant_id ?? null,
  );
  const isStreamOwner = host.id === initialStream.host_id;
  const isAdmin = resolveRole(host) === "admin";

  const [isRefreshingChat, setIsRefreshingChat] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [cohostParticipants, setCohostParticipants] = useState<StreamParticipant[]>([]);

  // Post-stream archive dialog
  const [postStreamOpen, setPostStreamOpen] = useState(false);
  const [postStreamBlob, setPostStreamBlob] = useState<Blob | null>(null);
  const [postStreamDownloaded, setPostStreamDownloaded] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const supabaseRef = useRef(createClient());
  const supabase = supabaseRef.current;

  // Tab state (right rail). Controlled so the post-stream CTA can jump
  // the host to the Replay tab.
  const activeTabRef = useRef("chat");
  const [activeTab, setActiveTab] = useState<string>("chat");
  const replayCardRef = useRef<HTMLDivElement>(null);
  const handleTabChange = (v: string) => {
    setActiveTab(v);
    activeTabRef.current = v;
    if (v === "chat") setUnreadCount(0);
  };
  const jumpToReplayTab = () => {
    handleTabChange("replay");
    requestAnimationFrame(() => {
      replayCardRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  };

  const chatChannelRef = useRef<any>(null);
  const overlayMusicRef = useRef<OverlayMusicHandle>(null);

  const {
    mediaStream,
    initializeMedia,
    isStreaming,
    isPaused,
    videoEnabled,
    audioEnabled,
    viewerCount,
    viewers,
    error,
    isRecording,
    hasRecording,
    startStream,
    stopStream,
    pauseStream,
    resumeStream,
    toggleVideo,
    toggleAudio,
    switchCamera,
    relayStream,
    setLiveAudioTrack,
    goOnAir,
    goOffAir,
    isHostOnAir,
    controlRoomMode,
    downloadRecording,
    getRecordingBlob,
    getPeerConnections,
  } = useHostStream({
    streamId: stream.id,
    roomCode: stream.room_code,
    controlRoomMode: true,
  });

  // ── Stream-health poll (consumes peer connections from useHostStream) ──
  const health = useStreamHealth(getPeerConnections, isStreaming);

  // ── Section-replay recorder ────────────────────────────────────────────
  const sectionRecorder = useSectionRecorder({
    enabled: REPLAY_ENABLED,
    mediaStream: mediaStream ?? null,
    isLive: isStreaming,
  });

  // ── Co-host receiver fallback ──────────────────────────────────────────
  const coHostFallbackStream = useCohostReceiver(
    isStreamOwner ? activeParticipantId : null,
  );
  useEffect(() => {
    if (!isStreamOwner) return;
    if (activeParticipantId && coHostFallbackStream) {
      relayStream(coHostFallbackStream);
    } else if (!activeParticipantId) {
      relayStream(null);
    }
  }, [coHostFallbackStream, activeParticipantId, isStreamOwner, relayStream]);

  // ── Producer state — single source of truth for overlay/ticker/music
  //    /scenes/branding. Hides persistence + broadcast behind setters.
  const cr = useControlRoomState({
    streamId: stream.id,
    supabase,
    chatChannelRef,
  });

  // ── Mobile detection ───────────────────────────────────────────────────
  useEffect(() => {
    const check = () => {
      const mobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
        navigator.userAgent,
      );
      setIsMobile(mobile);
    };
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  // ── Media init (control-room mode does not auto-prompt camera) ─────────
  useEffect(() => {
    if (controlRoomMode) {
      setMediaInitialized(true);
      if (stream.status === "live" && !isStreaming) {
        setTimeout(() => { startStream(); }, 500);
      }
      return;
    }
    (async () => {
      try {
        const result = await initializeMedia("environment");
        if (videoRef.current && result) videoRef.current.srcObject = result;
        setMediaInitialized(true);
        if (stream.status === "live" && !isStreaming) {
          setTimeout(() => { startStream(); }, 1000);
        }
      } catch (err) {
        console.error("[host] initializeMedia failed:", err);
      }
    })();
  }, [controlRoomMode, initializeMedia, stream.status, isStreaming, startStream]);

  // ── Drive preview video element with the same priority used server-side
  //    for viewers: relay (co-host) > host-on-air > null.
  useEffect(() => {
    if (!videoRef.current) return;
    const next =
      activeParticipantId && coHostFallbackStream
        ? coHostFallbackStream
        : isHostOnAir && mediaStream
          ? mediaStream
          : null;
    if (videoRef.current.srcObject !== next) {
      videoRef.current.srcObject = next;
    }
  }, [mediaStream, coHostFallbackStream, activeParticipantId, isHostOnAir]);

  // ── Chat broadcast + operator commands + initial fetch ─────────────────
  useEffect(() => {
    const hostName = host.display_name || "Host";

    const loadMessages = async () => {
      const { data } = await supabase
        .from("chat_messages")
        .select("*")
        .eq("stream_id", stream.id)
        .order("created_at", { ascending: true });
      if (data) {
        setMessages((prev) => {
          const ids = new Set((data as ChatMessage[]).map((m) => m.id));
          const extras = prev.filter((m) => !ids.has(m.id));
          return [...(data as ChatMessage[]), ...extras].sort(
            (a, b) =>
              new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
          );
        });
      }
    };

    const channel = supabase
      .channel(`chat-room-${stream.id}`, { config: { broadcast: { self: true } } })
      .on(
        "broadcast",
        { event: "chat-message" },
        ({ payload }: { payload: any }) => {
          const msg = payload as ChatMessage;
          setMessages((prev) => {
            if (prev.some((m) => m.id === msg.id)) return prev;
            return [...prev, msg];
          });
          if (msg.sender_name !== hostName && activeTabRef.current !== "chat") {
            setUnreadCount((c) => c + 1);
            playNotificationSound();
            vibrateDevice();
          }
        },
      )
      .on(
        "broadcast",
        { event: OPERATOR_COMMAND_EVENT },
        ({ payload }: { payload: any }) => {
          const env = payload as OperatorCommandEnvelope;
          if (!env?.command) return;
          const by = env.issuedBy || "Operator";
          const c = env.command;
          try {
            if (c.op === "mic-toggle") {
              const audioTrack = mediaStream?.getAudioTracks()?.[0];
              if (audioTrack && audioTrack.enabled !== c.enable) toggleAudio();
              toast.info(`${by} ${c.enable ? "unmuted" : "muted"} your microphone`);
            } else if (c.op === "music-play") {
              overlayMusicRef.current?.play();
              toast.info(`${by} started the overlay music`);
            } else if (c.op === "music-pause") {
              overlayMusicRef.current?.pause();
              toast.info(`${by} paused the overlay music`);
            } else if (c.op === "music-stop") {
              overlayMusicRef.current?.stop();
              toast.info(`${by} stopped the overlay music`);
            } else if (c.op === "music-volume") {
              overlayMusicRef.current?.setVolume(c.volume);
            } else if (c.op === "music-mix-mic") {
              overlayMusicRef.current?.setMixWithMic(c.mixWithMic);
            }
          } catch (err) {
            console.error("[host] operator-command execution failed:", err);
          }
        },
      )
      .subscribe((status: string) => {
        if (status === "SUBSCRIBED") loadMessages();
      });

    chatChannelRef.current = channel;
    return () => {
      supabase.removeChannel(channel);
      chatChannelRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stream.id, host.display_name]);

  // ── Mic-state echo ─────────────────────────────────────────────────────
  useEffect(() => {
    const ch = chatChannelRef.current;
    if (!ch) return;
    try {
      ch.send({
        type: "broadcast",
        event: "mic-state",
        payload: { muted: !audioEnabled },
      });
    } catch (err) {
      console.warn("[host] mic-state echo failed:", err);
    }
  }, [audioEnabled]);

  // ── Stream-status realtime ─────────────────────────────────────────────
  useEffect(() => {
    const channel = supabase
      .channel(`stream-status-${stream.id}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "streams",
          filter: `id=eq.${stream.id}`,
        },
        (payload: any) => {
          const updated = payload.new as Stream;
          setStream(updated);
          if ("active_participant_id" in updated) {
            setActiveParticipantId(updated.active_participant_id ?? null);
          }
        },
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [stream.id, supabase]);

  // ── Co-host participants realtime ──────────────────────────────────────
  useEffect(() => {
    const load = async () => {
      const { data } = await supabase
        .from("stream_participants")
        .select("id, slot_label, status, host_id, host:hosts(display_name, email)")
        .eq("stream_id", stream.id)
        .neq("status", "offline");
      if (data) setCohostParticipants(data as StreamParticipant[]);
    };
    load();
    const channel = supabase
      .channel(`participants-${stream.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "stream_participants",
          filter: `stream_id=eq.${stream.id}`,
        },
        () => { load(); },
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [stream.id, supabase]);

  // ── Auto-scroll chat ──────────────────────────────────────────────────
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [messages]);

  // ── Beforeunload guard while live ─────────────────────────────────────
  useEffect(() => {
    if (!isStreaming) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [isStreaming]);

  // ── Video quality apply on change ─────────────────────────────────────
  useEffect(() => {
    if (!mediaInitialized || !mediaStream) return;
    const track = mediaStream.getVideoTracks()[0];
    if (!track) return;
    const constraints = {
      width: isDataSaver
        ? { ideal: 640 }
        : videoQuality === "low"
          ? { ideal: 480 }
          : videoQuality === "medium"
            ? { ideal: 720 }
            : videoQuality === "high"
              ? { ideal: 1080 }
              : { ideal: 720 },
      height: isDataSaver
        ? { ideal: 360 }
        : videoQuality === "low"
          ? { ideal: 360 }
          : videoQuality === "medium"
            ? { ideal: 480 }
            : videoQuality === "high"
              ? { ideal: 720 }
              : { ideal: 480 },
      frameRate: isDataSaver ? { ideal: 15 } : { ideal: 30 },
    };
    track.applyConstraints(constraints).catch((err) => {
      console.warn("[host] applyConstraints failed:", err);
    });
  }, [videoQuality, isDataSaver, mediaInitialized, mediaStream]);

  // ── Handlers ──────────────────────────────────────────────────────────
  const handleStartStream = async () => {
    await startStream();
    setStream((prev) => ({ ...prev, status: "live" }));
  };

  const handleEndStream = async () => {
    if (REPLAY_ENABLED) {
      try { await sectionRecorder.finaliseAndStop(); }
      catch (err) { console.error("[Replay] finaliseAndStop failed:", err); }
    }
    const hadRecording = await stopStream();
    setStream((prev) => ({ ...prev, status: "ended" }));
    if (hadRecording) {
      toast.success("Stream ended — recording downloaded to your device.");
      const blob = getRecordingBlob();
      if (blob) {
        setPostStreamBlob(blob);
        setPostStreamDownloaded(true);
        setPostStreamOpen(true);
      }
    }
  };

  const handleRestartStream = async () => {
    if (stream.status !== "ended") return;
    try {
      const { error } = await supabase
        .from("streams")
        .update({
          status: "waiting",
          started_at: null,
          ended_at: null,
          viewer_count: 0,
        })
        .eq("id", stream.id);
      if (error) {
        toast.error("Couldn't restart the stream: " + error.message);
        return;
      }
      setStream((prev) => ({
        ...prev,
        status: "waiting",
        started_at: null,
        ended_at: null,
        viewer_count: 0,
      }));
      toast.success("Stream restarted — click 'Go Live' when you're ready.");
    } catch (err) {
      console.error("[host] Restart error:", err);
      toast.error("Couldn't restart the stream.");
    }
  };

  const rotateCamera = async () => {
    if (isSwitching) return;
    setIsSwitching(true);
    const next = cameraFacingMode === "user" ? "environment" : "user";
    setCameraFacingMode(next);
    try {
      const newStream = await switchCamera(next);
      if (newStream && videoRef.current) videoRef.current.srcObject = newStream;
    } finally {
      setIsSwitching(false);
    }
  };

  const sendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMessage.trim()) return;
    const msgText = newMessage.trim();
    setNewMessage("");
    const { data } = await supabase
      .from("chat_messages")
      .insert({
        stream_id: stream.id,
        sender_name: host.display_name || "Host",
        message: msgText,
      })
      .select()
      .single();
    if (data && chatChannelRef.current) {
      chatChannelRef.current.send({
        type: "broadcast",
        event: "chat-message",
        payload: data,
      });
    }
  };

  const refreshChat = async () => {
    setIsRefreshingChat(true);
    try {
      const { data } = await supabase
        .from("chat_messages")
        .select("*")
        .eq("stream_id", stream.id)
        .order("created_at", { ascending: true });
      if (data) setMessages(data as ChatMessage[]);
    } finally {
      setIsRefreshingChat(false);
    }
  };

  const getNameColor = (name: string) => {
    const colors = [
      "text-blue-400", "text-emerald-400", "text-purple-400", "text-orange-400",
      "text-pink-400", "text-cyan-400", "text-yellow-400", "text-rose-400",
      "text-indigo-400", "text-teal-400",
    ];
    let hash = 0;
    for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
    return colors[Math.abs(hash) % colors.length];
  };

  const connectedViewers = viewers.filter((v) => v.connected).length;
  const showOpenReplay =
    REPLAY_ENABLED && isStreamOwner && sectionRecorder.sections.length > 0;

  // ── JSX ───────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-background">
      <ControlRoomTopbar
        roomCode={stream.room_code}
        streamId={stream.id}
        streamTitle={stream.title}
        isStreaming={isStreaming}
        isPaused={isPaused}
        isRecording={isRecording}
        connectedViewers={connectedViewers}
        totalViewers={viewerCount}
        showOperatorsDialog={isAdmin || isStreamOwner}
        health={health}
      />

      <main className="container mx-auto px-4 py-6">
        {error && (
          <div className="mb-4 p-4 bg-destructive/10 border border-destructive rounded-lg flex items-center gap-2">
            <AlertCircle className="w-5 h-5 text-destructive" />
            <p className="text-sm text-destructive">{error}</p>
          </div>
        )}

        {/* 3-zone Live Control Room layout:
              xl: [scenes/guests rail | program + producer deck | comms tabs]
              md: [program + producer deck | comms tabs]  (rails collapse to bottom)
              sm: stack: program → comms → producer → rails */}
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-12 gap-4">
          {/* ── Left rail (xl only): Scenes + Guests ─────────────────── */}
          <aside className="xl:col-span-2 xl:order-1 order-3 flex flex-col gap-4">
            <ScenesRail
              scenes={cr.scenes}
              currentLayout={cr.branding.layout ?? "solo"}
              currentOverlay={cr.overlay}
              currentTicker={cr.ticker}
              currentMusicUrl={cr.overlayMusicUrl}
              onApply={(s) => { void cr.applyScene(s); }}
              onSave={cr.saveScene}
              onDelete={cr.deleteScene}
            />
            <GuestsRail
              participants={cohostParticipants}
              roomCode={stream.room_code}
            />
          </aside>

          {/* ── Center: Program preview + stage actions + producer deck ── */}
          <section className="xl:col-span-7 md:col-span-1 xl:order-2 order-1 flex flex-col gap-4">
            <ProgramPreview
              ref={videoRef}
              isMobile={isMobile}
              cameraFacingMode={cameraFacingMode}
              isSwitching={isSwitching}
              videoEnabled={videoEnabled}
              audioEnabled={audioEnabled}
              mediaInitialized={mediaInitialized}
              isStreaming={isStreaming}
              isDataSaver={isDataSaver}
              videoQuality={videoQuality}
              overlay={cr.overlay}
              watermarkUrl={cr.branding.watermarkUrl}
              watermarkPosition={cr.branding.watermarkPosition}
              onRotateCamera={rotateCamera}
              onToggleVideo={toggleVideo}
              onToggleAudio={toggleAudio}
              onToggleDataSaver={() => setIsDataSaver((v) => !v)}
              onChangeQuality={setVideoQuality}
            />

            <StageActions
              streamTitle={stream.title}
              roomCode={stream.room_code}
              status={stream.status}
              isStreaming={isStreaming}
              isPaused={isPaused}
              controlRoomMode={controlRoomMode}
              isHostOnAir={isHostOnAir}
              mediaInitialized={mediaInitialized}
              hasRecording={hasRecording}
              showRestart={isStreamOwner || isAdmin}
              showOpenReplay={showOpenReplay}
              replayCount={sectionRecorder.sections.length}
              onStart={handleStartStream}
              onPause={pauseStream}
              onResume={resumeStream}
              onEnd={handleEndStream}
              onRestart={handleRestartStream}
              onGoOnAir={goOnAir}
              onGoOffAir={goOffAir}
              onDownloadRecording={downloadRecording}
              onJumpToReplay={jumpToReplayTab}
              onBackToDashboard={() => router.push("/host/dashboard")}
            />

            {stream.status === "ended" && showOpenReplay && (
              <PostStreamBanner
                count={sectionRecorder.sections.length}
                onOpenReplay={jumpToReplayTab}
              />
            )}

            {/* Share-link strip */}
            <ShareLinkStrip roomCode={stream.room_code} />

            <ProducerDeck
              overlayDeck={
                <OverlayDeck
                  streamId={stream.id}
                  overlay={cr.overlay}
                  setActive={cr.setOverlayActive}
                  setMessage={cr.setOverlayMessage}
                  setBackground={cr.setOverlayBackground}
                  setImageUrl={cr.setOverlayImageUrl}
                />
              }
              tickerDeck={
                <TickerDeck
                  ticker={cr.ticker}
                  setActive={cr.setTickerActive}
                  setMessage={cr.setTickerMessage}
                  setSpeed={cr.setTickerSpeed}
                  setStyle={cr.setTickerStyle}
                />
              }
              musicDeck={
                <MusicDeck
                  streamId={stream.id}
                  innerRef={overlayMusicRef}
                  currentUrl={cr.overlayMusicUrl}
                  micTrack={mediaStream?.getAudioTracks()[0] ?? null}
                  isStreaming={isStreaming}
                  state={cr.overlayMusic}
                  onLiveAudioTrack={setLiveAudioTrack}
                  onUploaded={(url) => cr.setOverlayMusicUrl(url)}
                  onCleared={() => cr.setOverlayMusicUrl("")}
                  onStateChange={cr.setOverlayMusic}
                />
              }
              mediaDeck={
                <MediaDeck streamId={stream.id} chatChannelRef={chatChannelRef} />
              }
              brandingDeck={
                <BrandingDeck
                  streamId={stream.id}
                  plan={effectivePlan}
                  branding={cr.branding}
                  update={cr.updateBranding}
                />
              }
              healthDeck={
                <HealthDeck
                  health={health}
                  isStreaming={isStreaming}
                  viewerCount={connectedViewers}
                />
              }
            />
          </section>

          {/* ── Right rail: Comms tabs (sticky on xl) ─────────────────── */}
          <CommsTabs
            ref={replayCardRef}
            activeTab={activeTab}
            onTabChange={handleTabChange}
            unreadCount={unreadCount}
            messageCount={messages.length}
            showCameras={isStreamOwner || isAdmin}
            showReplay={REPLAY_ENABLED && isStreamOwner}
            replayCount={sectionRecorder.sections.length}
            chatPane={
              <ChatPane
                roomCode={stream.room_code}
                cohosts={cohostParticipants}
                messages={messages}
                hostDisplayName={host.display_name || "Host"}
                isRefreshing={isRefreshingChat}
                onRefresh={refreshChat}
                onSend={sendMessage}
                newMessage={newMessage}
                setNewMessage={setNewMessage}
                getNameColor={getNameColor}
                messagesEndRef={messagesEndRef}
              />
            }
            privatePane={<PrivateMessagesPanel streamId={stream.id} host={host} />}
            camerasPane={
              <DirectorPanel
                streamId={stream.id}
                roomCode={stream.room_code}
                activeParticipantId={activeParticipantId}
                onSwitch={(id, warmStream) => {
                  setActiveParticipantId(id);
                  if (warmStream) relayStream(warmStream);
                  else if (!id) relayStream(null);
                }}
              />
            }
            replayPane={
              <ReplayPanel
                recorder={sectionRecorder}
                isLive={isStreaming}
                roomCode={stream.room_code}
                streamTitle={stream.title}
                streamId={stream.id}
              />
            }
          />
        </div>
      </main>

      <PostStreamDialog
        open={postStreamOpen}
        onOpenChange={setPostStreamOpen}
        streamId={stream.id}
        streamTitle={stream.title}
        blob={postStreamBlob}
        alreadyDownloaded={postStreamDownloaded}
        onDownloadLocal={downloadRecording}
      />
    </div>
  );
}

// ── Subcomponents (small enough to live inline) ──────────────────────────

function ShareLinkStrip({ roomCode }: { roomCode: string }) {
  const link =
    typeof window !== "undefined"
      ? `${window.location.origin}/watch/${roomCode}`
      : "";
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <div className="flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2">
      <Copy className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
      <span className="text-[11px] uppercase tracking-wider text-muted-foreground shrink-0 hidden sm:inline">
        Viewer link
      </span>
      <Input
        value={link}
        readOnly
        className="font-mono text-xs h-7 border-0 bg-transparent shadow-none focus-visible:ring-0 px-1"
        onClick={(e) => (e.target as HTMLInputElement).select()}
      />
      <Button variant="ghost" size="sm" className="h-7 px-2 shrink-0" onClick={copy}>
        {copied ? "Copied!" : "Copy"}
      </Button>
    </div>
  );
}

interface ChatPaneProps {
  roomCode: string;
  cohosts: StreamParticipant[];
  messages: ChatMessage[];
  hostDisplayName: string;
  isRefreshing: boolean;
  onRefresh: () => void;
  onSend: (e: React.FormEvent) => void;
  newMessage: string;
  setNewMessage: (v: string) => void;
  getNameColor: (n: string) => string;
  messagesEndRef: React.RefObject<HTMLDivElement | null>;
}
function ChatPane({
  roomCode,
  cohosts,
  messages,
  hostDisplayName,
  isRefreshing,
  onRefresh,
  onSend,
  newMessage,
  setNewMessage,
  getNameColor,
  messagesEndRef,
}: ChatPaneProps) {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  return (
    <>
      {cohosts.length > 0 && (
        <div className="shrink-0 px-4 py-3 border-b border-border bg-muted/30">
          <div className="flex items-center gap-2 mb-2">
            <Users className="w-3.5 h-3.5 text-muted-foreground" />
            <span className="text-xs font-medium text-foreground">
              Co-hosts ({cohosts.length})
            </span>
          </div>
          <div className="flex flex-col gap-2">
            {cohosts.map((p) => {
              const name = p.host?.display_name || p.host?.email || "Unknown";
              const link = `${origin}/host/stream/${roomCode}/cohost/${p.id}`;
              return (
                <div
                  key={p.id}
                  className="flex items-center justify-between gap-2 p-2 rounded-md bg-background border border-border"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-medium truncate">{name}</span>
                      <span
                        className={`text-[10px] h-4 px-1.5 rounded ${
                          p.status === "live"
                            ? "bg-red-500 text-white"
                            : p.status === "ready"
                              ? "bg-green-500/20 text-green-700"
                              : "bg-muted text-muted-foreground"
                        }`}
                      >
                        {p.status === "live" ? "● LIVE" : p.status}
                      </span>
                    </div>
                    <span className="text-[10px] text-muted-foreground">
                      {p.slot_label}
                    </span>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2"
                    onClick={() => {
                      navigator.clipboard.writeText(link);
                      toast.success("Join link copied!");
                    }}
                  >
                    <Copy className="w-3 h-3" />
                  </Button>
                </div>
              );
            })}
          </div>
        </div>
      )}
      <div className="shrink-0 flex items-center justify-between px-4 py-2">
        <span className="text-xs text-muted-foreground">
          {messages.length} message{messages.length !== 1 ? "s" : ""}
        </span>
        <Button
          variant="ghost"
          size="sm"
          onClick={onRefresh}
          disabled={isRefreshing}
          className="h-6 w-6 p-0"
        >
          <RefreshCw className={`w-3 h-3 ${isRefreshing ? "animate-spin" : ""}`} />
        </Button>
      </div>
      <CardContent className="flex-1 min-h-0 flex flex-col p-0 overflow-hidden">
        <ScrollArea className="flex-1 min-h-0 px-4">
          <div className="flex flex-col gap-3 py-2 w-full">
            {messages.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">
                No messages yet
              </p>
            ) : (
              messages.map((msg) => {
                const isOwn = msg.sender_name === hostDisplayName;
                return (
                  <div
                    key={msg.id}
                    className={`w-full overflow-hidden flex flex-col gap-0.5 rounded-lg px-2.5 py-2 ${
                      isOwn ? "bg-primary/5 border border-primary/10" : "bg-muted/50"
                    }`}
                  >
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span
                        className={`text-xs font-semibold truncate max-w-[130px] shrink ${
                          isOwn ? "text-primary" : getNameColor(msg.sender_name)
                        }`}
                      >
                        {isOwn ? `${msg.sender_name} (you)` : msg.sender_name}
                      </span>
                      <span className="text-xs text-muted-foreground whitespace-nowrap shrink-0">
                        {new Date(msg.created_at).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                    </div>
                    <p className="text-sm text-foreground/80 [overflow-wrap:anywhere] leading-snug">
                      {msg.message}
                    </p>
                  </div>
                );
              })
            )}
            <div ref={messagesEndRef} />
          </div>
        </ScrollArea>
        <form onSubmit={onSend} className="shrink-0 p-4 border-t border-border">
          <div className="flex items-center gap-2">
            <Input
              placeholder="Send a message..."
              value={newMessage}
              onChange={(e) => setNewMessage(e.target.value)}
            />
            <Button type="submit" size="icon">
              <Send className="w-4 h-4" />
            </Button>
          </div>
        </form>
      </CardContent>
    </>
  );
}
