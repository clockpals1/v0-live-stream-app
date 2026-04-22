"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
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

export function HostStreamInterface({ stream: initialStream, host }: HostStreamInterfaceProps) {
  const [stream, setStream] = useState(initialStream);
  const [isStreaming, setIsStreaming] = useState(initialStream.status === "live");
  const [videoEnabled, setVideoEnabled] = useState(true);
  const [audioEnabled, setAudioEnabled] = useState(true);
  const [copied, setCopied] = useState(false);
  const [viewerCount, setViewerCount] = useState(initialStream.viewer_count);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [newMessage, setNewMessage] = useState("");
  const [isRecording, setIsRecording] = useState(false);
  const [recordedChunks, setRecordedChunks] = useState<Blob[]>([]);

  const videoRef = useRef<HTMLVideoElement>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const supabase = createClient();

  const shareLink = typeof window !== "undefined" 
    ? `${window.location.origin}/watch/${stream.room_code}` 
    : "";

  // Initialize camera
  useEffect(() => {
    const initCamera = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "user" },
          audio: true,
        });
        mediaStreamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
      } catch (error) {
        console.error("Error accessing camera:", error);
      }
    };

    initCamera();

    return () => {
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      }
    };
  }, []);

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
        (payload) => {
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
      .then(({ data }) => {
        if (data) setMessages(data);
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [stream.id, supabase]);

  // Subscribe to viewer count updates
  useEffect(() => {
    const channel = supabase
      .channel(`viewers-${stream.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "viewers",
          filter: `stream_id=eq.${stream.id}`,
        },
        async () => {
          // Count active viewers
          const { count } = await supabase
            .from("viewers")
            .select("*", { count: "exact", head: true })
            .eq("stream_id", stream.id)
            .is("left_at", null);
          
          setViewerCount(count || 0);
          
          // Update stream viewer count
          await supabase
            .from("streams")
            .update({ viewer_count: count || 0 })
            .eq("id", stream.id);
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

  const toggleVideo = useCallback(() => {
    if (mediaStreamRef.current) {
      const videoTrack = mediaStreamRef.current.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.enabled = !videoTrack.enabled;
        setVideoEnabled(videoTrack.enabled);
      }
    }
  }, []);

  const toggleAudio = useCallback(() => {
    if (mediaStreamRef.current) {
      const audioTrack = mediaStreamRef.current.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        setAudioEnabled(audioTrack.enabled);
      }
    }
  }, []);

  const startStream = async () => {
    await supabase
      .from("streams")
      .update({ status: "live", started_at: new Date().toISOString() })
      .eq("id", stream.id);
    
    setStream({ ...stream, status: "live" });
    setIsStreaming(true);

    // Start recording
    if (mediaStreamRef.current) {
      const mediaRecorder = new MediaRecorder(mediaStreamRef.current, {
        mimeType: "video/webm;codecs=vp9",
      });
      
      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          setRecordedChunks((prev) => [...prev, event.data]);
        }
      };
      
      mediaRecorderRef.current = mediaRecorder;
      mediaRecorder.start(1000);
      setIsRecording(true);
    }
  };

  const endStream = async () => {
    // Stop recording
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }

    await supabase
      .from("streams")
      .update({ status: "ended", ended_at: new Date().toISOString() })
      .eq("id", stream.id);
    
    setStream({ ...stream, status: "ended" });
    setIsStreaming(false);
  };

  const downloadRecording = () => {
    if (recordedChunks.length === 0) return;
    
    const blob = new Blob(recordedChunks, { type: "video/webm" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${stream.title}-${stream.room_code}.webm`;
    a.click();
    URL.revokeObjectURL(url);
  };

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
              <span className="font-bold text-foreground">Isunday Stream Live</span>
            </div>
          </div>
          <div className="flex items-center gap-4">
            {isStreaming && (
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
                    className={`w-full h-full object-cover ${!videoEnabled ? "hidden" : ""}`}
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
                    >
                      {audioEnabled ? (
                        <Mic className="w-5 h-5" />
                      ) : (
                        <MicOff className="w-5 h-5" />
                      )}
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Stream Controls */}
            <div className="flex items-center justify-between gap-4">
              <div>
                <h1 className="text-xl font-semibold text-foreground">{stream.title}</h1>
                <p className="text-sm text-muted-foreground">Room: {stream.room_code}</p>
              </div>
              <div className="flex items-center gap-2">
                {stream.status === "ended" ? (
                  <>
                    {recordedChunks.length > 0 && (
                      <Button variant="outline" onClick={downloadRecording}>
                        <Download className="w-4 h-4 mr-2" />
                        Download Recording
                      </Button>
                    )}
                    <Button variant="outline" onClick={() => router.push("/host/dashboard")}>
                      Back to Dashboard
                    </Button>
                  </>
                ) : isStreaming ? (
                  <Button variant="destructive" onClick={endStream}>
                    <Square className="w-4 h-4 mr-2" />
                    End Stream
                  </Button>
                ) : (
                  <Button onClick={startStream}>
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
                  Share this link with viewers to join your stream
                </p>
              </CardContent>
            </Card>
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
                        <p className="text-sm text-muted-foreground">{msg.message}</p>
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
