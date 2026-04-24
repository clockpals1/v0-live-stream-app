"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { useHostStream } from "@/lib/webrtc/use-host-stream";
import { useCohostReceiver } from "@/lib/webrtc/use-cohost-receiver";
import { playNotificationSound, vibrateDevice } from "@/lib/utils/notification";
import { MAX_VIEWERS } from "@/lib/webrtc/config";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DirectorPanel } from "@/components/host/director-panel";
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
  SwitchCamera,
  RefreshCw,
  Smartphone,
  Settings,
  Camera,
  WifiOff as DataSaver,
  Pause,
  Play,
} from "lucide-react";

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
  host?: {
    display_name: string | null;
    email: string;
  };
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
  const [cameraFacingMode, setCameraFacingMode] = useState<'user' | 'environment'>('environment');
  const [isSwitching, setIsSwitching] = useState(false);
  const [videoQuality, setVideoQuality] = useState<'auto' | 'high' | 'medium' | 'low'>('auto');
  const [isDataSaver, setIsDataSaver] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [activeParticipantId, setActiveParticipantId] = useState<string | null>(
    (initialStream as any).active_participant_id ?? null
  );
  const isStreamOwner = host.id === initialStream.host_id;

  const [isRefreshingChat, setIsRefreshingChat] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [cohostParticipants, setCohostParticipants] = useState<StreamParticipant[]>([]);

  const videoRef = useRef<HTMLVideoElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const supabaseRef = useRef(createClient());
  const supabase = supabaseRef.current;
  const activeTabRef = useRef("chat");
  const chatChannelRef = useRef<any>(null);

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
    downloadRecording,
  } = useHostStream({
    streamId: stream.id,
    roomCode: stream.room_code,
  });

  // Fallback receiver: connects to the active co-host when the warm pool hasn't
  // pre-connected yet (race condition where admin switches before warm-up finishes).
  const coHostFallbackStream = useCohostReceiver(
    isStreamOwner ? activeParticipantId : null
  );

  // Relay fallback stream when warm pool missed and receiver connects
  useEffect(() => {
    if (!isStreamOwner) return;
    if (activeParticipantId && coHostFallbackStream) {
      relayStream(coHostFallbackStream);
    } else if (!activeParticipantId) {
      relayStream(null);
    }
  }, [coHostFallbackStream, activeParticipantId, isStreamOwner, relayStream]);

  const shareLink =
    typeof window !== "undefined"
      ? `${window.location.origin}/watch/${stream.room_code}`
      : "";

  // Detect mobile device
  useEffect(() => {
    const checkMobile = () => {
      const isMobileDevice = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
      setIsMobile(isMobileDevice);
    };
    
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // Initialize camera on mount and check if stream should resume
  useEffect(() => {
    const init = async () => {
      try {
        const mediaStreamResult = await initializeMedia('environment');
        if (videoRef.current && mediaStreamResult) {
          videoRef.current.srcObject = mediaStreamResult;
        }
        setMediaInitialized(true);
        
        // Check if stream was live and should resume
        if (stream.status === 'live' && !isStreaming) {
          console.log('[Host] Stream was live, resuming automatically...');
          setTimeout(() => {
            startStream();
          }, 1000); // Give time for media to initialize
        }
      } catch (err) {
        console.error("[v0] Failed to initialize media:", err);
      }
    };

    init();
  }, [initializeMedia, stream.status, isStreaming, startStream]);

  // Update video element when media stream changes
  useEffect(() => {
    if (videoRef.current && mediaStream) {
      videoRef.current.srcObject = mediaStream;
    }
  }, [mediaStream]);

  // Real-time chat via Broadcast (reliable; no Supabase publication config needed)
  useEffect(() => {
    const hostName = host.display_name || "Host";

    const loadMessages = async () => {
      const { data } = await supabase
        .from("chat_messages")
        .select("*")
        .eq("stream_id", stream.id)
        .order("created_at", { ascending: true });
      if (data) {
        // Merge: keep any broadcast-arrived messages that aren't in DB yet
        setMessages((prev) => {
          const ids = new Set(data.map((m: ChatMessage) => m.id));
          const extras = prev.filter((m) => !ids.has(m.id));
          return [...data, ...extras].sort(
            (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
          );
        });
      }
    };

    const channel = supabase
      .channel(`chat-room-${stream.id}`, {
        config: { broadcast: { self: true } },
      })
      .on("broadcast", { event: "chat-message" }, ({ payload }: { payload: any }) => {
        const msg = payload as ChatMessage;
        setMessages((prev) => {
          if (prev.some((m) => m.id === msg.id)) return prev;
          return [...prev, msg];
        });
        // Notify host only for others' messages when chat tab is not active
        if (msg.sender_name !== hostName && activeTabRef.current !== "chat") {
          setUnreadCount((c) => c + 1);
          playNotificationSound();
          vibrateDevice();
        }
      })
      .subscribe((status) => {
        if (status === "SUBSCRIBED") loadMessages();
      });

    chatChannelRef.current = channel;

    return () => {
      supabase.removeChannel(channel);
      chatChannelRef.current = null;
    };
  }, [stream.id, host.display_name]);

  const refreshChat = async () => {
    setIsRefreshingChat(true);
    try {
      const { data } = await supabase
        .from('chat_messages')
        .select('*')
        .eq('stream_id', stream.id)
        .order('created_at', { ascending: true });
      if (data) setMessages(data);
    } finally {
      setIsRefreshingChat(false);
    }
  };

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
          const updated = payload.new as Stream;
          setStream(updated);
          if ('active_participant_id' in updated) {
            setActiveParticipantId(updated.active_participant_id ?? null);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [stream.id]);

  // Load co-host participants for this stream
  useEffect(() => {
    const loadParticipants = async () => {
      const { data } = await supabase
        .from("stream_participants")
        .select("id, slot_label, status, host_id, host:hosts(display_name, email)")
        .eq("stream_id", stream.id)
        .neq("status", "offline");
      if (data) {
        setCohostParticipants(data as StreamParticipant[]);
      }
    };
    loadParticipants();

    // Subscribe to participant status changes
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
        () => {
          loadParticipants();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [stream.id]);

  // Auto-scroll chat
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const copyShareLink = () => {
    navigator.clipboard.writeText(shareLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const rotateCamera = async () => {
    if (isSwitching) return;
    setIsSwitching(true);
    const newFacingMode = cameraFacingMode === 'user' ? 'environment' : 'user';
    setCameraFacingMode(newFacingMode);
    try {
      const newStream = await switchCamera(newFacingMode);
      if (newStream && videoRef.current) {
        videoRef.current.srcObject = newStream;
      }
    } finally {
      setIsSwitching(false);
    }
  };

  const updateVideoQuality = async () => {
    if (!mediaStream) return;
    
    const videoTrack = mediaStream.getVideoTracks()[0];
    if (!videoTrack) return;
    
    const constraints = {
      width: isDataSaver ? { ideal: 640 } : videoQuality === 'low' ? { ideal: 480 } : videoQuality === 'medium' ? { ideal: 720 } : videoQuality === 'high' ? { ideal: 1080 } : { ideal: 720 },
      height: isDataSaver ? { ideal: 360 } : videoQuality === 'low' ? { ideal: 360 } : videoQuality === 'medium' ? { ideal: 480 } : videoQuality === 'high' ? { ideal: 720 } : { ideal: 480 },
      frameRate: isDataSaver ? { ideal: 15 } : { ideal: 30 }
    };
    
    try {
      await videoTrack.applyConstraints(constraints);
    } catch (err) {
      console.log('Could not apply video constraints:', err);
    }
  };

  // Apply quality changes when settings change
  useEffect(() => {
    if (mediaInitialized) {
      updateVideoQuality();
    }
  }, [videoQuality, isDataSaver, mediaInitialized]);

  const sendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMessage.trim()) return;
    const msgText = newMessage.trim();
    setNewMessage(""); // clear immediately for responsive feel
    const { data } = await supabase
      .from("chat_messages")
      .insert({ stream_id: stream.id, sender_name: host.display_name || "Host", message: msgText })
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

  const getNameColor = (name: string) => {
    const colors = ['text-blue-400', 'text-emerald-400', 'text-purple-400', 'text-orange-400', 'text-pink-400', 'text-cyan-400', 'text-yellow-400', 'text-rose-400', 'text-indigo-400', 'text-teal-400'];
    let hash = 0;
    for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
    return colors[Math.abs(hash) % colors.length];
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
            {isStreaming && !isPaused && (
              <Badge className="bg-red-500 text-white animate-pulse">
                <Circle className="w-2 h-2 mr-1 fill-current" />
                LIVE
              </Badge>
            )}
            {isStreaming && isPaused && (
              <Badge className="bg-orange-500 text-white">
                <Pause className="w-2 h-2 mr-1" />
                PAUSED
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
                  {/* Top-left: camera mode + mobile indicator */}
                  <div className="absolute top-3 left-3 flex items-center gap-2 z-10">
                    <Badge className={`text-xs border font-medium ${
                      cameraFacingMode === 'environment'
                        ? 'bg-blue-500/80 text-white border-blue-400'
                        : 'bg-black/50 text-white border-white/20'
                    }`}>
                      <Camera className="w-3 h-3 mr-1" />
                      {cameraFacingMode === 'environment' ? 'Rear Camera' : 'Front Camera'}
                    </Badge>
                    {isMobile && (
                      <Badge variant="outline" className="text-xs bg-black/50 text-white border-white/20">
                        <Smartphone className="w-3 h-3 mr-1" />
                        Mobile
                      </Badge>
                    )}
                  </div>
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
                  {/* Bottom controls bar */}
                  <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent pt-8 pb-4 px-4">
                    <div className="flex items-end justify-center gap-4">

                      {/* Camera flip — prominent, labeled */}
                      <div className="flex flex-col items-center gap-1.5">
                        <button
                          onClick={rotateCamera}
                          disabled={!mediaInitialized || isSwitching}
                          className={`w-14 h-14 rounded-full flex items-center justify-center border-2 transition-all shadow-lg ${
                            isSwitching
                              ? 'bg-white/20 border-white/30 cursor-wait'
                              : cameraFacingMode === 'environment'
                                ? 'bg-blue-500/90 border-blue-300 hover:bg-blue-600/90'
                                : 'bg-white/20 border-white/40 hover:bg-white/30'
                          } disabled:opacity-50`}
                        >
                          {isSwitching
                            ? <RefreshCw className="w-6 h-6 text-white animate-spin" />
                            : <SwitchCamera className="w-6 h-6 text-white" />
                          }
                        </button>
                        <span className="text-white text-xs font-medium" style={{ textShadow: '0 1px 3px rgba(0,0,0,0.9)' }}>
                          {isSwitching ? 'Switching...' : cameraFacingMode === 'environment' ? 'Rear' : 'Front'}
                        </span>
                      </div>

                      {/* Video toggle */}
                      <div className="flex flex-col items-center gap-1.5">
                        <button
                          onClick={toggleVideo}
                          disabled={!mediaInitialized}
                          className={`w-14 h-14 rounded-full flex items-center justify-center border-2 transition-all shadow-lg ${
                            videoEnabled
                              ? 'bg-white/20 border-white/40 hover:bg-white/30'
                              : 'bg-red-500/90 border-red-300 hover:bg-red-600/90'
                          } disabled:opacity-50`}
                        >
                          {videoEnabled ? <Video className="w-6 h-6 text-white" /> : <VideoOff className="w-6 h-6 text-white" />}
                        </button>
                        <span className="text-white text-xs font-medium" style={{ textShadow: '0 1px 3px rgba(0,0,0,0.9)' }}>
                          {videoEnabled ? 'Camera' : 'Off'}
                        </span>
                      </div>

                      {/* Audio toggle */}
                      <div className="flex flex-col items-center gap-1.5">
                        <button
                          onClick={toggleAudio}
                          disabled={!mediaInitialized}
                          className={`w-14 h-14 rounded-full flex items-center justify-center border-2 transition-all shadow-lg ${
                            audioEnabled
                              ? 'bg-white/20 border-white/40 hover:bg-white/30'
                              : 'bg-red-500/90 border-red-300 hover:bg-red-600/90'
                          } disabled:opacity-50`}
                        >
                          {audioEnabled ? <Mic className="w-6 h-6 text-white" /> : <MicOff className="w-6 h-6 text-white" />}
                        </button>
                        <span className="text-white text-xs font-medium" style={{ textShadow: '0 1px 3px rgba(0,0,0,0.9)' }}>
                          {audioEnabled ? 'Mic' : 'Muted'}
                        </span>
                      </div>

                      {/* Quality selector */}
                      <div className="flex flex-col items-center gap-1.5">
                        <div className="h-14 flex items-center bg-black/60 rounded-full px-3 gap-1.5 border border-white/20">
                          <button
                            onClick={() => setIsDataSaver(!isDataSaver)}
                            disabled={isStreaming}
                            className="disabled:opacity-50"
                          >
                            <DataSaver className={`w-4 h-4 ${isDataSaver ? 'text-orange-400' : 'text-white'}`} />
                          </button>
                          <select
                            value={videoQuality}
                            onChange={(e) => setVideoQuality(e.target.value as any)}
                            className="bg-transparent text-white text-xs border-none outline-none cursor-pointer disabled:opacity-50"
                            disabled={isStreaming}
                          >
                            <option value="auto" className="bg-gray-800">Auto</option>
                            <option value="high" className="bg-gray-800">1080p</option>
                            <option value="medium" className="bg-gray-800">720p</option>
                            <option value="low" className="bg-gray-800">480p</option>
                          </select>
                        </div>
                        <span className="text-white text-xs font-medium" style={{ textShadow: '0 1px 3px rgba(0,0,0,0.9)' }}>Quality</span>
                      </div>

                    </div>
                  </div>

                  {/* Top-right: connection status */}
                  <div className="absolute top-3 right-3 z-10">
                    {isStreaming ? (
                      <Badge className="bg-red-500 text-white gap-1 border-0">
                        <span className="w-1.5 h-1.5 rounded-full bg-white animate-ping" />
                        LIVE
                      </Badge>
                    ) : mediaInitialized ? (
                      <Badge variant="outline" className="gap-1 bg-black/50 text-white border-white/20">
                        <CheckCircle2 className="w-3 h-3 text-green-400" />
                        Ready
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="gap-1 bg-black/50 text-white border-white/20">
                        <RefreshCw className="w-3 h-3 animate-spin" />
                        Starting...
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
                  <div className="flex items-center gap-2">
                    {isPaused ? (
                      <Button variant="default" onClick={resumeStream}>
                        <Play className="w-4 h-4 mr-2" />
                        Resume
                      </Button>
                    ) : (
                      <Button variant="outline" onClick={pauseStream}>
                        <Pause className="w-4 h-4 mr-2" />
                        Pause
                      </Button>
                    )}
                    <Button variant="destructive" onClick={handleEndStream}>
                      <Square className="w-4 h-4 mr-2" />
                      End Stream
                    </Button>
                  </div>
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

          {/* Right Sidebar: Chat + Director Panel */}
          <Card className="lg:col-span-1 flex flex-col h-[600px] overflow-hidden">
            <Tabs
              defaultValue="chat"
              className="flex flex-col h-full"
              onValueChange={(v) => {
                activeTabRef.current = v;
                if (v === "chat") setUnreadCount(0);
              }}
            >
              <div className="px-3 pt-3 pb-0 border-b border-border">
                <TabsList className="w-full">
                  <TabsTrigger value="chat" className="flex-1 text-xs gap-1">
                    <MessageCircle className="w-3.5 h-3.5" />
                    Chat
                    {unreadCount > 0 ? (
                      <span className="ml-0.5 min-w-[16px] h-4 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center px-1 leading-none">
                        {unreadCount > 9 ? "9+" : unreadCount}
                      </span>
                    ) : messages.length > 0 ? (
                      <span className="text-muted-foreground">({messages.length})</span>
                    ) : null}
                  </TabsTrigger>
                  {isStreamOwner && (
                    <TabsTrigger value="cameras" className="flex-1 text-xs gap-1">
                      <Camera className="w-3.5 h-3.5" />
                      Cameras
                    </TabsTrigger>
                  )}
                </TabsList>
              </div>

              {/* Cameras Tab — Director Panel */}
              {isStreamOwner && (
                <TabsContent value="cameras" className="flex-1 overflow-hidden mt-0 data-[state=active]:flex data-[state=active]:flex-col">
                  <DirectorPanel
                    streamId={stream.id}
                    roomCode={stream.room_code}
                    activeParticipantId={activeParticipantId}
                    onSwitch={(id, warmStream) => {
                      setActiveParticipantId(id);
                      if (warmStream) {
                        // Warm pool had it ready — instant relay
                        relayStream(warmStream);
                      } else if (!id) {
                        // Switching back to main camera
                        relayStream(null);
                      }
                      // If id set but no warmStream: useCohostReceiver fallback
                      // connects and the useEffect above relays when ready
                    }}
                  />
                </TabsContent>
              )}

              {/* Chat Tab */}
              <TabsContent value="chat" className="flex-1 min-h-0 flex flex-col mt-0 overflow-hidden data-[state=active]:flex">
                {/* Co-hosts Section */}
                {cohostParticipants.length > 0 && (
                  <div className="shrink-0 px-4 py-3 border-b border-border bg-muted/30">
                    <div className="flex items-center gap-2 mb-2">
                      <Users className="w-3.5 h-3.5 text-muted-foreground" />
                      <span className="text-xs font-medium text-foreground">Co-hosts ({cohostParticipants.length})</span>
                    </div>
                    <div className="flex flex-col gap-2">
                      {cohostParticipants.map((p) => {
                        const displayName = p.host?.display_name || p.host?.email || "Unknown";
                        const joinLink = `${typeof window !== "undefined" ? window.location.origin : ""}/host/stream/${stream.room_code}/cohost/${p.id}`;
                        return (
                          <div key={p.id} className="flex items-center justify-between gap-2 p-2 rounded-md bg-background border border-border">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-1.5">
                                <span className="text-xs font-medium truncate">{displayName}</span>
                                <Badge
                                  variant={p.status === "live" ? "default" : "secondary"}
                                  className={`text-[10px] h-4 px-1.5 ${
                                    p.status === "live" ? "bg-red-500 text-white" :
                                    p.status === "ready" ? "bg-green-500/20 text-green-700" :
                                    "bg-muted text-muted-foreground"
                                  }`}
                                >
                                  {p.status === "live" ? "● LIVE" : p.status}
                                </Badge>
                              </div>
                              <span className="text-[10px] text-muted-foreground">{p.slot_label}</span>
                            </div>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 px-2 text-[10px]"
                              onClick={() => {
                                navigator.clipboard.writeText(joinLink);
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
                  <span className="text-xs text-muted-foreground">{messages.length} message{messages.length !== 1 ? 's' : ''}</span>
                  <Button variant="ghost" size="sm" onClick={refreshChat} disabled={isRefreshingChat} className="h-6 w-6 p-0">
                    <RefreshCw className={`w-3 h-3 ${isRefreshingChat ? 'animate-spin' : ''}`} />
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
                      const isOwn = msg.sender_name === (host.display_name || "Host");
                      return (
                        <div key={msg.id} className={`w-full overflow-hidden flex flex-col gap-0.5 rounded-lg px-2.5 py-2 ${
                          isOwn ? 'bg-primary/5 border border-primary/10' : 'bg-muted/50'
                        }`}>
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span className={`text-xs font-semibold truncate max-w-[130px] shrink ${
                              isOwn ? 'text-primary' : getNameColor(msg.sender_name)
                            }`}>
                              {isOwn ? `${msg.sender_name} (you)` : msg.sender_name}
                            </span>
                            <span className="text-xs text-muted-foreground whitespace-nowrap shrink-0">
                              {new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
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
              <form onSubmit={sendMessage} className="shrink-0 p-4 border-t border-border">
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
              </TabsContent>
            </Tabs>
          </Card>
        </div>
      </main>
    </div>
  );
}
