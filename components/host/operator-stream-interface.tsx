"use client";

/**
 * OPERATOR / CO-HOST LIVE CONTROL ROOM
 * ====================================
 *
 * The platform's super-user / per-stream operator surface. Mirrors the
 * owner's Live Control Room layout one-for-one so a host who hands the
 * keys to an operator (or a cohost helping a host) gets the same set of
 * tools, wired to the same database row and broadcast channel.
 *
 * What's reused (no fork, single source of truth):
 *
 *   - useControlRoomState .... overlay / ticker / branding / scenes /
 *                              video-clip state. Every setter writes
 *                              the streams row + .send()s the
 *                              broadcast event over the chat channel,
 *                              so the operator's edits show up on
 *                              every viewer instantly, exactly as if
 *                              the owner had clicked.
 *   - OverlayDeck, TickerDeck, MediaDeck, BrandingDeck,
 *     ScenesRail, GuestsRail, ProducerDeck, CommsTabs,
 *     ControlRoomTopbar ...... pixel-identical visuals as the owner.
 *   - DirectorPanel ........... cohost slot management (operator gets
 *                              the same camera switcher).
 *   - PrivateMessagesPanel .... back-channel chat with the host.
 *
 * What changes vs. owner:
 *
 *   1. NO useHostStream — the operator is not broadcasting. Instead
 *      they WATCH the program output via useSimpleStream, the same
 *      receiver every viewer uses. This is a deliberate split: an
 *      operator who accidentally got mounted as a broadcaster could
 *      yank tracks from the active stream. Keeping the receiver
 *      strictly read-only is a hard guarantee.
 *   2. NO StageActions — Go Live / Pause / End Stream / Restart /
 *      Recording controls only make sense on the owner's machine
 *      (rbac.STREAM_CAPS.canBroadcast = owner only). The operator
 *      sees a dedicated OperatorBadgeStrip in the same slot that
 *      explains the role + shows live status.
 *   3. NO local mic / camera flip / data-saver toggles — the
 *      operator has no local mediaStream to manipulate.
 *   4. Music deck = OperatorAudioPanel (the existing relay-command
 *      surface), not MusicDeck. Live audio mixing has to happen on
 *      the owner's WebRTC PC, so the operator queues a command and
 *      the owner's stream-interface acts on it. This was already
 *      built; we just keep using it.
 *   5. Health deck = HealthDeck with isStreaming=false, which
 *      already renders a friendly "diagnostics appear once you go
 *      live" placeholder — exactly what we want for an operator
 *      whose machine has no peer-connection visibility.
 *   6. MediaDeck.onClipActiveChange = undefined. Operators have no
 *      mic to auto-mute, so the panel skips the toggle entirely
 *      (it's an opt-in callback).
 *
 * Plan-gating:
 *   The page resolves the OWNER'S effective plan (not the operator's)
 *   so the Branding deck shows operators the same locked / unlocked
 *   cards the host themselves would see. See app/host/stream/[roomCode]/
 *   page.tsx for that resolution.
 */

import {
  useState,
  useRef,
  useEffect,
  useCallback,
  forwardRef,
  type Ref,
} from "react";
import Link from "next/link";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { useSimpleStream } from "@/lib/webrtc/simple-stream";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card, CardContent } from "@/components/ui/card";
import { OperatorAudioPanel } from "@/components/host/operator/operator-audio-panel";
import { PrivateMessagesPanel } from "@/components/stream/private-messages-panel";
import { DirectorPanel } from "@/components/host/director-panel";
import { StreamOverlay } from "@/components/stream/stream-overlay";
import { StreamTicker } from "@/components/stream/stream-ticker";
import { StreamSlideshow } from "@/components/stream/stream-slideshow";

// Control Room shared modules (single source of truth with the owner)
import { useControlRoomState } from "@/lib/control-room/use-control-room-state";
import { ControlRoomTopbar } from "@/components/host/control-room/topbar";
import { ScenesRail } from "@/components/host/control-room/scenes-rail";
import { GuestsRail } from "@/components/host/control-room/guests-rail";
import { CommsTabs } from "@/components/host/control-room/comms-tabs";
import { ProducerDeck } from "@/components/host/control-room/producer-deck";
import { OverlayDeck } from "@/components/host/control-room/decks/overlay-deck";
import { TickerDeck } from "@/components/host/control-room/decks/ticker-deck";
import { MediaDeck } from "@/components/host/control-room/decks/media-deck";
import { BrandingDeck } from "@/components/host/control-room/decks/branding-deck";
import { HealthDeck } from "@/components/host/control-room/decks/health-deck";
import type { StreamHealth } from "@/lib/webrtc/use-stream-health";
import type { StreamAccess } from "@/lib/rbac";
import type { BillingPlan } from "@/lib/billing/plans";
import {
  AlertTriangle,
  ArrowLeft,
  Copy,
  Eye,
  Lock,
  RefreshCw,
  Send,
  Shield,
  Users,
} from "lucide-react";

// ── Types ────────────────────────────────────────────────────────────────
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

interface OperatorStreamInterfaceProps {
  stream: Stream;
  host: Host;
  accessMode: StreamAccess;
  effectivePlan: BillingPlan | null;
}

// Synthetic health value the operator hands to the topbar — they have
// no peer-connection visibility so we always render the "no peers"
// state. The topbar already styles this with a neutral grey pill.
const OPERATOR_HEALTH: StreamHealth = {
  bitrateKbps: 0,
  packetLossPct: 0,
  rttMs: 0,
  iceState: "no-peers",
  status: "offline",
  sampledAt: 0,
};

// ── Component ────────────────────────────────────────────────────────────
export function OperatorStreamInterface({
  stream: initialStream,
  host,
  accessMode,
  effectivePlan,
}: OperatorStreamInterfaceProps) {
  const [stream, setStream] = useState(initialStream);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [newMessage, setNewMessage] = useState("");
  const [unreadCount, setUnreadCount] = useState(0);
  const [isRefreshingChat, setIsRefreshingChat] = useState(false);
  const [activeTab, setActiveTab] = useState("chat");
  const [activeParticipantId, setActiveParticipantId] = useState<string | null>(
    initialStream.active_participant_id ?? null,
  );
  const [cohostParticipants, setCohostParticipants] = useState<StreamParticipant[]>([]);

  // ── Clip + slideshow state mirrors ──────────────────────────────────
  // VideoClipPanel writes and broadcasts this state; we listen for it
  // on the chat channel so the operator's preview stays in sync with
  // what viewers see. Also hydrated from DB on mount so an operator
  // who joins mid-stream sees the active clip/slideshow immediately.
  const [clipState, setClipState] = useState<{
    active: boolean;
    url: string | null;
    caption: string;
  }>({ active: false, url: null, caption: "" });

  const [slideshowState, setSlideshowState] = useState<{
    active: boolean;
    url: string;
    caption: string;
  }>({ active: false, url: "", caption: "" });

  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const supabaseRef = useRef(createClient());
  const supabase = supabaseRef.current;
  // Typed against the Supabase RealtimeChannel because useControlRoomState
  // is strict about the ref shape; everything else just calls `.send()`
  // on it which is present on the channel type.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chatChannelRef = useRef<any>(null);

  const operatorDisplayName = host.display_name || "Operator";
  const isAdmin = host.is_admin === true;

  // ── Watch the program output (read-only) ─────────────────────────────
  // useSimpleStream is the same hook the public viewer uses. The operator
  // sees exactly what every viewer sees, including overlay / ticker /
  // slideshow / clip composited on top by the owner side.
  const { remoteStream, isConnected, isStreamLive } = useSimpleStream({
    streamId: stream.id,
    roomCode: stream.room_code,
  });

  // Bind the remoteStream to our local <video> + <audio>. Same pattern
  // as the public viewer: video stays muted (so autoplay is allowed),
  // audio is the user-facing sink with explicit muted state.
  useEffect(() => {
    const v = videoRef.current;
    const a = audioRef.current;
    if (!v || !a) return;
    v.muted = true;
    if (remoteStream) {
      v.srcObject = remoteStream;
      a.srcObject = remoteStream;
      v.play().catch(() => {});
      a.play().catch(() => {});
    } else {
      v.srcObject = null;
      a.srcObject = null;
    }
  }, [remoteStream]);

  // ── Control-room state (same hook as owner) ─────────────────────────
  const cr = useControlRoomState({
    streamId: stream.id,
    supabase,
    chatChannelRef,
  });

  // ── Hydrate clip + slideshow from DB on mount ─────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("streams")
        .select(
          "clip_active, clip_url, clip_caption, slideshow_active, slideshow_current_url, slideshow_current_caption",
        )
        .eq("id", stream.id)
        .single();
      if (cancelled || !data) return;
      const d = data as any;
      setClipState({
        active: !!d.clip_active,
        url: d.clip_url ?? null,
        caption: d.clip_caption ?? "",
      });
      setSlideshowState({
        active: !!d.slideshow_active,
        url: d.slideshow_current_url ?? "",
        caption: d.slideshow_current_caption ?? "",
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [stream.id, supabase]);

  // ── Stream row realtime ─────────────────────────────────────────────
  useEffect(() => {
    const ch = supabase
      .channel(`stream-status-op-${stream.id}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "streams",
          filter: `id=eq.${stream.id}`,
        },
        (payload: { new: Stream }) => {
          const updated = payload.new;
          setStream(updated);
          if ("active_participant_id" in updated) {
            setActiveParticipantId(updated.active_participant_id ?? null);
          }
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [stream.id, supabase]);

  // ── Chat channel ────────────────────────────────────────────────────
  const loadMessages = useCallback(async () => {
    const { data } = await supabase
      .from("chat_messages")
      .select("*")
      .eq("stream_id", stream.id)
      .order("created_at", { ascending: true })
      .limit(200);
    if (data) setMessages(data as ChatMessage[]);
  }, [stream.id, supabase]);

  useEffect(() => {
    const channel = supabase
      .channel(`chat-room-${stream.id}`, { config: { broadcast: { self: true } } })
      .on(
        "broadcast",
        { event: "chat-message" },
        ({ payload }: { payload: ChatMessage }) => {
          setMessages((prev) =>
            prev.some((m) => m.id === payload.id) ? prev : [...prev, payload],
          );
          if (activeTab !== "chat") setUnreadCount((c) => c + 1);
        },
      )
      // Short-video clip updates — keep the operator preview in sync.
      .on("broadcast", { event: "stream-clip" }, ({ payload }: any) => {
        if (!payload) return;
        setClipState({
          active: !!payload.active,
          url: typeof payload.url === "string" && payload.url ? payload.url : null,
          caption: typeof payload.caption === "string" ? payload.caption : "",
        });
      })
      // Slideshow updates — keep the operator preview in sync.
      .on("broadcast", { event: "stream-slideshow" }, ({ payload }: any) => {
        if (!payload) return;
        setSlideshowState({
          active: !!payload.active,
          url: typeof payload.url === "string" ? payload.url : "",
          caption: typeof payload.caption === "string" ? payload.caption : "",
        });
      })
      .subscribe((status: string) => {
        if (status === "SUBSCRIBED") loadMessages();
      });

    chatChannelRef.current = channel;
    return () => {
      supabase.removeChannel(channel);
      chatChannelRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stream.id]);

  // ── Cohort participants (for GuestsRail) ────────────────────────────
  const loadParticipants = useCallback(async () => {
    const res = await fetch(`/api/streams/participants/${stream.id}`);
    if (res.ok) {
      const { participants } = await res.json();
      setCohostParticipants(participants ?? []);
    }
  }, [stream.id]);

  useEffect(() => {
    void loadParticipants();
    const ch = supabase
      .channel(`stream-participants-op-${stream.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "stream_participants",
          filter: `stream_id=eq.${stream.id}`,
        },
        () => void loadParticipants(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [stream.id, supabase, loadParticipants]);

  // ── Auto-scroll chat ────────────────────────────────────────────────
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [messages]);

  // ── Send chat ───────────────────────────────────────────────────────
  const sendMessage = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      const text = newMessage.trim();
      if (!text) return;
      setNewMessage("");
      const senderName = `${operatorDisplayName} (operator)`;
      const { data, error } = await supabase
        .from("chat_messages")
        .insert({ stream_id: stream.id, sender_name: senderName, message: text })
        .select()
        .single();
      if (error || !data) {
        toast.error("Couldn't send message");
        setNewMessage(text);
        return;
      }
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (chatChannelRef.current as any)?.send?.({
          type: "broadcast",
          event: "chat-message",
          payload: data,
        });
      } catch {
        /* nbsp */
      }
      setMessages((prev) =>
        prev.some((m) => m.id === (data as ChatMessage).id)
          ? prev
          : [...prev, data as ChatMessage],
      );
    },
    [newMessage, operatorDisplayName, stream.id, supabase],
  );

  const refreshChat = async () => {
    setIsRefreshingChat(true);
    try {
      await loadMessages();
    } finally {
      setIsRefreshingChat(false);
    }
  };

  const getNameColor = (name: string) => {
    const colors = [
      "text-blue-400",
      "text-emerald-400",
      "text-purple-400",
      "text-orange-400",
      "text-pink-400",
      "text-cyan-400",
      "text-yellow-400",
      "text-rose-400",
      "text-indigo-400",
      "text-teal-400",
    ];
    let hash = 0;
    for (let i = 0; i < name.length; i++)
      hash = name.charCodeAt(i) + ((hash << 5) - hash);
    return colors[Math.abs(hash) % colors.length];
  };

  const handleTabChange = (v: string) => {
    setActiveTab(v);
    if (v === "chat") setUnreadCount(0);
  };

  const isStreamingNow = stream.status === "live";
  const accessLabel = accessMode === "cohost" ? "Co-host" : "Super User";

  // ── Render ──────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-background">
      <ControlRoomTopbar
        roomCode={stream.room_code}
        streamId={stream.id}
        streamTitle={stream.title}
        isStreaming={isStreamingNow}
        isPaused={false}
        isRecording={false}
        connectedViewers={stream.viewer_count ?? 0}
        totalViewers={stream.viewer_count ?? 0}
        showOperatorsDialog={isAdmin}
        health={OPERATOR_HEALTH}
      />

      <main className="container mx-auto px-4 sm:px-6 py-5 sm:py-6">
        {/* Operator-mode banner */}
        <div className="mb-4 flex items-center gap-2.5 px-3 py-2 rounded-lg bg-gradient-to-r from-purple-500/8 to-purple-500/[0.02] ring-1 ring-purple-500/20">
          <Shield className="w-3.5 h-3.5 text-purple-500 shrink-0" />
          <p className="text-[11px] text-muted-foreground leading-snug">
            <span className="font-semibold text-foreground">{accessLabel} mode</span>
            <span className="mx-1.5 text-muted-foreground/60">·</span>
            You can edit overlay, ticker, music, media, branding, scenes, and
            cohost cameras. Only the stream owner can start or end the
            broadcast.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_340px] xl:grid-cols-[280px_minmax(0,1fr)_360px] gap-5 xl:gap-6">
          {/* ── Left rail (xl): Scenes + Guests ─────────────────────── */}
          <aside className="flex flex-col gap-4 md:col-span-2 xl:col-span-1 xl:col-start-1 xl:row-start-1 order-3 xl:order-none">
            <ScenesRail
              scenes={cr.scenes}
              currentLayout={cr.branding.layout ?? "solo"}
              currentOverlay={cr.overlay}
              currentTicker={cr.ticker}
              currentMusicUrl={cr.overlayMusicUrl}
              onApply={(s) => {
                void cr.applyScene(s);
              }}
              onSave={cr.saveScene}
              onDelete={cr.deleteScene}
            />
            <GuestsRail
              participants={cohostParticipants}
              roomCode={stream.room_code}
              onInvite={() => handleTabChange("cameras")}
            />
          </aside>

          {/* ── Center: Read-only program preview + producer deck ──── */}
          <section className="flex flex-col gap-4 min-w-0 xl:col-start-2 xl:row-start-1 order-1 xl:order-none">
            {/* Program preview — operator's window onto the live output. */}
            <div className="relative w-full aspect-video rounded-xl overflow-hidden bg-black ring-1 ring-border">
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className="w-full h-full object-contain"
              />
              <audio ref={audioRef} autoPlay playsInline className="hidden" />
              {/* Re-composite the live decorations the way the viewer sees them. */}
              <StreamSlideshow
                active={slideshowState.active}
                imageUrl={slideshowState.url}
                caption={slideshowState.caption}
              />
              {/* Short-video clip — renders above the slideshow, below overlay.
                  Muted here so the clip audio doesn't play twice (viewers
                  hear it through the live feed; operator hears it via the
                  useSimpleStream <audio> element). */}
              {clipState.active && clipState.url && (
                <div
                  className="absolute inset-0 z-[25] bg-black flex items-center justify-center"
                  data-operator-clip-overlay
                >
                  <video
                    key={clipState.url}
                    src={clipState.url}
                    className="w-full h-full object-contain"
                    autoPlay
                    loop
                    muted
                    playsInline
                  />
                  {clipState.caption && (
                    <div className="absolute bottom-6 left-1/2 -translate-x-1/2 max-w-[90%] px-4 py-2 rounded-lg bg-black/70 text-white text-sm font-medium backdrop-blur text-center">
                      {clipState.caption}
                    </div>
                  )}
                  <div className="absolute top-2 right-2 inline-flex items-center gap-1 h-5 px-1.5 rounded-full text-[9px] font-semibold uppercase tracking-[0.12em] bg-emerald-500/90 text-white">
                    Clip rolling
                  </div>
                </div>
              )}
              <StreamOverlay
                active={cr.overlay.active}
                message={cr.overlay.message}
                background={cr.overlay.background}
                imageUrl={cr.overlay.imageUrl}
              />
              <div className="absolute top-2 left-2 flex items-center gap-1.5">
                <Badge className="bg-black/60 text-white backdrop-blur ring-1 ring-white/10 gap-1.5 h-6 px-2">
                  <Eye className="w-3 h-3" />
                  Watching
                </Badge>
                {isStreamingNow && !isConnected && (
                  <Badge className="bg-amber-500/80 text-white gap-1.5 h-6 px-2">
                    Connecting…
                  </Badge>
                )}
              </div>
              {!isStreamingNow && !isStreamLive && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/80 text-center text-white px-6">
                  <div>
                    <p className="text-sm font-medium">
                      Stream is {stream.status}
                    </p>
                    <p className="text-xs text-white/70 mt-1">
                      Waiting for the host to start broadcasting.
                    </p>
                  </div>
                </div>
              )}
              {/* Bottom ticker rail — same component the viewer sees. */}
              {cr.ticker.active && (
                <div className="absolute bottom-0 left-0 right-0 pointer-events-none">
                  <StreamTicker
                    active={cr.ticker.active}
                    message={cr.ticker.message}
                    speed={cr.ticker.speed}
                    style={cr.ticker.style}
                  />
                </div>
              )}
            </div>

            {/* Operator badge strip — fills the slot StageActions occupies
                on the owner. Communicates "you are NOT broadcasting" so an
                operator never expects to find a Go Live button here. */}
            <div className="rounded-xl ring-1 ring-border bg-gradient-to-br from-card to-muted/10 px-4 py-3 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <span className="w-9 h-9 rounded-lg bg-purple-500/10 ring-1 ring-purple-500/20 text-purple-500 flex items-center justify-center shrink-0">
                  <Shield className="w-4 h-4" />
                </span>
                <div className="min-w-0">
                  <p className="text-[11px] uppercase tracking-[0.14em] font-semibold text-muted-foreground">
                    {accessLabel}
                  </p>
                  <p className="text-sm font-semibold truncate">{stream.title}</p>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {isStreamingNow ? (
                  <Badge className="bg-gradient-to-r from-red-500 to-rose-600 text-white animate-pulse gap-1.5 h-6 px-2.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-white" />
                    HOST IS LIVE
                  </Badge>
                ) : (
                  <Badge variant="secondary" className="h-6 px-2.5 capitalize">
                    Stream {stream.status}
                  </Badge>
                )}
                <Button asChild variant="ghost" size="sm" className="h-7 px-2">
                  <Link href="/host/dashboard">
                    <ArrowLeft className="w-3.5 h-3.5 mr-1" />
                    Back
                  </Link>
                </Button>
              </div>
            </div>

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
                // OperatorAudioPanel is a relay-command surface: the
                // operator queues "play music X at volume Y", and the
                // owner's stream-interface listens and actually swaps
                // the audio track. This is necessary because the
                // operator has no local mic to mix with.
                <OperatorAudioPanel
                  streamId={stream.id}
                  isStreamLive={isStreamingNow}
                  operatorName={operatorDisplayName}
                  channelRef={chatChannelRef as React.MutableRefObject<unknown>}
                />
              }
              mediaDeck={
                <MediaDeck
                  streamId={stream.id}
                  chatChannelRef={
                    chatChannelRef as React.MutableRefObject<unknown>
                  }
                  // streamStatus lets the panel auto-stop a clip when
                  // the host ends the broadcast — defense against a
                  // stale clip_active=true row haunting the next session.
                  streamStatus={stream.status}
                  // Keep operator's preview in sync with the clip overlay.
                  onClipStateChange={(s) =>
                    setClipState({
                      active: s.active,
                      url: s.url,
                      caption: s.caption,
                    })
                  }
                  // No mic auto-mute callback for operator — they have
                  // no local mic. The clip's own audio plays on the
                  // viewer side; the host can choose to mute their own
                  // mic via their own Control Room if they'd like.
                />
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
                // Render the placeholder branch — operator's machine has
                // no peer-connection visibility. HealthDeck shows a
                // friendly explainer when isStreaming=false.
                <HealthDeck
                  health={OPERATOR_HEALTH}
                  isStreaming={false}
                  viewerCount={stream.viewer_count ?? 0}
                />
              }
            />
          </section>

          {/* ── Right rail: Comms tabs ─────────────────────────────── */}
          <CommsTabs
            className="xl:col-start-3 xl:row-start-1 order-2 xl:order-none"
            activeTab={activeTab}
            onTabChange={handleTabChange}
            unreadCount={unreadCount}
            messageCount={messages.length}
            showCameras={true}
            showReplay={false}
            replayCount={0}
            chatPane={
              <OperatorChatPane
                roomCode={stream.room_code}
                cohosts={cohostParticipants}
                messages={messages}
                hostDisplayName={operatorDisplayName}
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
                onSwitch={(id) => {
                  // Persist switch via API so the owner's relayStream
                  // picks it up. We don't have a local mediaStream to
                  // relay ourselves — the owner side does that.
                  void fetch(`/api/streams/${stream.id}/active-participant`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ participantId: id }),
                  }).catch(() => {
                    /* fail-soft; UI still updates locally */
                  });
                  setActiveParticipantId(id);
                }}
              />
            }
          />
        </div>
      </main>
    </div>
  );
}

// ── Subcomponents ────────────────────────────────────────────────────────

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
    <div className="flex items-center gap-2 rounded-lg ring-1 ring-border bg-muted/30 hover:bg-muted/50 transition-colors px-3 h-9">
      <Copy className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
      <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground shrink-0 hidden sm:inline">
        Viewer link
      </span>
      <Input
        value={link}
        readOnly
        className="font-mono text-[11px] h-7 border-0 bg-transparent shadow-none focus-visible:ring-0 px-1 text-foreground/80"
        onClick={(e) => (e.target as HTMLInputElement).select()}
      />
      <Button
        variant="ghost"
        size="sm"
        className="h-7 px-2 shrink-0 text-xs"
        onClick={copy}
      >
        {copied ? "Copied" : "Copy"}
      </Button>
    </div>
  );
}

interface OperatorChatPaneProps {
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
  messagesEndRef: Ref<HTMLDivElement | null>;
}

const OperatorChatPane = forwardRef<HTMLDivElement, OperatorChatPaneProps>(
  function OperatorChatPane(props) {
    const {
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
    } = props;
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
            <RefreshCw
              className={`w-3 h-3 ${isRefreshing ? "animate-spin" : ""}`}
            />
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
                  const isOwn = msg.sender_name.startsWith(hostDisplayName);
                  return (
                    <div
                      key={msg.id}
                      className={`w-full overflow-hidden flex flex-col gap-0.5 rounded-lg px-2.5 py-2 ${
                        isOwn
                          ? "bg-primary/5 border border-primary/10"
                          : "bg-muted/50"
                      }`}
                    >
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span
                          className={`text-xs font-semibold truncate max-w-[160px] shrink ${
                            isOwn ? "text-primary" : getNameColor(msg.sender_name)
                          }`}
                        >
                          {isOwn
                            ? `${msg.sender_name} (you)`
                            : msg.sender_name}
                        </span>
                        <span className="text-xs text-muted-foreground whitespace-nowrap shrink-0">
                          {new Date(msg.created_at).toLocaleTimeString([], {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                      </div>
                      <p className="text-sm text-foreground/90 break-words">
                        {msg.message}
                      </p>
                    </div>
                  );
                })
              )}
              <div ref={messagesEndRef} />
            </div>
          </ScrollArea>
          <form
            onSubmit={onSend}
            className="shrink-0 border-t border-border p-3 flex items-center gap-2"
          >
            <Input
              value={newMessage}
              onChange={(e) => setNewMessage(e.target.value)}
              placeholder="Send as operator…"
              maxLength={500}
              className="h-9"
            />
            <Button
              type="submit"
              size="icon"
              disabled={!newMessage.trim()}
              className="h-9 w-9 shrink-0"
            >
              <Send className="w-4 h-4" />
            </Button>
          </form>
        </CardContent>
      </>
    );
  },
);
