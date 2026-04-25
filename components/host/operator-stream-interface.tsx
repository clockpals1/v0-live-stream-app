"use client";

/**
 * Operator / Super-User stream management view.
 *
 * This is what a user with StreamAccess === "operator" (or "cohost" falling
 * through to the main host page) sees. It intentionally does NOT instantiate
 * useHostStream — only the stream's actual owner hosts the WebRTC peer
 * connections; if two browsers both ran useHostStream, they would both
 * respond to viewer-join messages and the PCs would fight.
 *
 * Instead the operator:
 *   - Watches the live broadcast output via useSimpleStream (same as a viewer).
 *   - Edits overlay / ticker / slideshow state via the chat broadcast channel
 *     and a DB update, exactly like the owner does. Both paths work from any
 *     authenticated browser because the broadcast channel is shared.
 *   - Manages co-host assignments via the existing DirectorPanel + API route.
 *   - Sends and receives stream-scoped private messages via the new
 *     stream_private_messages table (scoped by RLS to owner/admin/operator/cohost).
 *
 * What is hidden (vs. HostStreamInterface):
 *   - Go Live / End Stream / Pause / Resume / Go On-Air buttons
 *   - Camera flip, mic mute, quality selector
 *   - Recording download (operator's machine never recorded anything)
 *   - Overlay Music PLAYBACK (the live audio track swap has to happen on the
 *     owner's PeerConnections). Operators can still upload music files that
 *     the owner can then play — that upload UI is shown read-only.
 */

import { useState, useRef, useEffect, useCallback } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { useSimpleStream } from "@/lib/webrtc/simple-stream";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DirectorPanel } from "@/components/host/director-panel";
import { StreamOverlay } from "@/components/stream/stream-overlay";
import { OverlayImageUpload } from "@/components/host/overlay-image-upload";
import { StreamTicker, type TickerSpeed, type TickerStyle } from "@/components/stream/stream-ticker";
import { SlideshowPanel } from "@/components/host/slideshow-panel";
import { PrivateMessagesPanel } from "@/components/stream/private-messages-panel";
import { OperatorAudioPanel } from "@/components/host/operator/operator-audio-panel";
import { OperatorChatPanel } from "@/components/host/operator/operator-chat-panel";
import {
  Radio,
  Users,
  Copy,
  ArrowLeft,
  Send,
  MessageCircle,
  Megaphone,
  Eye,
  EyeOff,
  Tv,
  Shield,
  Lock,
} from "lucide-react";
import type { StreamAccess } from "@/lib/rbac";

interface Stream {
  id: string;
  room_code: string;
  title: string;
  status: "waiting" | "live" | "ended";
  viewer_count: number;
  host_id: string;
  active_participant_id?: string | null;
}

interface Host {
  id: string;
  display_name: string | null;
  email: string;
  role?: string | null;
}

interface ChatMessage {
  id: string;
  sender_name: string;
  message: string;
  created_at: string;
}

interface Props {
  stream: Stream;
  host: Host;
  accessMode: StreamAccess;
}

export function OperatorStreamInterface({ stream: initialStream, host, accessMode }: Props) {
  const [stream, setStream] = useState(initialStream);
  const [copied, setCopied] = useState(false);
  const [activeParticipantId, setActiveParticipantId] = useState<string | null>(
    initialStream.active_participant_id ?? null,
  );

  // ── Overlay / Ticker state (mirror of HostStreamInterface) ────────────────
  const [overlayActive, setOverlayActive] = useState(false);
  const [overlayMessage, setOverlayMessage] = useState("");
  const [overlayBg, setOverlayBg] = useState<"dark" | "light" | "branded">("dark");
  const [overlayImageUrl, setOverlayImageUrl] = useState("");

  const [tickerActive, setTickerActive] = useState(false);
  const [tickerMessage, setTickerMessage] = useState("");
  const [tickerSpeed, setTickerSpeed] = useState<TickerSpeed>("normal");
  const [tickerStyle, setTickerStyle] = useState<TickerStyle>("default");

  // ── Chat state ────────────────────────────────────────────────────────────
  const [messages, setMessages] = useState<ChatMessage[]>([]);

  const videoRef = useRef<HTMLVideoElement>(null);
  const supabaseRef = useRef(createClient());
  const supabase = supabaseRef.current;
  const chatChannelRef = useRef<any>(null);

  // ── Watch the live broadcast — same hook the viewer uses ──────────────────
  const { remoteStream, isConnected, isStreamLive, joinStream } = useSimpleStream({
    streamId: stream.id,
    roomCode: stream.room_code,
    onStreamEnd: () => setStream((p) => ({ ...p, status: "ended" })),
  });

  useEffect(() => {
    if (!videoRef.current) return;
    videoRef.current.srcObject = remoteStream;
  }, [remoteStream]);

  // Auto-join as an invisible "operator" viewer once the component mounts.
  // We use a distinctive name prefix so the host dashboard can tell operators
  // apart from real viewers in the viewer list.
  useEffect(() => {
    const t = setTimeout(() => {
      try {
        joinStream();
      } catch (err) {
        console.warn("[operator] auto-join failed:", err);
      }
    }, 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const shareLink =
    typeof window !== "undefined" ? `${window.location.origin}/watch/${stream.room_code}` : "";

  // ── Load existing overlay / ticker state from DB ──────────────────────────
  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("streams")
        .select(
          "overlay_active, overlay_message, overlay_background, overlay_image_url, ticker_active, ticker_message, ticker_speed, ticker_style, active_participant_id",
        )
        .eq("id", stream.id)
        .single();
      if (!data) return;
      const d = data as any;
      setOverlayActive(!!d.overlay_active);
      setOverlayMessage(d.overlay_message ?? "");
      const bg = d.overlay_background;
      if (bg === "dark" || bg === "light" || bg === "branded") setOverlayBg(bg);
      setOverlayImageUrl(d.overlay_image_url ?? "");
      setTickerActive(!!d.ticker_active);
      setTickerMessage(d.ticker_message ?? "");
      const sp = d.ticker_speed;
      if (sp === "slow" || sp === "normal" || sp === "fast") setTickerSpeed(sp);
      const st = d.ticker_style;
      if (st === "default" || st === "urgent" || st === "info") setTickerStyle(st);
      setActiveParticipantId(d.active_participant_id ?? null);
    })();
  }, [stream.id, supabase]);

  // ── Chat channel + history ────────────────────────────────────────────────
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
      .on("broadcast", { event: "chat-message" }, ({ payload }: { payload: any }) => {
        const msg = payload as ChatMessage;
        setMessages((prev) => (prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]));
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

  // ── Stream status updates ─────────────────────────────────────────────────
  useEffect(() => {
    const channel = supabase
      .channel(`stream-status-operator-${stream.id}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "streams", filter: `id=eq.${stream.id}` },
        (payload: any) => {
          const updated = payload.new as Stream;
          setStream(updated);
          if ("active_participant_id" in updated) {
            setActiveParticipantId(updated.active_participant_id ?? null);
          }
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [stream.id, supabase]);

  // ── Actions ───────────────────────────────────────────────────────────────
  const pushOverlayState = useCallback(
    async (next: { active: boolean; message: string; background: typeof overlayBg; imageUrl: string }) => {
      const payload = {
        active: next.active,
        message: next.message.slice(0, 120),
        background: next.background,
        imageUrl: next.imageUrl,
      };
      try {
        chatChannelRef.current?.send({ type: "broadcast", event: "stream-overlay", payload });
      } catch (err) {
        console.error("[op] broadcast overlay failed:", err);
      }
      try {
        await supabase
          .from("streams")
          .update({
            overlay_active: payload.active,
            overlay_message: payload.message,
            overlay_background: payload.background,
            overlay_image_url: payload.imageUrl,
          })
          .eq("id", stream.id);
      } catch (err) {
        console.error("[op] persist overlay failed:", err);
      }
    },
    [overlayBg, stream.id, supabase],
  );

  const showOverlay = () => {
    const msg = overlayMessage.trim();
    if (!msg && !overlayImageUrl) {
      toast.error("Enter a message or upload an image first");
      return;
    }
    setOverlayActive(true);
    pushOverlayState({ active: true, message: msg, background: overlayBg, imageUrl: overlayImageUrl });
  };

  const hideOverlay = () => {
    setOverlayActive(false);
    pushOverlayState({ active: false, message: overlayMessage, background: overlayBg, imageUrl: overlayImageUrl });
  };

  useEffect(() => {
    if (!overlayActive) return;
    const t = setTimeout(() => {
      pushOverlayState({ active: true, message: overlayMessage, background: overlayBg, imageUrl: overlayImageUrl });
    }, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overlayMessage, overlayBg, overlayImageUrl]);

  const pushTickerState = useCallback(
    async (next: { active: boolean; message: string; speed: TickerSpeed; style: TickerStyle }) => {
      const payload = {
        active: next.active,
        message: next.message.slice(0, 280),
        speed: next.speed,
        style: next.style,
      };
      try {
        chatChannelRef.current?.send({ type: "broadcast", event: "stream-ticker", payload });
      } catch (err) {
        console.error("[op] broadcast ticker failed:", err);
      }
      try {
        await supabase
          .from("streams")
          .update({
            ticker_active: payload.active,
            ticker_message: payload.message,
            ticker_speed: payload.speed,
            ticker_style: payload.style,
          })
          .eq("id", stream.id);
      } catch (err) {
        console.error("[op] persist ticker failed:", err);
      }
    },
    [stream.id, supabase],
  );

  const startTicker = () => {
    const msg = tickerMessage.trim();
    if (!msg) {
      toast.error("Enter a ticker message first");
      return;
    }
    setTickerActive(true);
    pushTickerState({ active: true, message: msg, speed: tickerSpeed, style: tickerStyle });
  };

  const stopTicker = () => {
    setTickerActive(false);
    pushTickerState({ active: false, message: tickerMessage, speed: tickerSpeed, style: tickerStyle });
  };

  useEffect(() => {
    if (!tickerActive) return;
    const t = setTimeout(() => {
      pushTickerState({ active: true, message: tickerMessage, speed: tickerSpeed, style: tickerStyle });
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tickerMessage, tickerSpeed, tickerStyle]);

  const operatorDisplayName = host.display_name || "Operator";

  const handleChatSend = useCallback(
    async (text: string): Promise<boolean> => {
      const senderName = `${operatorDisplayName} (operator)`;
      const { data, error } = await supabase
        .from("chat_messages")
        .insert({ stream_id: stream.id, sender_name: senderName, message: text })
        .select()
        .single();
      if (error || !data) {
        console.error("[operator] chat send failed:", error);
        return false;
      }
      try {
        chatChannelRef.current?.send({
          type: "broadcast",
          event: "chat-message",
          payload: data,
        });
      } catch (err) {
        console.warn("[operator] chat broadcast failed:", err);
      }
      setMessages((prev) =>
        prev.some((m) => m.id === (data as ChatMessage).id) ? prev : [...prev, data as ChatMessage],
      );
      return true;
    },
    [operatorDisplayName, stream.id, supabase],
  );

  const copyShareLink = () => {
    navigator.clipboard.writeText(shareLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // ── Render ────────────────────────────────────────────────────────────────
  const accessBadge =
    accessMode === "cohost" ? (
      <Badge variant="outline" className="gap-1">
        <Users className="w-3 h-3" />
        Co-host
      </Badge>
    ) : (
      <Badge variant="outline" className="gap-1 border-purple-500/40 text-purple-400">
        <Shield className="w-3 h-3" />
        Super User
      </Badge>
    );

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="sm" asChild>
              <Link href="/host/dashboard">
                <ArrowLeft className="w-4 h-4 mr-2" />
                Back
              </Link>
            </Button>
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
                <Radio className="w-4 h-4 text-primary-foreground" />
              </div>
              <span className="font-bold text-foreground">Stream Operator</span>
            </div>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            {accessBadge}
            {stream.status === "live" && (
              <Badge className="bg-red-500 text-white animate-pulse">
                <Radio className="w-3 h-3 mr-1" />
                LIVE
              </Badge>
            )}
            {stream.status === "ended" && <Badge variant="secondary">ENDED</Badge>}
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Users className="w-4 h-4" />
              <span>{stream.viewer_count ?? 0} viewers</span>
            </div>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-6">
        <div className="mb-4 flex items-center gap-2 p-3 rounded-md bg-purple-500/5 border border-purple-500/20">
          <Lock className="w-4 h-4 text-purple-400 shrink-0" />
          <p className="text-xs text-muted-foreground">
            You are managing this stream as an <span className="font-medium text-foreground">operator</span>.
            You can edit overlays, ticker, slideshow, and co-host assignments. Only the stream owner can start
            or end the broadcast.
          </p>
        </div>

        <div className="grid lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 flex flex-col gap-4">
            {/* Live program preview — same output viewers see */}
            <Card className="overflow-hidden">
              <CardContent className="p-0">
                <div className="relative aspect-video bg-black">
                  <video
                    ref={videoRef}
                    autoPlay
                    playsInline
                    muted
                    className="w-full h-full object-contain"
                  />
                  <StreamOverlay
                    active={overlayActive}
                    message={overlayMessage}
                    background={overlayBg}
                    imageUrl={overlayImageUrl}
                  />
                  {stream.status !== "live" && (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/80 text-white text-sm">
                      Stream is {stream.status}. Waiting for the host to start broadcasting.
                    </div>
                  )}
                  {stream.status === "live" && !isConnected && (
                    <div className="absolute top-3 right-3">
                      <Badge variant="outline" className="bg-black/60 text-white border-white/20">
                        Connecting…
                      </Badge>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>

            <div className="flex items-center justify-between gap-4 flex-wrap">
              <div>
                <h1 className="text-xl font-semibold text-foreground">{stream.title}</h1>
                <p className="text-sm text-muted-foreground">Room: {stream.room_code}</p>
              </div>
            </div>

            {/* Share link */}
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-2">
                  <Input value={shareLink} readOnly className="font-mono text-sm" />
                  <Button variant="outline" onClick={copyShareLink}>
                    <Copy className="w-4 h-4 mr-2" />
                    {copied ? "Copied!" : "Copy"}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground mt-2">
                  Viewer link — share with audience.
                </p>
              </CardContent>
            </Card>

            {/* Overlay controls */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <Megaphone className="w-4 h-4" />
                  Stream Overlay
                  {overlayActive && (
                    <Badge className="bg-green-500 text-white text-[10px] h-5 px-1.5">LIVE ON SCREEN</Badge>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                <Input
                  placeholder="Optional text message"
                  value={overlayMessage}
                  onChange={(e) => setOverlayMessage(e.target.value.slice(0, 120))}
                  maxLength={120}
                />
                <OverlayImageUpload
                  streamId={stream.id}
                  currentUrl={overlayImageUrl}
                  onUploaded={(url) => setOverlayImageUrl(url)}
                  onCleared={() => setOverlayImageUrl("")}
                />
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs text-muted-foreground mr-1">Background:</span>
                    {(["dark", "light", "branded"] as const).map((bg) => (
                      <button
                        key={bg}
                        type="button"
                        onClick={() => setOverlayBg(bg)}
                        className={`h-7 px-2.5 rounded-md border text-xs capitalize transition-all ${
                          overlayBg === bg
                            ? "border-primary ring-2 ring-primary/30"
                            : "border-border hover:border-foreground/30"
                        }`}
                        style={{
                          background:
                            bg === "dark" ? "#111" : bg === "light" ? "#f5f5f5" : "hsl(var(--primary))",
                          color: bg === "light" ? "#111" : "#fff",
                        }}
                      >
                        {bg}
                      </button>
                    ))}
                  </div>
                  {overlayActive ? (
                    <Button size="sm" variant="destructive" onClick={hideOverlay}>
                      <EyeOff className="w-4 h-4 mr-1.5" />
                      Hide
                    </Button>
                  ) : (
                    <Button size="sm" onClick={showOverlay} disabled={!overlayMessage.trim() && !overlayImageUrl}>
                      <Eye className="w-4 h-4 mr-1.5" />
                      Show Overlay
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Ticker */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <Tv className="w-4 h-4" />
                  Stream Ticker
                  {tickerActive && (
                    <Badge className="bg-green-500 text-white text-[10px] h-5 px-1.5">SCROLLING</Badge>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                <textarea
                  placeholder="Ticker message (breaking news style)"
                  value={tickerMessage}
                  onChange={(e) => setTickerMessage(e.target.value.slice(0, 280))}
                  maxLength={280}
                  rows={2}
                  className="w-full px-3 py-2 text-sm rounded-md border border-input bg-background resize-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2 flex-wrap">
                    {(["slow", "normal", "fast"] as TickerSpeed[]).map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => setTickerSpeed(s)}
                        className={`h-7 px-2.5 rounded-md border text-xs capitalize ${
                          tickerSpeed === s ? "border-primary bg-primary/10" : "border-border"
                        }`}
                      >
                        {s}
                      </button>
                    ))}
                    {(["default", "urgent", "info"] as TickerStyle[]).map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => setTickerStyle(s)}
                        className={`h-7 px-2.5 rounded-md border text-xs capitalize ${
                          tickerStyle === s ? "border-primary bg-primary/10" : "border-border"
                        }`}
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                  {tickerActive ? (
                    <Button size="sm" variant="destructive" onClick={stopTicker}>
                      Stop
                    </Button>
                  ) : (
                    <Button size="sm" onClick={startTicker} disabled={!tickerMessage.trim()}>
                      Start Ticker
                    </Button>
                  )}
                </div>
                <StreamTicker
                  active={tickerActive}
                  message={tickerMessage}
                  speed={tickerSpeed}
                  style={tickerStyle}
                />
              </CardContent>
            </Card>

            {/* Audio / music remote control — commands relayed to owner */}
            <OperatorAudioPanel
              streamId={stream.id}
              isStreamLive={stream.status === "live"}
              operatorName={operatorDisplayName}
              channelRef={chatChannelRef}
            />

            <SlideshowPanel streamId={stream.id} chatChannelRef={chatChannelRef} />
          </div>

          {/* Side column — co-host director + chat + private messages */}
          <div className="flex flex-col gap-4">
            <DirectorPanel
              streamId={stream.id}
              roomCode={stream.room_code}
              activeParticipantId={activeParticipantId}
              onSwitch={(participantId) => setActiveParticipantId(participantId)}
            />

            <Card className="flex flex-col h-[520px]">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <MessageCircle className="w-4 h-4" />
                  Communication
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0 flex-1 flex flex-col">
                <Tabs defaultValue="pm" className="flex-1 flex flex-col">
                  <TabsList className="mx-3 mt-1 w-[calc(100%-1.5rem)] grid grid-cols-2">
                    <TabsTrigger value="pm">Private</TabsTrigger>
                    <TabsTrigger value="chat">Public Chat</TabsTrigger>
                  </TabsList>

                  <TabsContent value="pm" className="flex-1 px-3 pb-3 mt-2">
                    <PrivateMessagesPanel streamId={stream.id} host={host} />
                  </TabsContent>

                  <TabsContent value="chat" className="flex-1 px-3 pb-3 mt-2 flex flex-col">
                    <OperatorChatPanel
                      senderName={operatorDisplayName}
                      messages={messages}
                      onSend={handleChatSend}
                      onRefresh={loadMessages}
                    />
                  </TabsContent>
                </Tabs>
              </CardContent>
            </Card>
          </div>
        </div>
      </main>
    </div>
  );
}
