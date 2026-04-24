"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { useCohostStream } from "@/lib/webrtc/use-cohost-stream";
import { playNotificationSound, vibrateDevice } from "@/lib/utils/notification";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Radio,
  Video,
  VideoOff,
  Mic,
  MicOff,
  Users,
  ArrowLeft,
  Circle,
  Square,
  SwitchCamera,
  Wifi,
  WifiOff,
  RefreshCw,
  MessageCircle,
  Send,
  AlertCircle,
} from "lucide-react";

interface Participant {
  id: string;
  slot_label: string;
  status: string;
  stream_id: string;
}

interface Stream {
  id: string;
  room_code: string;
  title: string;
  status: string;
}

interface ChatMessage {
  id: string;
  sender_name: string;
  message: string;
  created_at: string;
}

interface CohostStreamInterfaceProps {
  participant: Participant;
  stream: Stream;
  displayName: string;
}

export function CohostStreamInterface({ participant, stream, displayName }: CohostStreamInterfaceProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [mediaInitialized, setMediaInitialized] = useState(false);
  const [cameraFacingMode, setCameraFacingMode] = useState<"user" | "environment">("environment");
  const [isSwitching, setIsSwitching] = useState(false);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [newMessage, setNewMessage] = useState("");
  const [unreadCount, setUnreadCount] = useState(0);
  const [chatOpen, setChatOpen] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const supabaseRef = useRef(createClient());
  const supabase = supabaseRef.current;
  const chatChannelRef = useRef<any>(null);

  const {
    mediaStream,
    initializeMedia,
    isCameraLost,
    isStreaming,
    videoEnabled,
    audioEnabled,
    viewerCount,
    error,
    startStream,
    stopStream,
    toggleVideo,
    toggleAudio,
    switchCamera,
  } = useCohostStream({
    participantId: participant.id,
    streamId: stream.id,
  });

  // Initialize camera on mount
  useEffect(() => {
    const init = async () => {
      try {
        const s = await initializeMedia("environment");
        if (videoRef.current && s) videoRef.current.srcObject = s;
        setMediaInitialized(true);
      } catch {
        // error state handled in hook
      }
    };
    init();
  }, [initializeMedia]);

  // Keep video element in sync whenever stream reference changes
  useEffect(() => {
    if (videoRef.current && mediaStream) videoRef.current.srcObject = mediaStream;
  }, [mediaStream]);

  // When camera is lost, reflect that in local initialized state
  useEffect(() => {
    if (isCameraLost) setMediaInitialized(false);
  }, [isCameraLost]);

  // Re-initialize camera (used for both camera-lost recovery and reconnect)
  const reconnectCamera = useCallback(async () => {
    try {
      const s = await initializeMedia(cameraFacingMode);
      if (s && videoRef.current) videoRef.current.srcObject = s;
      setMediaInitialized(true);
    } catch {
      // error state handled in hook
    }
  }, [initializeMedia, cameraFacingMode]);

  // Chat: subscribe to Broadcast channel shared with host and viewers
  useEffect(() => {
    const channel = supabase
      .channel(`chat-room-${stream.id}`, { config: { broadcast: { self: true } } })
      .on("broadcast", { event: "chat-message" }, ({ payload }: any) => {
        const msg = payload as ChatMessage;
        setMessages((prev) => {
          if (prev.some((m) => m.id === msg.id)) return prev;
          return [...prev, msg];
        });
        if (msg.sender_name !== displayName) {
          setUnreadCount((c) => c + 1);
          playNotificationSound();
          vibrateDevice();
        }
      })
      .subscribe();
    chatChannelRef.current = channel;
    supabase
      .from("chat_messages")
      .select("*")
      .eq("stream_id", stream.id)
      .order("created_at", { ascending: true })
      .then(({ data }: { data: ChatMessage[] | null }) => {
        if (data) setMessages(data);
      });
    return () => {
      supabase.removeChannel(channel);
      chatChannelRef.current = null;
    };
  }, [stream.id, displayName]);

  // Auto-scroll when new messages arrive and chat is open
  useEffect(() => {
    if (chatOpen) messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [messages, chatOpen]);

  const sendChatMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMessage.trim()) return;
    const msgText = newMessage.trim();
    setNewMessage("");
    const { data } = await supabase
      .from("chat_messages")
      .insert({ stream_id: stream.id, sender_name: displayName, message: msgText })
      .select()
      .single();
    if (data && chatChannelRef.current) {
      chatChannelRef.current.send({ type: "broadcast", event: "chat-message", payload: data });
    }
  };

  const rotateCamera = async () => {
    if (isSwitching) return;
    setIsSwitching(true);
    const next = cameraFacingMode === "environment" ? "user" : "environment";
    setCameraFacingMode(next);
    // switchCamera now returns a brand-new MediaStream ref so the useEffect above
    // handles srcObject update automatically via the mediaStream dep
    await switchCamera(next);
    setIsSwitching(false);
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <header className="border-b border-border px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/host/dashboard">
            <Button variant="ghost" size="sm">
              <ArrowLeft className="w-4 h-4 mr-1" /> Back
            </Button>
          </Link>
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 bg-primary rounded-md flex items-center justify-center">
              <Radio className="w-3.5 h-3.5 text-primary-foreground" />
            </div>
            <span className="font-semibold text-sm">{stream.title}</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge className="bg-purple-500 text-white text-xs">Co-hosting</Badge>
          <Badge variant="outline" className="text-xs">{participant.slot_label}</Badge>
          {isStreaming ? (
            <Badge className="bg-red-500 text-white text-xs animate-pulse">● LIVE</Badge>
          ) : mediaInitialized ? (
            <Badge variant="secondary" className="text-xs">Camera Ready</Badge>
          ) : (
            <Badge variant="secondary" className="text-xs">Starting…</Badge>
          )}
        </div>
      </header>

      <main className="flex-1 flex flex-col items-center justify-start p-4 pb-6 gap-4">
        {/* Camera Preview */}
        <div className="relative w-full max-w-lg aspect-video bg-black rounded-xl overflow-hidden shadow-lg">
          <video
            ref={videoRef}
            autoPlay
            muted
            playsInline
            className="w-full h-full object-cover"
          />
          {!mediaInitialized && !isCameraLost && (
            <div className="absolute inset-0 flex items-center justify-center text-white/60 text-sm">
              Starting camera…
            </div>
          )}
          {isCameraLost && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80 gap-3">
              <WifiOff className="w-8 h-8 text-red-400" />
              <p className="text-white text-sm font-medium">Camera disconnected</p>
              <Button size="sm" onClick={reconnectCamera} className="gap-2">
                <RefreshCw className="w-4 h-4" /> Reconnect Camera
              </Button>
            </div>
          )}
          {isStreaming && (
            <div className="absolute top-3 left-3">
              <Badge className="bg-red-600/90 text-white text-xs px-2 py-1 animate-pulse">● LIVE</Badge>
            </div>
          )}
          {viewerCount > 0 && (
            <div className="absolute top-3 right-3">
              <Badge className="bg-black/60 text-white text-xs px-2 py-1">
                <Users className="w-3 h-3 mr-1 inline" />{viewerCount}
              </Badge>
            </div>
          )}
        </div>

        {/* Info card */}
        <Card className="w-full max-w-lg">
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Broadcasting as <span className="text-foreground">{displayName}</span> · {participant.slot_label}
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <p className="text-xs text-muted-foreground mb-4">
              {isStreaming
                ? "You are live. The admin controls when viewers see your feed."
                : "Start your camera below. Admin will switch viewers to your feed when ready."}
            </p>

            {error && (
              <div className="mb-3 p-3 bg-destructive/10 border border-destructive/20 rounded-lg">
                <div className="flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-destructive mb-2">{error}</p>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={reconnectCamera}
                      className="h-7 text-xs gap-1.5"
                    >
                      <RefreshCw className="w-3 h-3" />
                      Retry Camera Access
                    </Button>
                  </div>
                </div>
              </div>
            )}

            {/* Controls */}
            <div className="flex flex-wrap gap-2 justify-center">
              {!isStreaming ? (
                <Button
                  onClick={startStream}
                  disabled={!mediaInitialized}
                  className="bg-red-600 hover:bg-red-700 text-white gap-2"
                >
                  <Circle className="w-4 h-4 fill-current" />
                  Start Broadcasting
                </Button>
              ) : (
                <Button variant="destructive" onClick={stopStream} className="gap-2">
                  <Square className="w-4 h-4" />
                  Stop Broadcasting
                </Button>
              )}

              <Button variant="outline" size="icon" onClick={toggleVideo} disabled={!mediaInitialized} title="Toggle camera">
                {videoEnabled ? <Video className="w-4 h-4" /> : <VideoOff className="w-4 h-4" />}
              </Button>
              <Button variant="outline" size="icon" onClick={toggleAudio} disabled={!mediaInitialized} title="Toggle mic">
                {audioEnabled ? <Mic className="w-4 h-4" /> : <MicOff className="w-4 h-4" />}
              </Button>
              <Button variant="outline" size="icon" onClick={rotateCamera} disabled={isSwitching || !mediaInitialized} title="Flip camera">
                <SwitchCamera className={`w-4 h-4 ${isSwitching ? "animate-spin" : ""}`} />
              </Button>
              {isCameraLost && (
                <Button variant="outline" size="sm" onClick={reconnectCamera} className="gap-1 text-xs">
                  <RefreshCw className="w-3 h-3" /> Reconnect
                </Button>
              )}
            </div>

            {isStreaming && (
              <div className="mt-3 flex items-center justify-center gap-2 text-xs text-muted-foreground">
                <Wifi className="w-3 h-3 text-green-500" />
                Broadcasting on isolated channel · {viewerCount} watching your feed
              </div>
            )}
          </CardContent>
        </Card>
        {/* Chat Panel */}
        <Card className="w-full max-w-lg">
          <CardHeader className="pb-2 pt-3 px-4">
            <button
              type="button"
              onClick={() => { setChatOpen((o) => !o); setUnreadCount(0); }}
              className="flex items-center justify-between w-full"
            >
              <CardTitle className="text-sm flex items-center gap-2">
                <MessageCircle className="w-4 h-4" />
                Live Chat
                {unreadCount > 0 && (
                  <span className="ml-1 min-w-[18px] h-[18px] bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center px-1 leading-none">
                    {unreadCount > 9 ? "9+" : unreadCount}
                  </span>
                )}
                {unreadCount === 0 && messages.length > 0 && (
                  <span className="text-xs text-muted-foreground font-normal">({messages.length})</span>
                )}
              </CardTitle>
              <span className="text-xs text-muted-foreground">{chatOpen ? "▲ Hide" : "▼ Show"}</span>
            </button>
          </CardHeader>
          {chatOpen && (
            <CardContent className="px-4 pb-4 pt-0">
              <ScrollArea className="h-52 w-full">
                <div className="flex flex-col gap-2 pr-2 w-full overflow-x-hidden">
                  {messages.length === 0 ? (
                    <p className="text-xs text-muted-foreground text-center py-6">No messages yet</p>
                  ) : (
                    messages.map((msg) => {
                      const isOwn = msg.sender_name === displayName;
                      return (
                        <div key={msg.id} className={`w-full overflow-hidden flex flex-col gap-0.5 rounded-md px-2 py-1.5 ${
                          isOwn ? 'bg-primary/5 border border-primary/10' : 'bg-muted/50'
                        }`}>
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span className={`text-xs font-semibold truncate max-w-[130px] shrink ${
                              isOwn ? 'text-primary' : 'text-foreground'
                            }`}>
                              {isOwn ? "you" : msg.sender_name}
                            </span>
                            <span className="text-xs text-muted-foreground whitespace-nowrap shrink-0">
                              {new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </span>
                          </div>
                          <p className="text-xs text-foreground/80 [overflow-wrap:anywhere] leading-snug">{msg.message}</p>
                        </div>
                      );
                    })
                  )}
                  <div ref={messagesEndRef} />
                </div>
              </ScrollArea>
              <form onSubmit={sendChatMessage} className="shrink-0 flex items-center gap-2 mt-3 pt-3 border-t border-border">
                <Input
                  placeholder="Message viewers..."
                  value={newMessage}
                  onChange={(e) => setNewMessage(e.target.value)}
                  className="h-8 text-sm"
                />
                <Button type="submit" size="icon" className="h-8 w-8 flex-shrink-0">
                  <Send className="w-3.5 h-3.5" />
                </Button>
              </form>
            </CardContent>
          )}
        </Card>
      </main>
    </div>
  );
}
