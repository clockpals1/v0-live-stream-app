"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { useViewerStream } from "@/lib/webrtc/use-viewer-stream";
import { useSimpleStream } from "@/lib/webrtc/simple-stream";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Radio,
  Users,
  Circle,
  Send,
  MessageCircle,
  Clock,
  Share2,
  Wifi,
  WifiOff,
  Volume2,
  VolumeX,
  Maximize,
  Loader2,
  VideoOff,
  RefreshCw,
  AlertTriangle,
} from "lucide-react";

interface Stream {
  id: string;
  room_code: string;
  title: string;
  status: "waiting" | "live" | "ended";
  viewer_count: number;
  started_at: string | null;
  ended_at: string | null;
}

interface ChatMessage {
  id: string;
  sender_name: string;
  message: string;
  created_at: string;
}

interface ViewerStreamInterfaceProps {
  stream: Stream;
  hostName: string;
}

export function ViewerStreamInterface({
  stream: initialStream,
  hostName,
}: ViewerStreamInterfaceProps) {
  const [stream, setStream] = useState(initialStream);
  const [viewerName, setViewerName] = useState("");
  const [hasJoined, setHasJoined] = useState(false);
  const [viewerCount, setViewerCount] = useState(initialStream.viewer_count);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [newMessage, setNewMessage] = useState("");
  const [copied, setCopied] = useState(false);
  const [showNameDialog, setShowNameDialog] = useState(true);
  const [isMuted, setIsMuted] = useState(false);
  const [useFallback, setUseFallback] = useState(false);
  const [retryCount, setRetryCount] = useState(0);

  const videoRef = useRef<HTMLVideoElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const supabase = createClient();

  const handleStreamEnd = useCallback(() => {
    setStream((prev) => ({ ...prev, status: "ended" }));
  }, []);

  const streamHook = useFallback 
    ? useSimpleStream({
        streamId: stream.id,
        roomCode: stream.room_code,
        viewerName: hasJoined ? viewerName : "",
        onStreamEnd: handleStreamEnd,
      })
    : useViewerStream({
        streamId: stream.id,
        roomCode: stream.room_code,
        viewerName: hasJoined ? viewerName : "",
        onStreamEnd: handleStreamEnd,
      });

  const {
    isConnected,
    isStreamLive,
    remoteStream,
    error,
    hostVideoEnabled,
    connectionState,
  } = streamHook;

  // Auto-switch to fallback if connection fails repeatedly
  useEffect(() => {
    if (error && !useFallback && retryCount >= 2) {
      console.log("Switching to fallback streaming method");
      setUseFallback(true);
      setRetryCount(0);
    }
    if (error) {
      setRetryCount(prev => prev + 1);
    }
  }, [error, useFallback, retryCount]);

  const shareLink =
    typeof window !== "undefined"
      ? `${window.location.origin}/watch/${stream.room_code}`
      : "";

  // Update video element when remote stream changes
  useEffect(() => {
    if (videoRef.current && remoteStream) {
      videoRef.current.srcObject = remoteStream;
    }
  }, [remoteStream]);

  // Handle mute/unmute
  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.muted = isMuted;
    }
  }, [isMuted]);

  // Subscribe to stream status changes
  useEffect(() => {
    const channel = supabase
      .channel(`stream-${stream.id}`)
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

  // Subscribe to chat messages
  useEffect(() => {
    const channel = supabase
      .channel(`chat-viewer-${stream.id}`)
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

  // Subscribe to viewer count
  useEffect(() => {
    const channel = supabase
      .channel(`viewers-watch-${stream.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "viewers",
          filter: `stream_id=eq.${stream.id}`,
        },
        async () => {
          const { count } = await supabase
            .from("viewers")
            .select("*", { count: "exact", head: true })
            .eq("stream_id", stream.id)
            .is("left_at", null);

          setViewerCount(count || 0);
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

  const joinStream = () => {
    if (!viewerName.trim()) return;
    setHasJoined(true);
    setShowNameDialog(false);
  };

  const sendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMessage.trim() || !hasJoined) return;

    await supabase.from("chat_messages").insert({
      stream_id: stream.id,
      sender_name: viewerName,
      message: newMessage.trim(),
    });

    setNewMessage("");
  };

  const copyShareLink = () => {
    navigator.clipboard.writeText(shareLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const toggleFullscreen = () => {
    if (videoRef.current) {
      if (document.fullscreenElement) {
        document.exitFullscreen();
      } else {
        videoRef.current.requestFullscreen();
      }
    }
  };

  const getConnectionStatusBadge = () => {
    if (stream.status === "ended") {
      return null;
    }

    if (isConnected) {
      return (
        <Badge variant="secondary" className="gap-1">
          <Wifi className="w-3 h-3" />
          Connected {useFallback && "(Fallback)"}
        </Badge>
      );
    }

    if (connectionState === "connecting" || connectionState === "new") {
      return (
        <Badge variant="outline" className="gap-1">
          <Loader2 className="w-3 h-3 animate-spin" />
          Connecting...
        </Badge>
      );
    }

    return (
      <Badge variant="outline" className="gap-1">
        <WifiOff className="w-3 h-3" />
        Disconnected
      </Badge>
    );
  };

  const handleRetry = () => {
    setRetryCount(0);
    setUseFallback(!useFallback);
  };

  const getVideoContent = () => {
    // Stream ended
    if (stream.status === "ended") {
      return (
        <div className="absolute inset-0 flex items-center justify-center bg-muted">
          <div className="text-center">
            <Clock className="w-16 h-16 text-muted-foreground mx-auto mb-4" />
            <h2 className="text-xl font-semibold text-foreground mb-2">
              Stream Ended
            </h2>
            <p className="text-muted-foreground">
              This stream has ended. Thank you for watching!
            </p>
          </div>
        </div>
      );
    }

    // Stream is live and connected with video
    if (isStreamLive && isConnected && remoteStream) {
      return (
        <>
          <video
            ref={videoRef}
            autoPlay
            playsInline
            className={`w-full h-full object-cover ${
              !hostVideoEnabled ? "hidden" : ""
            }`}
          />
          {!hostVideoEnabled && (
            <div className="absolute inset-0 flex items-center justify-center bg-muted">
              <div className="text-center">
                <VideoOff className="w-16 h-16 text-muted-foreground mx-auto mb-4" />
                <p className="text-muted-foreground">
                  Host has turned off their camera
                </p>
              </div>
            </div>
          )}
          {/* Video controls */}
          <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2 flex items-center gap-2">
            <Button
              variant="secondary"
              size="icon"
              className="rounded-full bg-black/50 hover:bg-black/70"
              onClick={() => setIsMuted(!isMuted)}
            >
              {isMuted ? (
                <VolumeX className="w-5 h-5 text-white" />
              ) : (
                <Volume2 className="w-5 h-5 text-white" />
              )}
            </Button>
            <Button
              variant="secondary"
              size="icon"
              className="rounded-full bg-black/50 hover:bg-black/70"
              onClick={toggleFullscreen}
            >
              <Maximize className="w-5 h-5 text-white" />
            </Button>
          </div>
        </>
      );
    }

    // Stream is live but still connecting
    if (stream.status === "live" || isStreamLive) {
      return (
        <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-primary/20 to-primary/5">
          <div className="text-center">
            <div className="w-24 h-24 bg-primary/20 rounded-full flex items-center justify-center mx-auto mb-4">
              {isConnected ? (
                <Radio className="w-12 h-12 text-primary animate-pulse" />
              ) : (
                <Loader2 className="w-12 h-12 text-primary animate-spin" />
              )}
            </div>
            <h2 className="text-2xl font-bold text-foreground mb-2">
              {isConnected ? "Stream is Live!" : "Connecting to Stream..."}
            </h2>
            <p className="text-muted-foreground">
              {isConnected
                ? `${hostName} is broadcasting`
                : "Please wait while we connect you"}
            </p>
            {error && (
              <div className="mt-4 space-y-2">
                <p className="text-sm text-destructive">{error}</p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleRetry}
                  className="gap-2"
                >
                  <RefreshCw className="w-4 h-4" />
                  Try {useFallback ? "Standard" : "Fallback"} Connection
                </Button>
              </div>
            )}
          </div>
        </div>
      );
    }

    // Waiting for host
    return (
      <div className="absolute inset-0 flex items-center justify-center bg-muted">
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-foreground mb-2">
            Waiting for Host
          </h2>
          <p className="text-muted-foreground">
            {hostName} will start the stream soon
          </p>
        </div>
      </div>
    );
  };

  return (
    <>
      <Dialog open={showNameDialog} onOpenChange={setShowNameDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Join the Stream</DialogTitle>
            <DialogDescription>
              Enter your name to join the chat and interact with others
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              joinStream();
            }}
            className="flex flex-col gap-4"
          >
            <Input
              placeholder="Your name"
              value={viewerName}
              onChange={(e) => setViewerName(e.target.value)}
              autoFocus
            />
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                className="flex-1"
                onClick={() => {
                  setViewerName("Guest");
                  setHasJoined(true);
                  setShowNameDialog(false);
                }}
              >
                Watch Only
              </Button>
              <Button
                type="submit"
                className="flex-1"
                disabled={!viewerName.trim()}
              >
                Join Chat
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <div className="min-h-screen bg-background">
        <header className="border-b border-border">
          <div className="container mx-auto px-4 py-4 flex items-center justify-between">
            <Link href="/" className="flex items-center gap-2">
              <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
                <Radio className="w-4 h-4 text-primary-foreground" />
              </div>
              <span className="font-bold text-foreground">
                Isunday Stream Live
              </span>
            </Link>
            <div className="flex items-center gap-4">
              {stream.status === "live" && (
                <Badge className="bg-red-500 text-white animate-pulse">
                  <Circle className="w-2 h-2 mr-1 fill-current" />
                  LIVE
                </Badge>
              )}
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Users className="w-4 h-4" />
                <span>{viewerCount} watching</span>
              </div>
            </div>
          </div>
        </header>

        <main className="container mx-auto px-4 py-6">
          <div className="grid lg:grid-cols-3 gap-6">
            {/* Video Area */}
            <div className="lg:col-span-2 flex flex-col gap-4">
              <Card className="overflow-hidden">
                <CardContent className="p-0">
                  <div className="relative aspect-video bg-black">
                    {getVideoContent()}
                    {/* Connection status */}
                    <div className="absolute top-4 right-4">
                      {getConnectionStatusBadge()}
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Stream Info */}
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h1 className="text-xl font-semibold text-foreground">
                    {stream.title}
                  </h1>
                  <p className="text-sm text-muted-foreground">
                    Hosted by {hostName}
                  </p>
                </div>
                <Button variant="outline" size="sm" onClick={copyShareLink}>
                  {copied ? (
                    "Copied!"
                  ) : (
                    <>
                      <Share2 className="w-4 h-4 mr-2" />
                      Share
                    </>
                  )}
                </Button>
              </div>
            </div>

            {/* Chat Panel */}
            <Card className="lg:col-span-1 flex flex-col h-[500px] lg:h-[600px]">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <MessageCircle className="w-4 h-4" />
                  Live Chat
                  {hasJoined && viewerName !== "Guest" && (
                    <Badge variant="secondary" className="ml-auto text-xs">
                      {viewerName}
                    </Badge>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent className="flex-1 flex flex-col p-0">
                <ScrollArea className="flex-1 px-4">
                  <div className="flex flex-col gap-3 py-2">
                    {messages.length === 0 ? (
                      <p className="text-sm text-muted-foreground text-center py-8">
                        No messages yet. Be the first to say something!
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
                <form
                  onSubmit={sendMessage}
                  className="p-4 border-t border-border"
                >
                  {hasJoined && viewerName !== "Guest" ? (
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
                  ) : (
                    <Button
                      type="button"
                      variant="outline"
                      className="w-full"
                      onClick={() => setShowNameDialog(true)}
                    >
                      Join to chat
                    </Button>
                  )}
                </form>
              </CardContent>
            </Card>
          </div>
        </main>
      </div>
    </>
  );
}
