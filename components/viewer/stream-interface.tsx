"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { vibrateDevice } from "@/lib/utils/notification";
import { useSimpleStream } from "@/lib/webrtc/simple-stream";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  Minimize,
  Loader2,
  VideoOff,
  RefreshCw,
  AlertTriangle,
  WifiOff as DataSaver,
  Pause,
  ArrowLeft,
  HelpCircle,
  PictureInPicture2,
} from "lucide-react";

interface Stream {
  id: string;
  room_code: string;
  title: string;
  status: "waiting" | "live" | "ended";
  viewer_count: number;
  started_at: string | null;
  ended_at: string | null;
  active_participant_id?: string | null;
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
  const [viewerCount, setViewerCount] = useState(0);
  const presenceIdRef = useRef(`vwr-${Math.random().toString(36).substr(2, 9)}`);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [newMessage, setNewMessage] = useState("");
  const [copied, setCopied] = useState(false);
  const [showNameDialog, setShowNameDialog] = useState(true);
  const [isMuted, setIsMuted] = useState(true);
  const [retryCount, setRetryCount] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isDataSaver, setIsDataSaver] = useState(false);
  const [videoQuality, setVideoQuality] = useState<'auto' | 'high' | 'medium' | 'low'>('auto');
  const [showControls, setShowControls] = useState(true);
  const [showEmergencyDialog, setShowEmergencyDialog] = useState(false);
  const [emergencyMessage, setEmergencyMessage] = useState("");
  const [emergencySent, setEmergencySent] = useState(false);
  const [isRefreshingChat, setIsRefreshingChat] = useState(false);
  const [streamElapsed, setStreamElapsed] = useState(0);
  const [connectingSeconds, setConnectingSeconds] = useState(0);
  const [isPiP, setIsPiP] = useState(false);
  const [pipSupported, setPipSupported] = useState(false);
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);

  // Track whether the user has completed the join gesture (name dialog submitted).
  // This is the key gate for triggering play() — iOS Safari only allows audio/video
  // to start within a synchronous user-gesture call stack.
  const hasUserGestureRef = useRef(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const videoContainerRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const hasManuallyMutedRef = useRef(false);

  const supabaseRef = useRef(createClient());
  const supabase = supabaseRef.current;
  const chatChannelRef = useRef<any>(null);

  const handleStreamEnd = useCallback(() => {
    setStream((prev) => ({ ...prev, status: "ended" }));
  }, []);

  const streamHook = useSimpleStream({
    streamId: stream.id,
    roomCode: stream.room_code,
    onStreamEnd: handleStreamEnd,
  });

  const {
    isConnected,
    isStreamLive,
    remoteStream,
    error,
    hostVideoEnabled,
    connectionState,
    isStreamPaused,
  } = streamHook;

  // ─── Core play helper ────────────────────────────────────────────────────────
  // Single place that attempts playback. Call this:
  //   1. Right after the user dismisses the dialog (gesture context).
  //   2. Whenever remoteStream is assigned and the user has already gestured.
  const attemptPlay = useCallback((muted: boolean) => {
    const video = videoRef.current;
    if (!video || !video.srcObject) return;
    video.muted = muted;
    video.play().catch((err) => {
      console.log("[Viewer] play() failed:", err);
    });
  }, []);

  // ─── Handle connection errors ─────────────────────────────────────────────
  useEffect(() => {
    if (error) {
      console.log("Connection error detected:", error);
      setRetryCount((prev) => prev + 1);
    }
  }, [error]);

  // ─── Connecting timeout tracker ───────────────────────────────────────────
  useEffect(() => {
    const isStuckConnecting =
      (stream.status === "live" || isStreamLive) && !isConnected && !remoteStream;
    if (!isStuckConnecting) {
      setConnectingSeconds(0);
      return;
    }
    const id = setInterval(() => setConnectingSeconds((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [stream.status, isStreamLive, isConnected, remoteStream]);

  // Auto-reload after 60s stuck connecting
  useEffect(() => {
    if (connectingSeconds >= 60) window.location.reload();
  }, [connectingSeconds]);

  // ─── Attach remoteStream to video element ─────────────────────────────────
  // Only sets srcObject. Play is triggered separately so we never call play()
  // outside a user-gesture context on iOS.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    if (remoteStream) {
      console.log("[Viewer] Attaching remote stream:", remoteStream.id);
      video.srcObject = remoteStream;

      // If the user already gestured (dialog was dismissed before stream arrived),
      // we can safely call play() now.
      if (hasUserGestureRef.current) {
        const targetMuted = hasManuallyMutedRef.current ? true : false;
        attemptPlay(targetMuted);
      }
      // Otherwise play() will be called inside the dialog submit handler (gesture).
    } else {
      console.log("[Viewer] Clearing video stream");
      video.srcObject = null;
    }
  }, [remoteStream, attemptPlay]);

  // ─── Video element event handlers ────────────────────────────────────────
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const hideLoader = () => {
      document.getElementById("video-loading")?.classList.replace("opacity-100", "opacity-0");
    };
    const showLoader = () => {
      document.getElementById("video-loading")?.classList.replace("opacity-0", "opacity-100");
    };

    const onLoadedMetadata = () => {
      console.log("[Viewer] loadedmetadata");
      // Only play here if user has gestured — avoids autoplay policy violations.
      if (hasUserGestureRef.current) {
        attemptPlay(video.muted);
      }
    };
    const onCanPlay = () => { console.log("[Viewer] canplay"); hideLoader(); };
    const onPlaying  = () => { console.log("[Viewer] playing");  hideLoader(); };
    const onStalled  = () => { console.log("[Viewer] stalled");  showLoader(); };
    const onSuspend  = () => { console.log("[Viewer] suspend");  showLoader(); };
    const onError    = (e: Event) => { console.error("[Viewer] video error", e); hideLoader(); };

    video.addEventListener("loadedmetadata", onLoadedMetadata);
    video.addEventListener("canplay",        onCanPlay);
    video.addEventListener("playing",        onPlaying);
    video.addEventListener("stalled",        onStalled);
    video.addEventListener("suspend",        onSuspend);
    video.addEventListener("error",          onError);

    return () => {
      video.removeEventListener("loadedmetadata", onLoadedMetadata);
      video.removeEventListener("canplay",        onCanPlay);
      video.removeEventListener("playing",        onPlaying);
      video.removeEventListener("stalled",        onStalled);
      video.removeEventListener("suspend",        onSuspend);
      video.removeEventListener("error",          onError);
    };
  }, [attemptPlay]);

  // ─── Sync muted state to DOM ──────────────────────────────────────────────
  useEffect(() => {
    if (videoRef.current) videoRef.current.muted = isMuted;
  }, [isMuted]);

  const shareLink =
    typeof window !== "undefined"
      ? `${window.location.origin}/watch/${stream.room_code}`
      : "";

  // ─── Stream status subscription ──────────────────────────────────────────
  useEffect(() => {
    const channel = supabase
      .channel(`stream-${stream.id}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "streams", filter: `id=eq.${stream.id}` },
        (payload: any) => {
          const updated = payload.new as Stream;
          setStream(updated);
          if (typeof updated.viewer_count === "number" && updated.viewer_count > 0) {
            setViewerCount((prev) => Math.max(prev, updated.viewer_count));
          }
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [stream.id, supabase]);

  // ─── Real-time chat ───────────────────────────────────────────────────────
  useEffect(() => {
    const channel = supabase
      .channel(`chat-room-${stream.id}`, { config: { broadcast: { self: true } } })
      .on("broadcast", { event: "chat-message" }, ({ payload }: any) => {
        setMessages((prev) => {
          if (prev.some((m) => m.id === payload.id)) return prev;
          return [...prev, payload as ChatMessage];
        });
        vibrateDevice([60]);
      })
      .subscribe((status: string) => {
        if (status === "SUBSCRIBED") loadExistingMessages();
      });

    chatChannelRef.current = channel;

    const loadExistingMessages = async () => {
      const { data, error } = await supabase
        .from("chat_messages")
        .select("*")
        .eq("stream_id", stream.id)
        .order("created_at", { ascending: true });
      if (!error && data) setMessages(data);
    };

    return () => {
      supabase.removeChannel(channel);
      chatChannelRef.current = null;
    };
  }, [stream.id]);

  // ─── Presence-based viewer count ─────────────────────────────────────────
  useEffect(() => {
    const ch = supabase
      .channel(`presence-${stream.id}`, { config: { presence: { key: presenceIdRef.current } } })
      .on("presence", { event: "sync" },  () => setViewerCount(Object.keys(ch.presenceState()).length))
      .on("presence", { event: "join" },  () => setViewerCount(Object.keys(ch.presenceState()).length))
      .on("presence", { event: "leave" }, () => setViewerCount(Object.keys(ch.presenceState()).length))
      .subscribe(async (status: string) => {
        if (status === "SUBSCRIBED") {
          await ch.track({ id: presenceIdRef.current, joined_at: Date.now() });
        }
      });
    return () => { supabase.removeChannel(ch); };
  }, [stream.id, supabase]);

  // ─── Auto-scroll chat ─────────────────────────────────────────────────────
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // ─── Restore session from localStorage ───────────────────────────────────
  useEffect(() => {
    const savedName = typeof window !== "undefined" ? localStorage.getItem("viewerName") : null;
    if (savedName && savedName !== "Guest") {
      setViewerName(savedName);
      supabase
        .from("viewers")
        .insert({ stream_id: stream.id, name: savedName, joined_at: new Date().toISOString() })
        .then(() => {
          // Mark gesture as done — user already interacted in a previous session.
          // Note: we still can't call play() here because this runs in useEffect,
          // not a gesture. The unmute-overlay tap will trigger play() for them.
          hasUserGestureRef.current = true;
          setHasJoined(true);
          setShowNameDialog(false);
        })
        .catch(() => {
          hasUserGestureRef.current = true;
          setHasJoined(true);
          setShowNameDialog(false);
        });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── Load chat messages on mount ─────────────────────────────────────────
  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("chat_messages")
        .select("*")
        .eq("stream_id", stream.id)
        .order("created_at", { ascending: true });
      if (data && data.length > 0) setMessages(data);
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stream.id]);

  // ─── PiP support detection ────────────────────────────────────────────────
  useEffect(() => {
    const video = videoRef.current;
    const supported =
      !!document.pictureInPictureEnabled ||
      (video && typeof (video as any).webkitSetPresentationMode === "function");
    setPipSupported(!!supported);
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const onEnter = () => setIsPiP(true);
    const onLeave = () => setIsPiP(false);
    video.addEventListener("enterpictureinpicture", onEnter);
    video.addEventListener("leavepictureinpicture", onLeave);
    return () => {
      video.removeEventListener("enterpictureinpicture", onEnter);
      video.removeEventListener("leavepictureinpicture", onLeave);
    };
  }, []);

  // ─── Wake Lock ────────────────────────────────────────────────────────────
  useEffect(() => {
    const requestWakeLock = async () => {
      try {
        if ("wakeLock" in navigator)
          wakeLockRef.current = await (navigator as any).wakeLock.request("screen");
      } catch { /* not supported */ }
    };
    const releaseWakeLock = () => { wakeLockRef.current?.release(); wakeLockRef.current = null; };

    if (stream.status === "live") requestWakeLock();

    const handleVisibility = () => {
      if (document.visibilityState === "visible" && stream.status === "live") {
        requestWakeLock();
        if (videoRef.current?.paused && hasUserGestureRef.current) {
          videoRef.current.play().catch(() => {});
        }
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => { releaseWakeLock(); document.removeEventListener("visibilitychange", handleVisibility); };
  }, [stream.status]);

  // ─── Live duration timer ──────────────────────────────────────────────────
  useEffect(() => {
    if (stream.status !== "live" || !stream.started_at) return;
    const start = new Date(stream.started_at).getTime();
    const tick = () => setStreamElapsed(Math.floor((Date.now() - start) / 1000));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [stream.status, stream.started_at]);

  // ─── DB viewer_count fallback ─────────────────────────────────────────────
  useEffect(() => {
    if (stream.status !== "live") return;
    const refresh = async () => {
      const { data } = await supabase
        .from("streams").select("viewer_count").eq("id", stream.id).single();
      if (data?.viewer_count > 0)
        setViewerCount((prev) => Math.max(prev, data.viewer_count));
    };
    const id = setInterval(refresh, 10000);
    return () => clearInterval(id);
  }, [stream.id, stream.status, supabase]);

  // ─── Auto-hide controls in fullscreen ────────────────────────────────────
  useEffect(() => {
    let timeout: NodeJS.Timeout;
    if (isFullscreen) {
      const show = () => {
        setShowControls(true);
        clearTimeout(timeout);
        timeout = setTimeout(() => setShowControls(false), 3000);
      };
      document.addEventListener("mousemove",  show);
      document.addEventListener("touchstart", show);
      show();
      return () => {
        document.removeEventListener("mousemove",  show);
        document.removeEventListener("touchstart", show);
        clearTimeout(timeout);
      };
    } else {
      setShowControls(true);
    }
  }, [isFullscreen]);

  // ─── Fullscreen handling ──────────────────────────────────────────────────
  useEffect(() => {
    const onChange = () => {
      setIsFullscreen(!!(
        document.fullscreenElement ||
        (document as any).webkitFullscreenElement ||
        (document as any).mozFullScreenElement
      ));
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setIsFullscreen(false); };
    document.addEventListener("fullscreenchange",       onChange);
    document.addEventListener("webkitfullscreenchange", onChange);
    document.addEventListener("mozfullscreenchange",    onChange);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("fullscreenchange",       onChange);
      document.removeEventListener("webkitfullscreenchange", onChange);
      document.removeEventListener("mozfullscreenchange",    onChange);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  // ─── Actions ──────────────────────────────────────────────────────────────

  // KEY FIX: joinStream is called directly from a button onClick / form onSubmit,
  // so we are inside a user-gesture call stack here. We:
  //   1. Mark gesture as received.
  //   2. Unmute the video element directly (synchronously).
  //   3. Call play() synchronously — iOS Safari requires this in the same stack frame.
  const joinStream = async (name: string) => {
    if (!name.trim()) return;

    // Mark gesture received — future remoteStream arrivals can also call play().
    hasUserGestureRef.current = true;

    // Unmute & play synchronously inside the gesture (critical for iOS).
    const video = videoRef.current;
    if (video && video.srcObject) {
      video.muted = false;
      video.play().catch((err) => console.log("[Viewer] play() in join:", err));
    }
    setIsMuted(false);

    if (typeof window !== "undefined") localStorage.setItem("viewerName", name.trim());

    setViewerName(name.trim());
    setHasJoined(true);
    setShowNameDialog(false);

    try {
      const { error } = await supabase.from("viewers").insert({
        stream_id: stream.id,
        name: name.trim(),
        joined_at: new Date().toISOString(),
      });
      if (error) console.error("[Viewer] DB insert error:", error);
    } catch (err) {
      console.error("[Viewer] Exception joining:", err);
    }
  };

  const joinAsGuest = async () => {
    // Same gesture context — call joinStream synchronously.
    await joinStream("Guest");
  };

  const sendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMessage.trim() || !hasJoined) return;
    const msgText = newMessage.trim();
    setNewMessage("");
    const { data } = await supabase
      .from("chat_messages")
      .insert({ stream_id: stream.id, sender_name: viewerName, message: msgText })
      .select()
      .single();
    if (data && chatChannelRef.current) {
      chatChannelRef.current.send({ type: "broadcast", event: "chat-message", payload: data });
    }
  };

  const sendEmergencyMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!emergencyMessage.trim() || !hasJoined) return;
    try {
      await supabase.from("chat_messages").insert({
        stream_id: stream.id,
        sender_name: `SYSTEM - ${viewerName}`,
        message: `EMERGENCY: ${emergencyMessage.trim()}`,
        is_emergency: true,
      });
      setEmergencyMessage("");
      setEmergencySent(true);
      setShowEmergencyDialog(false);
      setTimeout(() => setEmergencySent(false), 5000);
    } catch (err) {
      console.error("[Viewer] Emergency message error:", err);
    }
  };

  const refreshChat = async () => {
    setIsRefreshingChat(true);
    try {
      const { data, error } = await supabase
        .from("chat_messages")
        .select("*")
        .eq("stream_id", stream.id)
        .order("created_at", { ascending: true });
      if (!error && data) setMessages(data);
    } finally {
      setIsRefreshingChat(false);
    }
  };

  const copyShareLink = () => {
    navigator.clipboard.writeText(shareLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const toggleMute = () => {
    const video = videoRef.current;
    const newMuted = !isMuted;
    hasManuallyMutedRef.current = newMuted;
    setIsMuted(newMuted);
    if (video) {
      video.muted = newMuted;
      // Calling play() inside onClick is a gesture — iOS allows unmuting here.
      if (!newMuted) video.play().catch(() => {});
    }
  };

  const toggleFullscreen = async () => {
    const video = videoRef.current;
    const container = videoContainerRef.current;
    if (!isFullscreen) {
      if (video && typeof (video as any).webkitEnterFullscreen === "function") {
        try { (video as any).webkitEnterFullscreen(); return; } catch { /* fallthrough */ }
      }
      const el = container || document.documentElement;
      try {
        if (el.requestFullscreen) await el.requestFullscreen();
        else if ((el as any).webkitRequestFullscreen) (el as any).webkitRequestFullscreen();
        else setIsFullscreen(true);
      } catch { setIsFullscreen(true); }
    } else {
      const native = !!(document.fullscreenElement || (document as any).webkitFullscreenElement);
      if (native) {
        try {
          if (document.exitFullscreen) await document.exitFullscreen();
          else if ((document as any).webkitExitFullscreen) (document as any).webkitExitFullscreen();
        } catch { setIsFullscreen(false); }
      } else {
        setIsFullscreen(false);
      }
    }
  };

  const togglePiP = async () => {
    const video = videoRef.current;
    if (!video) return;
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      } else if (typeof (video as any).webkitSetPresentationMode === "function") {
        const cur = (video as any).webkitPresentationMode;
        (video as any).webkitSetPresentationMode(
          cur === "picture-in-picture" ? "inline" : "picture-in-picture"
        );
      } else if (video.requestPictureInPicture) {
        await video.requestPictureInPicture();
      }
    } catch (err) {
      console.log("[Viewer] PiP error:", err);
    }
  };

  // ─── Helpers ──────────────────────────────────────────────────────────────
  const formatElapsed = (s: number) => {
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
    return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  };

  const getNameColor = (name: string) => {
    const colors = ["text-blue-400","text-emerald-400","text-purple-400","text-orange-400","text-pink-400","text-cyan-400","text-yellow-400","text-rose-400","text-indigo-400","text-teal-400"];
    let hash = 0;
    for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
    return colors[Math.abs(hash) % colors.length];
  };

  const formatDuration = (startedAt: string | null, endedAt: string | null) => {
    if (!startedAt) return "unknown time";
    const dur = Math.floor((new Date(endedAt ?? Date.now()).getTime() - new Date(startedAt).getTime()) / 1000);
    if (dur < 60) return `${dur} seconds`;
    if (dur < 3600) return `${Math.floor(dur / 60)} minutes`;
    return `${Math.floor(dur / 3600)}h ${Math.floor((dur % 3600) / 60)}m`;
  };

  const getConnectionStatusBadge = () => {
    if (stream.status === "ended") return null;
    if (isConnected) return (
      <Badge variant="secondary" className="gap-1"><Wifi className="w-3 h-3" />Connected</Badge>
    );
    if (connectionState === "connecting" || connectionState === "new") return (
      <Badge variant="outline" className="gap-1"><Loader2 className="w-3 h-3 animate-spin" />Connecting...</Badge>
    );
    return <Badge variant="outline" className="gap-1"><WifiOff className="w-3 h-3" />Disconnected</Badge>;
  };

  // ─── Video area overlays (video element is rendered outside this function) ───
  const getVideoContent = () => {
    if (stream.status === "ended") {
      return (
        <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-gray-900 to-gray-800">
          <div className="text-center max-w-md mx-auto px-6">
            <div className="w-20 h-20 bg-red-500/20 rounded-full flex items-center justify-center mx-auto mb-6 border-2 border-red-500">
              <Circle className="w-10 h-10 text-red-400" />
            </div>
            <h2 className="text-2xl font-bold text-white mb-3">Stream Ended</h2>
            <p className="text-gray-300 text-lg mb-6">This stream has ended. Thank you for watching!</p>
            <div className="space-y-3">
              <div className="flex items-center justify-center gap-2 text-gray-400">
                <Users className="w-4 h-4" />
                <span className="text-sm">Stream was live for {formatDuration(stream.started_at, stream.ended_at)}</span>
              </div>
              <div className="flex items-center justify-center gap-2 text-gray-400">
                <MessageCircle className="w-4 h-4" />
                <span className="text-sm">{messages.length} messages sent</span>
              </div>
            </div>
            <div className="mt-8 space-y-3">
              <Button variant="outline" className="w-full border-gray-600 text-gray-300 hover:bg-gray-800"
                onClick={() => (window.location.href = "/")}>
                <ArrowLeft className="w-4 h-4 mr-2" />Back to Home
              </Button>
              <Button className="w-full bg-red-500 hover:bg-red-600 text-white" onClick={copyShareLink}>
                <Share2 className="w-4 h-4 mr-2" />{copied ? "Link Copied!" : "Share Stream"}
              </Button>
            </div>
          </div>
        </div>
      );
    }

    if (isStreamLive && isConnected && remoteStream) {
      return (
        <div className={`relative w-full h-full ${isFullscreen ? "bg-black" : ""}`}>
          {/* Loading overlay */}
          <div className="absolute inset-0 flex items-center justify-center bg-black/50 pointer-events-none opacity-0 transition-opacity duration-300" id="video-loading">
            <div className="text-center">
              <Loader2 className="w-12 h-12 text-white animate-spin mx-auto mb-2" />
              <p className="text-white text-sm">Loading stream...</p>
            </div>
          </div>

          {/* Unmute overlay */}
          {isMuted && isConnected && remoteStream && (
            <div className="absolute inset-0 flex items-end justify-center pb-20 pointer-events-none z-10">
              <button
                className="pointer-events-auto flex items-center gap-2 bg-black/70 hover:bg-black/90 text-white text-sm font-medium px-4 py-2 rounded-full border border-white/20 backdrop-blur-sm"
                onClick={() => {
                  hasManuallyMutedRef.current = false;
                  hasUserGestureRef.current = true;
                  setIsMuted(false);
                  const video = videoRef.current;
                  if (video) { video.muted = false; video.play().catch(() => {}); }
                }}
              >
                <VolumeX className="w-4 h-4 text-red-400" />
                Tap to unmute
              </button>
            </div>
          )}

          {/* Pause overlay */}
          {isStreamPaused && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/70 pointer-events-none">
              <div className="text-center">
                <div className="w-16 h-16 bg-orange-500/20 rounded-full flex items-center justify-center mx-auto mb-4 border-2 border-orange-500">
                  <Pause className="w-8 h-8 text-orange-400" />
                </div>
                <h3 className="text-white text-xl font-semibold mb-2">Stream Paused</h3>
                <p className="text-gray-300 text-sm max-w-md">The host has paused the stream. Please wait...</p>
                <div className="mt-4 flex items-center justify-center gap-2">
                  <Loader2 className="w-4 h-4 text-orange-400 animate-spin" />
                  <span className="text-orange-400 text-sm">Will resume shortly</span>
                </div>
              </div>
            </div>
          )}

          {/* No camera overlay */}
          {!hostVideoEnabled && remoteStream?.getVideoTracks().length === 0 && (
            <div className="absolute inset-0 flex items-center justify-center bg-muted">
              <div className="text-center">
                <VideoOff className="w-16 h-16 text-muted-foreground mx-auto mb-4" />
                <p className="text-muted-foreground">Host has turned off their camera</p>
              </div>
            </div>
          )}

          {/* Controls */}
          <div className={`absolute bottom-3 sm:bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-1.5 sm:gap-2 transition-opacity duration-300 ${showControls || !isFullscreen ? "opacity-100" : "opacity-0"}`}>
            <div className="hidden sm:flex items-center bg-black/50 rounded-full px-3 py-2 gap-2">
              <Button variant="ghost" size="sm" className="text-white hover:bg-white/20 p-1"
                onClick={() => setIsDataSaver(!isDataSaver)}>
                <DataSaver className={`w-4 h-4 ${isDataSaver ? "text-orange-400" : ""}`} />
              </Button>
              <select value={videoQuality} onChange={(e) => setVideoQuality(e.target.value as any)}
                className="bg-transparent text-white text-sm border-none outline-none cursor-pointer">
                <option value="auto"   className="bg-gray-800">Auto</option>
                <option value="high"   className="bg-gray-800">1080p</option>
                <option value="medium" className="bg-gray-800">720p</option>
                <option value="low"    className="bg-gray-800">480p</option>
              </select>
            </div>

            <Button variant="secondary" size="icon" className="rounded-full bg-black/50 hover:bg-black/70 text-white" onClick={toggleMute}>
              {isMuted ? <VolumeX className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
            </Button>

            <Button variant="secondary" size="icon" className="rounded-full bg-black/50 hover:bg-black/70 text-white" onClick={toggleFullscreen}>
              {isFullscreen ? <Minimize className="w-5 h-5" /> : <Maximize className="w-5 h-5" />}
            </Button>

            {pipSupported && (
              <Button variant="secondary" size="icon"
                className={`hidden sm:inline-flex rounded-full text-white ${isPiP ? "bg-blue-500/80 hover:bg-blue-600" : "bg-black/50 hover:bg-black/70"}`}
                onClick={togglePiP} title={isPiP ? "Exit PiP" : "Pop out"}>
                <PictureInPicture2 className="w-5 h-5" />
              </Button>
            )}

            <Button variant="secondary" size="icon" className="rounded-full bg-red-500/80 hover:bg-red-600 text-white"
              onClick={() => setShowEmergencyDialog(true)} title="Report issue to host">
              <HelpCircle className="w-5 h-5" />
            </Button>
          </div>

          {/* PiP banner */}
          {isPiP && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/80 pointer-events-none">
              <div className="text-center">
                <PictureInPicture2 className="w-10 h-10 text-blue-400 mx-auto mb-3" />
                <p className="text-white font-medium">Watching in picture-in-picture</p>
              </div>
            </div>
          )}

          {isDataSaver && (
            <div className={`absolute top-2 sm:top-3 left-2 sm:left-3 transition-opacity duration-300 ${showControls || !isFullscreen ? "opacity-100" : "opacity-0"}`}>
              <Badge className="bg-orange-500/90 text-white text-[10px] sm:text-xs py-0.5 px-2">Data Saver</Badge>
            </div>
          )}

          {isFullscreen && (
            <div className="absolute inset-0 cursor-default" onClick={() => setShowControls(true)} />
          )}

          {/* Watermark */}
          {!isPiP && (
            <div className="absolute bottom-14 left-3 pointer-events-none select-none z-10">
              <div className="flex items-center gap-1.5 bg-black/25 backdrop-blur-sm rounded-full px-2.5 py-1 border border-white/10 opacity-60">
                <div className="w-4 h-4 bg-gradient-to-br from-violet-500 to-purple-700 rounded-full flex items-center justify-center shrink-0">
                  <Radio className="w-2 h-2 text-white" />
                </div>
                <span className="text-white text-[10px] font-bold tracking-[0.15em] uppercase" style={{ textShadow: "0 1px 3px rgba(0,0,0,0.7)" }}>
                  isunday
                </span>
              </div>
            </div>
          )}
        </div>
      );
    }

    // Still connecting — progressive UX
    if (stream.status === "live" || isStreamLive) {
      const isLongWait = connectingSeconds >= 15;
      const isVeryLongWait = connectingSeconds >= 45;
      return (
        <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-gray-950 to-gray-900">
          <div className="text-center max-w-sm mx-auto px-6">
            <div className={`w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-5 border-2 ${isVeryLongWait ? "bg-amber-500/20 border-amber-500" : "bg-blue-500/20 border-blue-500"}`}>
              {isVeryLongWait
                ? <Radio className="w-10 h-10 text-amber-400 animate-pulse" />
                : <Loader2 className="w-10 h-10 text-blue-400 animate-spin" />}
            </div>
            <h2 className="text-xl font-bold text-white mb-2">
              {isVeryLongWait ? "Host is reconnecting..." : isLongWait ? "Still connecting..." : "Joining the stream..."}
            </h2>
            <p className="text-gray-400 text-sm mb-4">
              {isVeryLongWait
                ? `${hostName} may have refreshed their page. We'll reconnect automatically.`
                : isLongWait
                  ? `Taking a bit longer than usual. ${hostName} might be loading.`
                  : "Please wait while we connect you to the stream."}
            </p>
            {!isVeryLongWait && (
              <div className="flex items-center justify-center gap-1.5 mb-4">
                {[0,1,2].map((i) => (
                  <span key={i} className="w-2 h-2 rounded-full bg-blue-400 animate-bounce" style={{ animationDelay: `${i * 0.15}s` }} />
                ))}
              </div>
            )}
            {isVeryLongWait && <p className="mb-4 text-xs text-gray-500">Auto-refreshing in {Math.max(0, 60 - connectingSeconds)}s...</p>}
            {error && <p className="text-xs text-red-400 mb-3">{error}</p>}
            {isLongWait && (
              <div className="flex flex-col gap-2">
                <Button size="sm" className="gap-2 bg-blue-600 hover:bg-blue-700 text-white" onClick={() => window.location.reload()}>
                  <RefreshCw className="w-4 h-4" />Refresh now
                </Button>
                <Button variant="ghost" size="sm" className="gap-2 text-gray-400 hover:text-white" onClick={() => setRetryCount(0)}>
                  Try different connection
                </Button>
              </div>
            )}
            {connectingSeconds > 5 && <p className="text-xs text-gray-600 mt-3">Waiting {connectingSeconds}s...</p>}
          </div>
        </div>
      );
    }

    // Waiting for host
    return (
      <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-gray-950 to-gray-900">
        <div className="text-center px-6">
          <div className="w-20 h-20 bg-primary/20 rounded-full flex items-center justify-center mx-auto mb-5 border-2 border-primary/50">
            <Radio className="w-10 h-10 text-primary/70 animate-pulse" />
          </div>
          <h2 className="text-xl font-bold text-white mb-2">Waiting for Host</h2>
          <p className="text-gray-400 text-sm">
            <span className="font-medium text-white">{hostName}</span> hasn't started the stream yet.
          </p>
          <p className="text-gray-500 text-xs mt-2">This page will update automatically when they go live.</p>
          <div className="flex items-center justify-center gap-1.5 mt-5">
            {[0,1,2].map((i) => (
              <span key={i} className="w-2 h-2 rounded-full bg-primary/50 animate-bounce" style={{ animationDelay: `${i * 0.2}s` }} />
            ))}
          </div>
        </div>
      </div>
    );
  };

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <>
      {/* Name Dialog */}
      <Dialog open={showNameDialog} onOpenChange={setShowNameDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Join the Stream</DialogTitle>
            <DialogDescription>Enter your name to join the chat and interact with others</DialogDescription>
          </DialogHeader>
          <form onSubmit={(e) => { e.preventDefault(); joinStream(viewerName); }}>
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <Label htmlFor="name">Your Name</Label>
                <Input
                  id="name"
                  placeholder="Enter your name"
                  value={viewerName}
                  onChange={(e) => setViewerName(e.target.value)}
                  autoComplete="name"
                />
              </div>
            </div>
            <div className="flex items-center gap-2 mt-4">
              {/* "Watch Only" is a direct click handler — keeps gesture context for play() */}
              <Button type="button" variant="outline" className="flex-1" onClick={joinAsGuest}>
                Watch Only
              </Button>
              <Button type="submit" className="flex-1" disabled={!viewerName.trim()}>
                Join Chat
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Emergency Dialog */}
      <Dialog open={showEmergencyDialog} onOpenChange={setShowEmergencyDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-red-500" />
              Report Issue to Host
            </DialogTitle>
            <DialogDescription>
              If you're experiencing technical issues or need to contact the host urgently, use this emergency message.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={sendEmergencyMessage}>
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <Label htmlFor="emergency">Describe your issue</Label>
                <textarea
                  id="emergency"
                  placeholder="e.g., Video not loading, Can't hear audio..."
                  value={emergencyMessage}
                  onChange={(e) => setEmergencyMessage(e.target.value)}
                  className="min-h-[100px] w-full p-3 border rounded-md resize-none"
                  maxLength={500}
                />
                <p className="text-xs text-muted-foreground">{emergencyMessage.length}/500 characters</p>
              </div>
            </div>
            <div className="flex items-center gap-2 mt-4">
              <Button type="button" variant="outline" className="flex-1" onClick={() => setShowEmergencyDialog(false)}>Cancel</Button>
              <Button type="submit" className="flex-1 bg-red-500 hover:bg-red-600" disabled={!emergencyMessage.trim()}>
                Send Emergency Message
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Emergency success toast */}
      {emergencySent && (
        <div className="fixed top-4 right-4 z-50 bg-green-500 text-white px-4 py-2 rounded-lg shadow-lg flex items-center gap-2">
          <AlertTriangle className="w-4 h-4" />
          Emergency message sent to host
        </div>
      )}

      <div className="min-h-screen bg-background">
        {/* Header */}
        <header className="sticky top-0 z-40 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
          <div className="container mx-auto px-4 py-2 sm:py-3 flex items-center justify-between gap-3">
            <Link href="/" className="flex items-center gap-2 shrink-0">
              <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
                <Radio className="w-4 h-4 text-primary-foreground" />
              </div>
              <span className="font-bold text-foreground hidden sm:block">Isunday Stream Live</span>
            </Link>
            <h2 className="text-sm font-medium text-foreground truncate flex-1 text-center hidden md:block">{stream.title}</h2>
            <div className="flex items-center gap-2 shrink-0">
              {stream.status === "live" && (
                <>
                  <Badge className="bg-red-500 text-white gap-1.5 px-2.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-white animate-ping" />LIVE
                  </Badge>
                  {streamElapsed > 0 && (
                    <span className="text-xs text-muted-foreground font-mono hidden sm:block tabular-nums">{formatElapsed(streamElapsed)}</span>
                  )}
                </>
              )}
              <div className="flex items-center gap-1.5 bg-red-500/10 border border-red-500/20 text-red-500 px-2.5 py-1 rounded-full">
                <Users className="w-3.5 h-3.5" />
                <span className="text-sm font-bold tabular-nums">{viewerCount}</span>
                <span className="text-xs hidden sm:inline text-red-400">watching</span>
              </div>
            </div>
          </div>
        </header>

        <main className="sm:container sm:mx-auto sm:px-4 sm:py-4 lg:py-6">
          <div className="grid lg:grid-cols-3 gap-0 lg:gap-6">
            {/* Video Area */}
            <div className="lg:col-span-2 flex flex-col gap-0 lg:gap-4">
              <div className="overflow-hidden sm:rounded-xl sm:border sm:border-border sm:shadow-sm">
                <div
                  ref={videoContainerRef}
                  className={`relative bg-black ${isFullscreen ? "fixed inset-0 z-50 w-screen h-screen" : "aspect-video w-full"}`}
                >
                  {/* Video element is rendered here ALWAYS so the ref never goes stale.
                      getVideoContent() renders overlays and states on top of it. */}
                  <video
                    ref={videoRef}
                    autoPlay
                    playsInline
                    muted={isMuted}
                    controls={false}
                    className="absolute inset-0 w-full h-full object-contain"
                    style={{ display: (isStreamLive && isConnected && remoteStream && hostVideoEnabled) ? undefined : "none" }}
                  />
                  {getVideoContent()}
                  <div className="absolute top-2 sm:top-3 right-2 sm:right-3">{getConnectionStatusBadge()}</div>
                </div>
              </div>

              {/* Stream info bar */}
              <div className="flex items-center justify-between gap-3 px-3 py-2.5 sm:px-0 sm:py-0 border-b sm:border-b-0 border-border">
                <div className="flex-1 min-w-0">
                  <h1 className="text-sm sm:text-lg font-semibold text-foreground truncate md:hidden leading-tight">{stream.title}</h1>
                  <div className="flex items-center gap-2 flex-wrap mt-0.5">
                    <p className="text-xs sm:text-sm text-muted-foreground">Hosted by <span className="font-medium text-foreground">{hostName}</span></p>
                    {stream.status === "live" && streamElapsed > 0 && (
                      <span className="flex items-center gap-1 text-xs text-muted-foreground">
                        <Clock className="w-3 h-3" />{formatElapsed(streamElapsed)}
                      </span>
                    )}
                    {stream.status === "live" && (
                      <span className="flex items-center gap-1 text-xs text-red-500 font-medium">
                        <Users className="w-3 h-3" />{viewerCount} {viewerCount === 1 ? "viewer" : "viewers"}
                      </span>
                    )}
                  </div>
                </div>
                <Button variant="ghost" size="sm" onClick={copyShareLink} className="shrink-0 h-8 px-2.5 gap-1.5 text-xs sm:text-sm">
                  <Share2 className="w-3.5 h-3.5" />{copied ? "Copied!" : "Share"}
                </Button>
              </div>
            </div>

            {/* Chat Panel */}
            <Card className="lg:col-span-1 flex flex-col h-[44vh] sm:h-[480px] lg:h-[calc(100vh-11rem)] lg:sticky lg:top-20 rounded-none sm:rounded-xl border-x-0 sm:border shadow-none sm:shadow-sm border-t">
              <CardHeader className="pb-2 pt-3 sm:pt-4 px-3 sm:px-6">
                <CardTitle className="flex items-center gap-1.5 sm:gap-2 text-sm sm:text-base">
                  <MessageCircle className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                  Live Chat
                  {messages.length > 0 && <span className="text-[11px] font-normal text-muted-foreground">({messages.length})</span>}
                  <div className="ml-auto flex items-center gap-1.5">
                    {hasJoined && viewerName !== "Guest" && (
                      <Badge variant="secondary" className="text-[10px] sm:text-xs h-5 sm:h-6 px-1.5 sm:px-2">{viewerName}</Badge>
                    )}
                    <Button variant="ghost" size="sm" onClick={refreshChat} disabled={isRefreshingChat}
                      className="h-7 w-7 p-0" title="Refresh chat">
                      <RefreshCw className={`w-3 h-3 sm:w-3.5 sm:h-3.5 ${isRefreshingChat ? "animate-spin" : ""}`} />
                    </Button>
                  </div>
                </CardTitle>
              </CardHeader>
              <CardContent className="flex-1 min-h-0 flex flex-col p-0">
                <ScrollArea className="flex-1 min-h-0 px-3 sm:px-4">
                  <div className="flex flex-col gap-1.5 sm:gap-2 py-1.5 sm:py-2 w-full">
                    {messages.length === 0
                      ? <p className="text-xs sm:text-sm text-muted-foreground text-center py-5 sm:py-8">No messages yet. Be the first!</p>
                      : messages.map((msg) => {
                          const isEmergency = msg.sender_name?.startsWith("SYSTEM -") || msg.message?.startsWith("EMERGENCY:");
                          const isOwn = msg.sender_name === viewerName;
                          return (
                            <div key={msg.id} className={`w-full overflow-hidden flex flex-col gap-0.5 rounded-lg px-2 py-1.5 ${
                              isEmergency ? "bg-red-500/10 border border-red-500/20" :
                              isOwn      ? "bg-primary/5 border border-primary/10" : "bg-muted/40"
                            }`}>
                              <div className="flex items-center gap-1.5 min-w-0">
                                <span className={`text-xs font-semibold truncate max-w-[120px] shrink ${
                                  isEmergency ? "text-red-500" : isOwn ? "text-primary" : getNameColor(msg.sender_name)
                                }`}>
                                  {isEmergency ? "🚨 Alert" : isOwn ? `${msg.sender_name} (you)` : msg.sender_name}
                                </span>
                                <span className="text-xs text-muted-foreground whitespace-nowrap shrink-0">
                                  {new Date(msg.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                                </span>
                              </div>
                              <p className={`text-sm [overflow-wrap:anywhere] leading-snug ${isEmergency ? "text-red-400 font-medium" : "text-foreground/80"}`}>
                                {isEmergency ? msg.message.replace("EMERGENCY: ", "") : msg.message}
                              </p>
                            </div>
                          );
                        })
                    }
                    <div ref={messagesEndRef} />
                  </div>
                </ScrollArea>
                <form onSubmit={sendMessage} className="shrink-0 p-2.5 sm:p-4 border-t border-border">
                  {hasJoined && viewerName !== "Guest" ? (
                    <div className="flex items-center gap-2">
                      <Input placeholder="Send a message..." value={newMessage} onChange={(e) => setNewMessage(e.target.value)} />
                      <Button type="submit" size="icon"><Send className="w-4 h-4" /></Button>
                    </div>
                  ) : (
                    <Button type="button" variant="outline" className="w-full" onClick={() => setShowNameDialog(true)}>
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
