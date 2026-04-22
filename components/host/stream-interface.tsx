"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { useHostStream } from "@/lib/webrtc/use-host-stream";
import { MAX_VIEWERS } from "@/lib/webrtc/config";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Radio,
  Video,
  VideoOff,
  Mic,
  MicOff,
  Users,
  Copy,
  ArrowLeft,
  Circle,
  Square,
  Send,
  MessageCircle,
  Download,
  CheckCircle2,
  AlertCircle,
  Wifi,
  WifiOff,
} from "lucide-react";

interface Stream {
  id: string;
  room_code: string;
  title: string;
  status: "waiting" | "live" | "ended";
  viewer_count: number;
  recording_url: string | null;
}

interface Host {
  id: string;
  display_name: string | null;
  email: string;
}

interface ChatMessage {
  id: string;
  sender_name: string;
  message: string;
  created_at: string;
}

interface HostStreamInterfaceProps {
  stream: Stream;
  host: Host;
}

export function HostStreamInterface({
  stream: initialStream,
  host,
}: HostStreamInterfaceProps) {
  const [stream, setStream] = useState(initialStream);
  const [copied, setCopied] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [newMessage, setNewMessage] = useState("");
  const [mediaInitialized, setMediaInitialized] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const supabase = createClient();

  const {
    mediaStream,
    initializeMedia,
    isStreaming,
    videoEnabled,
    audioEnabled,
    viewerCount,
    viewers,
    error,
    isRecording,
    hasRecording,
    startStream,
    stopStream,
    toggleVideo,
    toggleAudio,
    downloadRecording,
  } = useHostStream({
    streamId: stream.id,
    roomCode: stream.room_code,
  });

  const shareLink =
    typeof window !== "undefined"
      ? `${window.location.origin}/watch/${stream.room_code}`
      : "";

  // Initialize camera on mount
  useEffect(() => {
    const init = async () => {
      try {
        const stream = await initializeMedia();
        if (videoRef.current && stream) {
          videoRef.current.srcObject = stream;
        }
        setMediaInitialized(true);
      } catch (err) {
        console.error("[v0] Failed to initialize media:", err);
      }
    };

    init();
  }, [initializeMedia]);

  // Update video element when media stream changes
  useEffect(() => {
    if (videoRef.current && mediaStream) {
      videoRef.current.srcObject = mediaStream;
    }
  }, [mediaStream]);

  // Subscribe to chat messages
  useEffect(() => {
    const channel = supabase
      .channel(`chat-${stream.id}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "chat_messages",
          filter: `stream_id=eq.${stream.id}`,
        },
        (payload: any) => {
          setMessages((prev) => [...prev, payload.new as ChatMessage]);
        }
      )
      .subscribe();

    // Load existing messages
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
    };
  }, [stream.id, supabase]);

  // Subscribe to stream status changes
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
          setStream(payload.new as Stream);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [stream.id, supabase]);

  // Auto-scroll chat
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const copyShareLink = () => {
    navigator.clipboard.writeText(shareLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const sendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMessage.trim()) return;

    await supabase.from("chat_messages").insert({
      stream_id: stream.id,
      sender_name: host.display_name || "Host",
      message: newMessage.trim(),
    });

    setNewMessage("");
  };

  const handleEndStream = async () => {
    await stopStream();
    setStream((prev) => ({ ...prev, status: "ended" }));
  };

  const handleStartStream = async () => {
    await startStream();
    setStream((prev) => ({ ...prev, status: "live" }));
  };

  const connectedViewers = viewers.filter((v) => v.connected).length;

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
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
              <span className="font-bold text-foreground">
                Isunday Stream Live
              </span>
            </div>
          </div>
          <div className="flex items-center gap-4">
            {isStreaming && (
              <Badge className="bg-red-500 text-white animate-pulse">
                <Circle className="w-2 h-2 mr-1 fill-current" />
                LIVE
              </Badge>
            )}
            {isRecording && (
              <Badge variant="outline" className="text-red-500 border-red-500">
                <Circle className="w-2 h-2 mr-1 fill-red-500" />
                REC
              </Badge>
            )}
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Users className="w-4 h-4" />
              <span>
                {connectedViewers}/{viewerCount} connected
              </span>
            </div>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-6">
        {error && (
          <div className="mb-4 p-4 bg-destructive/10 border border-destructive rounded-lg flex items-center gap-2">
            <AlertCircle className="w-5 h-5 text-destructive" />
            <p className="text-sm text-destructive">{error}</p>
          </div>
        )}

        <div className="grid lg:grid-cols-3 gap-6">
          {/* Video Preview */}
          <div className="lg:col-span-2 flex flex-col gap-4">
            <Card className="overflow-hidden">
              <CardContent className="p-0">
                <div className="relative aspect-video bg-black">
                  <video
                    ref={videoRef}
                    autoPlay
                    playsInline
                    muted
                    className={`w-full h-full object-cover ${
                      !videoEnabled ? "hidden" : ""
                    }`}
                  />
                  {!videoEnabled && (
                    <div className="absolute inset-0 flex items-center justify-center bg-muted">
                      <VideoOff className="w-16 h-16 text-muted-foreground" />
                    </div>
                  )}
                  <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2 flex items-center gap-2">
                    <Button
                      variant={videoEnabled ? "secondary" : "destructive"}
                      size="icon"
                      className="rounded-full"
                      onClick={toggleVideo}
                      disabled={!mediaInitialized}
                    >
                      {videoEnabled ? (
                        <Video className="w-5 h-5" />
                      ) : (
                        <VideoOff className="w-5 h-5" />
                      )}
                    </Button>
                    <Button
                      variant={audioEnabled ? "secondary" : "destructive"}
                      size="icon"
                      className="rounded-full"
                      onClick={toggleAudio}
                      disabled={!mediaInitialized}
                    >
                      {audioEnabled ? (
                        <Mic className="w-5 h-5" />
                      ) : (
                        <MicOff className="w-5 h-5" />
                      )}
                    </Button>
                  </div>
                  {/* Connection status indicator */}
                  <div className="absolute top-4 right-4">
                    {isStreaming ? (
                      <Badge variant="secondary" className="gap-1">
                        <Wifi className="w-3 h-3" />
                        Broadcasting
                      </Badge>
                    ) : mediaInitialized ? (
                      <Badge variant="outline" className="gap-1">
                        <CheckCircle2 className="w-3 h-3 text-green-500" />
                        Ready
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="gap-1">
                        <WifiOff className="w-3 h-3" />
                        Initializing...
                      </Badge>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Stream Controls */}
            <div className="flex items-center justify-between gap-4">
              <div>
                <h1 className="text-xl font-semibold text-foreground">
                  {stream.title}
                </h1>
                <p className="text-sm text-muted-foreground">
                  Room: {stream.room_code} - Max {MAX_VIEWERS} viewers
                </p>
              </div>
              <div className="flex items-center gap-2">
                {stream.status === "ended" ? (
                  <>
                    {hasRecording && (
                      <Button variant="outline" onClick={downloadRecording}>
                        <Download className="w-4 h-4 mr-2" />
                        Download Recording
                      </Button>
                    )}
                    <Button
                      variant="outline"
                      onClick={() => router.push("/host/dashboard")}
                    >
                      Back to Dashboard
                    </Button>
                  </>
                ) : isStreaming ? (
                  <Button variant="destructive" onClick={handleEndStream}>
                    <Square className="w-4 h-4 mr-2" />
                    End Stream
                  </Button>
                ) : (
                  <Button
                    onClick={handleStartStream}
                    disabled={!mediaInitialized}
                  >
                    <Circle className="w-4 h-4 mr-2 fill-current" />
                    Go Live
                  </Button>
                )}
              </div>
            </div>

            {/* Share Link */}
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-2">
                  <Input
                    value={shareLink}
                    readOnly
                    className="font-mono text-sm"
                  />
                  <Button variant="outline" onClick={copyShareLink}>
                    <Copy className="w-4 h-4 mr-2" />
                    {copied ? "Copied!" : "Copy"}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground mt-2">
                  Share this link with viewers to join your stream (up to{" "}
                  {MAX_VIEWERS} viewers)
                </p>
              </CardContent>
            </Card>

            {/* Connected Viewers */}
            {viewers.length > 0 && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium flex items-center gap-2">
                    <Users className="w-4 h-4" />
                    Connected Viewers ({connectedViewers})
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex flex-wrap gap-2">
                    {viewers.map((viewer) => (
                      <Badge
                        key={viewer.id}
                        variant={viewer.connected ? "default" : "outline"}
                        className="gap-1"
                      >
                        {viewer.connected ? (
                          <Wifi className="w-3 h-3" />
                        ) : (
                          <WifiOff className="w-3 h-3" />
                        )}
                        {viewer.name}
                      </Badge>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}
          </div>

          {/* Chat Panel */}
          <Card className="lg:col-span-1 flex flex-col h-[600px]">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <MessageCircle className="w-4 h-4" />
                Live Chat
              </CardTitle>
            </CardHeader>
            <CardContent className="flex-1 flex flex-col p-0">
              <ScrollArea className="flex-1 px-4">
                <div className="flex flex-col gap-3 py-2">
                  {messages.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-8">
                      No messages yet
                    </p>
                  ) : (
                    messages.map((msg) => (
                      <div key={msg.id} className="flex flex-col gap-1">
                        <div className="flex items-baseline gap-2">
                          <span className="text-sm font-medium text-foreground">
                            {msg.sender_name}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {new Date(msg.created_at).toLocaleTimeString()}
                          </span>
                        </div>
                        <p className="text-sm text-muted-foreground">
                          {msg.message}
                        </p>
                      </div>
                    ))
                  )}
                  <div ref={messagesEndRef} />
                </div>
              </ScrollArea>
              <form onSubmit={sendMessage} className="p-4 border-t border-border">
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
          </Card>
        </div>
      </main>
    </div>
  );
}
