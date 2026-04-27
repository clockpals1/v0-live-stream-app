"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { vibrateDevice } from "@/lib/utils/notification";
import { useSimpleStream } from "@/lib/webrtc/simple-stream";
import { useViewportHeight } from "@/lib/hooks/use-viewport-height";
import { StreamOverlay, type OverlayBackground } from "@/components/stream/stream-overlay";
import { StreamTicker, type TickerSpeed, type TickerStyle } from "@/components/stream/stream-ticker";
import { StreamSlideshow } from "@/components/stream/stream-slideshow";
import { InsiderCircleSubscribe } from "@/components/viewer/insider-circle-subscribe";
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
  Expand,
  Shrink,
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
  host_id?: string | null;
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
  // True when we attached a remote stream but the browser refused autoplay
  // with sound (typical on refresh / late-join with no user gesture yet).
  // When true, the prominent "Tap to enable audio" prompt is rendered and a
  // single click/tap recovers playback.
  const [audioBlocked, setAudioBlocked] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  // Video fit mode: 'contain' (letterbox, never crops) vs 'cover' (fills container,
  // crops edges). Mobile viewers often prefer 'cover' in portrait; default to
  // 'contain' so nothing is ever hidden by default.
  const [fitMode, setFitMode] = useState<"contain" | "cover">("contain");
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

  // ---- Host-controlled overlay (announcements / break screens) ----
  const [overlay, setOverlay] = useState<{
    active: boolean;
    message: string;
    background: OverlayBackground;
    imageUrl: string;
  }>({ active: false, message: "", background: "dark", imageUrl: "" });

  // ---- Host-controlled ticker (scrolling crawl below the video) ----
  const [ticker, setTicker] = useState<{
    active: boolean;
    message: string;
    speed: TickerSpeed;
    style: TickerStyle;
  }>({ active: false, message: "", speed: "normal", style: "default" });

  // ---- Host-controlled image slideshow (overlays the video when active) ----
  const [slideshow, setSlideshow] = useState<{
    active: boolean;
    url: string;
    caption: string;
  }>({ active: false, url: "", caption: "" });

  // Track whether the user has completed the join gesture (name dialog submitted).
  // This is the key gate for triggering play() — iOS Safari only allows audio/video
  // to start within a synchronous user-gesture call stack.
  const hasUserGestureRef = useRef(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  // Dedicated audio sink. The <video> element is permanently muted so
  // muted-autoplay is always allowed (universally permitted by browsers).
  // The <audio> element below carries sound and is the one whose `muted`
  // attribute reflects React `isMuted` state. Decoupling them prevents the
  // common WebRTC bug where audio silently dies after srcObject churn during
  // ICE recovery — the audio element survives video-element re-binds.
  const audioRef = useRef<HTMLAudioElement>(null);
  const videoContainerRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const hasManuallyMutedRef = useRef(false);

  // Keep --app-vh CSS var in sync with the real visible viewport so our
  // fullscreen container renders correctly during URL-bar collapse, keyboard
  // open/close, and orientation change on mobile.
  useViewportHeight("--app-vh");

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
    isUsingTurn,
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

  // ─── Stuck-connecting fallback: poll streams.status from the DB ──────────
  // Belt-and-braces for the post-stream-end flow. The primary signals are:
  //   1. supabase realtime UPDATE on the streams row, and
  //   2. the host's `stream-end` broadcast on the signaling channel.
  // Either is sufficient to flip stream.status='ended' locally. But both can
  // miss in rare cases: realtime publication misconfig, client channel drop,
  // host-tab closed mid-broadcast, etc. Without a fallback the viewer would
  // sit on the "Joining the stream..." spinner forever.
  //
  // Polling every 8s only WHILE we're in the stuck-connecting state means
  // the cost is bounded (zero polling for a happy live session, zero polling
  // once the ended screen is shown).
  useEffect(() => {
    const isStuckConnecting =
      (stream.status === "live" || isStreamLive) && !isConnected && !remoteStream;
    if (!isStuckConnecting) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const { data } = await supabase
          .from("streams")
          .select("status, ended_at")
          .eq("id", stream.id)
          .maybeSingle();
        if (cancelled || !data) return;
        if (data.status === "ended") {
          // Funnel through the same path as the realtime handler so the
          // existing cleanup effect at "Session cleanup on stream end" runs.
          setStream((prev) => ({
            ...prev,
            status: "ended",
            ended_at: data.ended_at ?? prev.ended_at,
          }));
        }
      } catch {
        /* swallow — next tick will retry */
      }
    };
    // Wait 4s before the first poll so we don't pile on top of the realtime
    // subscription's own initial sync. After that, every 8s.
    const initial = setTimeout(tick, 4000);
    const id = setInterval(tick, 8000);
    return () => {
      cancelled = true;
      clearTimeout(initial);
      clearInterval(id);
    };
  }, [stream.status, stream.id, isStreamLive, isConnected, remoteStream, supabase]);

  // ─── Attach remoteStream to video + dedicated audio element ──────────────
  // Pattern: <video> is permanently muted so its play() never blocks. A
  // dedicated <audio> sink carries sound and is what survives autoplay
  // policy. On every remoteStream (re)assignment we:
  //   1. Bind the same MediaStream to both elements (their `srcObject`).
  //   2. Always call video.play() — muted-autoplay is universally allowed.
  //   3. If the user has expressed intent to hear sound (isMuted=false),
  //      try audio.play(). If the browser refuses, set audioBlocked=true so
  //      the prominent "Tap to enable audio" prompt is rendered.
  //   4. If the user is still muted (isMuted=true) we still try to start
  //      the audio element MUTED so there is a live element ready — when
  //      they later unmute we just flip .muted=false rather than starting
  //      a fresh play() (which can fail on iOS outside a gesture window).
  useEffect(() => {
    const video = videoRef.current;
    const audio = audioRef.current;
    if (!video) return;

    if (remoteStream) {
      console.log("[Viewer] Attaching remote stream:", remoteStream.id);
      // Bind the SAME MediaStream to both elements. Browsers happily
      // duplicate playback sinks; we silence the video by hard-muting it.
      video.srcObject = remoteStream;
      if (audio) audio.srcObject = remoteStream;

      video.muted = true; // hardcoded — video element NEVER produces sound
      video.play().catch((err) => {
        // Even muted video can be blocked in rare embed/iframe cases.
        console.log("[Viewer] video.play() blocked:", err);
      });

      if (audio) {
        // Match audio.muted to React state. If isMuted=true the play() is
        // allowed everywhere (muted-autoplay). If isMuted=false we are
        // gambling on a recent user gesture; on failure we surface the prompt.
        audio.muted = isMuted;
        audio.play()
          .then(() => {
            // Successful playback — clear any stale block flag.
            if (audioBlocked) setAudioBlocked(false);
          })
          .catch((err) => {
            console.log(
              "[Viewer] audio.play() blocked — autoplay-with-sound denied:",
              err
            );
            // Block flag is only meaningful when the user actually wants sound.
            if (!audio.muted) setAudioBlocked(true);
          });
      }
    } else {
      console.log("[Viewer] Clearing video + audio streams");
      video.srcObject = null;
      if (audio) audio.srcObject = null;
      setAudioBlocked(false);
    }
  // intentionally exclude isMuted/audioBlocked: this effect is about
  // (re)binding the stream; mute state is reconciled by the sync-mute effect.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remoteStream]);

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
      // Belt-and-braces play() call in case the remoteStream effect raced the
      // element being ready. Muted-autoplay is always allowed so this is safe.
      video.play().catch(() => {});
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
  // The <video> element stays permanently muted (sound is in the <audio>
  // element). When the user unmutes we ALSO call audio.play() inside their
  // gesture in the click handler — this effect just keeps the DOM property
  // in sync if state changes outside a click (e.g. toggleMute, programmatic).
  useEffect(() => {
    if (videoRef.current) videoRef.current.muted = true;
    const audio = audioRef.current;
    if (audio) {
      audio.muted = isMuted;
      // Once unmuted by any path, the prompt is no longer needed.
      if (!isMuted && audioBlocked) setAudioBlocked(false);
    }
  }, [isMuted, audioBlocked]);

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

    // Also listen for host overlay broadcasts on the same channel (no extra subscription).
    channel.on("broadcast", { event: "stream-overlay" }, ({ payload }: any) => {
      if (!payload) return;
      const bg: OverlayBackground =
        payload.background === "light" || payload.background === "branded"
          ? payload.background
          : "dark";
      setOverlay({
        active: !!payload.active,
        message: typeof payload.message === "string" ? payload.message : "",
        background: bg,
        imageUrl: typeof payload.imageUrl === "string" ? payload.imageUrl : "",
      });
    });

    // Host slideshow broadcasts — reuses the chat channel, no extra sub.
    channel.on("broadcast", { event: "stream-slideshow" }, ({ payload }: any) => {
      if (!payload) return;
      setSlideshow({
        active: !!payload.active,
        url: typeof payload.url === "string" ? payload.url : "",
        caption: typeof payload.caption === "string" ? payload.caption : "",
      });
    });

    // Host ticker broadcasts — same channel, same pattern as overlay.
    channel.on("broadcast", { event: "stream-ticker" }, ({ payload }: any) => {
      if (!payload) return;
      const sp: TickerSpeed =
        payload.speed === "slow" || payload.speed === "fast" ? payload.speed : "normal";
      const st: TickerStyle =
        payload.style === "urgent" || payload.style === "info" ? payload.style : "default";
      setTicker({
        active: !!payload.active,
        message: typeof payload.message === "string" ? payload.message : "",
        speed: sp,
        style: st,
      });
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
    // block:"nearest" scopes the scroll to the chat's own ScrollArea viewport.
    // Without it, scrollIntoView walks up to the document and drags the whole
    // page to the bottom on mobile every time a message arrives or is sent.
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [messages]);

  // ─── Restore session from localStorage ───────────────────────────────────
  // Only auto-restore when the stream is NOT already ended. If the host ended
  // the stream before we mounted, we skip auto-join so the user sees the
  // ended screen cleanly rather than flashing a joined state.
  useEffect(() => {
    if (initialStream.status === "ended") return;
    const savedName = typeof window !== "undefined" ? localStorage.getItem("viewerName") : null;
    if (savedName && savedName !== "Guest") {
      setViewerName(savedName);
      supabase
        .from("viewers")
        .insert({ stream_id: stream.id, name: savedName, joined_at: new Date().toISOString() })
        .then(() => {
          // NOTE: do NOT set hasUserGestureRef=true here. This code path runs
          // in a useEffect, not a real user gesture. Setting it to true would
          // cause the auto-unmute logic to fire outside a gesture context —
          // which iOS Safari silently blocks. The "Tap to unmute" overlay
          // is the correct UX for restored sessions.
          setHasJoined(true);
          setShowNameDialog(false);
        })
        .catch(() => {
          setHasJoined(true);
          setShowNameDialog(false);
        });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── Session cleanup on stream end ───────────────────────────────────────
  // When the stream transitions to "ended", clear the viewer's local identity
  // and chat state so the NEXT visit / next stream starts clean. We use a
  // ref to track the previous status and only run cleanup on the actual
  // live|waiting → ended transition (not on re-mount into an already-ended
  // stream — there's nothing to clear in that case).
  const prevStreamStatusRef = useRef(stream.status);
  useEffect(() => {
    const prev = prevStreamStatusRef.current;
    const curr = stream.status;
    prevStreamStatusRef.current = curr;

    if (curr === "ended" && prev !== "ended") {
      console.log("[Viewer] Stream ended — clearing local session data");
      try {
        if (typeof window !== "undefined") {
          localStorage.removeItem("viewerName");
        }
      } catch {
        /* ignore quota / private-mode errors */
      }
      // Wipe in-memory chat + identity so nothing leaks to the next visit.
      setMessages([]);
      setNewMessage("");
      setViewerName("");
      setHasJoined(false);
      setShowNameDialog(false); // ended screen replaces the dialog
      setEmergencyMessage("");
      setEmergencySent(false);
      // Reset audio-gesture flags so a brand-new session (new stream on this
      // same tab) has a clean mute state.
      hasUserGestureRef.current = false;
      hasManuallyMutedRef.current = false;
    }
  }, [stream.status]);

  // ─── Load current overlay + ticker state on mount (for mid-stream joiners) ──
  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("streams")
        .select(
          "overlay_active, overlay_message, overlay_background, overlay_image_url, ticker_active, ticker_message, ticker_speed, ticker_style, slideshow_active, slideshow_current_url, slideshow_current_caption"
        )
        .eq("id", stream.id)
        .single();
      if (data) {
        const d = data as any;
        const bg = d.overlay_background;
        setOverlay({
          active: !!d.overlay_active,
          message: d.overlay_message ?? "",
          background: bg === "light" || bg === "branded" ? bg : "dark",
          imageUrl: d.overlay_image_url ?? "",
        });
        const sp = d.ticker_speed;
        const st = d.ticker_style;
        setTicker({
          active: !!d.ticker_active,
          message: d.ticker_message ?? "",
          speed: sp === "slow" || sp === "fast" ? sp : "normal",
          style: st === "urgent" || st === "info" ? st : "default",
        });
        setSlideshow({
          active: !!d.slideshow_active,
          url: d.slideshow_current_url ?? "",
          caption: d.slideshow_current_caption ?? "",
        });
      }
    })();
  }, [stream.id, supabase]);

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
        // Resume both elements. Audio.play() outside a gesture is allowed
        // here only because the user already gestured earlier this session
        // (hasUserGestureRef.current === true) — browsers honor a
        // recent-gesture window for tab-resume.
        if (videoRef.current?.paused && hasUserGestureRef.current) {
          videoRef.current.play().catch(() => {});
        }
        const audio = audioRef.current;
        if (audio?.paused && hasUserGestureRef.current && !isMuted) {
          audio.play().catch((err) => {
            console.log("[Viewer] audio resume on visibility blocked:", err);
            setAudioBlocked(true);
          });
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

  // ─── Fullscreen handling ─────────────────────────────────────
  // The Fullscreen API fires `fullscreenchange` on the document when the native
  // element-level fullscreen enters or exits. iOS Safari uses a different path:
  // calling `webkitEnterFullscreen()` on the <video> opens the native player,
  // and the exit is signaled via `webkitpresentationmodechanged` on the video.
  useEffect(() => {
    const onChange = () => {
      const native = !!(
        document.fullscreenElement ||
        (document as any).webkitFullscreenElement ||
        (document as any).mozFullScreenElement
      );
      // Only mutate state when it actually changes — avoids stomping the iOS
      // presentation-mode path that sets the flag manually.
      setIsFullscreen((prev) => (prev !== native ? native : prev));
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setIsFullscreen(false);
    };

    document.addEventListener("fullscreenchange", onChange);
    document.addEventListener("webkitfullscreenchange", onChange);
    document.addEventListener("mozfullscreenchange", onChange);
    document.addEventListener("keydown", onKey);

    // Lock body scroll while in CSS-fallback fullscreen so touch gestures
    // don't drag the page behind the video on mobile. When native Fullscreen
    // API is used, the UA already handles this — locking again is harmless.
    const prevOverflow = document.body.style.overflow;
    const prevOverscroll = (document.body.style as any).overscrollBehavior as string | undefined;
    if (isFullscreen) {
      document.body.style.overflow = "hidden";
      (document.body.style as any).overscrollBehavior = "contain";
    }

    // iOS Safari: the <video> element fires this when the user exits the
    // native inline/fullscreen player. Keep React state in sync.
    const video = videoRef.current;
    const onPresentationChange = () => {
      const mode = (video as any)?.webkitPresentationMode;
      if (mode === "fullscreen") setIsFullscreen(true);
      else if (mode === "inline") setIsFullscreen(false);
    };
    video?.addEventListener("webkitpresentationmodechanged", onPresentationChange);

    return () => {
      document.removeEventListener("fullscreenchange", onChange);
      document.removeEventListener("webkitfullscreenchange", onChange);
      document.removeEventListener("mozfullscreenchange", onChange);
      document.removeEventListener("keydown", onKey);
      video?.removeEventListener("webkitpresentationmodechanged", onPresentationChange);
      // Restore body styles we touched when entering fullscreen.
      if (isFullscreen) {
        document.body.style.overflow = prevOverflow;
        (document.body.style as any).overscrollBehavior = prevOverscroll ?? "";
      }
    };
  }, [isFullscreen]);

  // ─── Actions ──────────────────────────────────────────────────────────────

  // ... (rest of the code remains the same)
  // KEY FIX: joinStream is called directly from a button onClick / form onSubmit,
  // so we are inside a user-gesture call stack here. We:
  //   1. Mark gesture as received.
  //   2. Unmute the video element directly (synchronously).
  //   3. Call play() synchronously — iOS Safari requires this in the same stack frame.
  const joinStream = async (name: string) => {
    if (!name.trim()) return;

    // CRITICAL: this function is invoked from onClick / onSubmit, so we are
    // synchronously inside a user-gesture call stack. We MUST unmute here
    // (and only here) — iOS Safari disallows unmute outside a gesture.
    hasUserGestureRef.current = true;

    const video = videoRef.current;
    const audio = audioRef.current;
    if (!hasManuallyMutedRef.current) {
      // Unmute + play both elements SYNCHRONOUSLY inside the gesture.
      // iOS Safari disallows unmute outside a gesture, so the DOM writes
      // and play() calls must happen before any await.
      setIsMuted(false);
      setAudioBlocked(false);
      if (video) {
        video.muted = true; // video stays silent — audio element handles sound
        if (video.srcObject) video.play().catch(() => {});
      }
      if (audio) {
        audio.muted = false;
        if (audio.srcObject) {
          audio.play().catch((err) => {
            // Extremely rare inside a real gesture, but possible (focus race).
            console.log("[Viewer] audio.play() during join rejected:", err);
            setAudioBlocked(true);
          });
        }
        // If srcObject isn't set yet, the remoteStream attach effect will
        // call audio.play() when it arrives — within the recent-gesture
        // window that every browser honors for several seconds.
      }
    }

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
    const audio = audioRef.current;
    const newMuted = !isMuted;
    hasManuallyMutedRef.current = newMuted;
    hasUserGestureRef.current = true;
    setIsMuted(newMuted);
    setAudioBlocked(false);
    // Video stays muted always; audio element is the one we toggle.
    if (video) video.muted = true;
    if (audio) {
      audio.muted = newMuted;
      // Calling play() inside onClick is a real gesture — every browser
      // allows audio playback here, including iOS Safari.
      if (!newMuted) {
        audio.play().catch((err) => {
          console.log("[Viewer] audio.play() in toggleMute rejected:", err);
          setAudioBlocked(true);
        });
      }
    }
  };

  const toggleFullscreen = async () => {
    const video = videoRef.current;
    const container = videoContainerRef.current;

    if (!isFullscreen) {
      // iOS Safari path: opens native video player. Mark state immediately
      // because `fullscreenchange` does not fire — `webkitpresentationmodechanged`
      // does, and is wired up in the effect above (also flips state back on exit).
      if (video && typeof (video as any).webkitEnterFullscreen === "function") {
        try {
          (video as any).webkitEnterFullscreen();
          setIsFullscreen(true);
          return;
        } catch {
          /* fall through to element-level API */
        }
      }
      // Standard path: request fullscreen on the video container so our overlay,
      // ticker (which is outside), and controls composition remain predictable.
      const el = container || document.documentElement;
      try {
        if (el.requestFullscreen) {
          await el.requestFullscreen();
        } else if ((el as any).webkitRequestFullscreen) {
          (el as any).webkitRequestFullscreen();
        } else {
          // No API at all — use CSS-driven fallback.
          setIsFullscreen(true);
        }
        // Note: do NOT manually setIsFullscreen(true) here on success. The
        // `fullscreenchange` listener is the single source of truth and will
        // fire within one frame. Double-setting caused a brief state flash.
      } catch {
        // Permission denied / gesture issue — fall back to CSS fullscreen.
        setIsFullscreen(true);
      }
    } else {
      // iOS: exit native player explicitly if present.
      if (video && typeof (video as any).webkitExitFullscreen === "function" &&
          (video as any).webkitPresentationMode === "fullscreen") {
        try {
          (video as any).webkitExitFullscreen();
          setIsFullscreen(false);
          return;
        } catch {
          /* fall through */
        }
      }
      const native = !!(
        document.fullscreenElement || (document as any).webkitFullscreenElement
      );
      if (native) {
        try {
          if (document.exitFullscreen) {
            await document.exitFullscreen();
          } else if ((document as any).webkitExitFullscreen) {
            (document as any).webkitExitFullscreen();
          }
          // fullscreenchange listener will flip state.
        } catch {
          setIsFullscreen(false);
        }
      } else {
        // CSS-fallback fullscreen — exit directly.
        setIsFullscreen(false);
      }
    }
  };

  const toggleFitMode = () => {
    setFitMode((m) => (m === "contain" ? "cover" : "contain"));
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

          {/* Audio-recovery prompt.
              Two trigger conditions:
                A. isMuted === true (user has not yet expressed intent to hear)
                B. audioBlocked === true (autoplay-with-sound was refused)
              Both resolve via the same one-tap handler that plays the
              dedicated <audio> sink inside a fresh user-gesture stack frame. */}
          {(isMuted || audioBlocked) && isConnected && remoteStream && (
            <div className="absolute inset-0 flex items-end justify-center pb-20 sm:pb-24 pointer-events-none z-10">
              <button
                aria-label={audioBlocked ? "Tap to enable audio" : "Tap to unmute"}
                className={`pointer-events-auto flex items-center gap-2 text-white font-semibold px-5 py-3 rounded-full border shadow-lg backdrop-blur-md transition-transform active:scale-95 ${
                  audioBlocked
                    ? "bg-red-600/90 hover:bg-red-600 border-red-300/40 text-base animate-pulse"
                    : "bg-black/75 hover:bg-black/90 border-white/20 text-sm"
                }`}
                onClick={() => {
                  hasManuallyMutedRef.current = false;
                  hasUserGestureRef.current = true;
                  setIsMuted(false);
                  setAudioBlocked(false);
                  const video = videoRef.current;
                  const audio = audioRef.current;
                  if (video) {
                    video.muted = true; // permanent — sound goes through audio el
                    video.play().catch(() => {});
                  }
                  if (audio) {
                    audio.muted = false;
                    audio.play().catch((err) => {
                      // Truly stuck — leave the flag so we keep prompting.
                      console.log("[Viewer] audio.play() in prompt rejected:", err);
                      setAudioBlocked(true);
                    });
                  }
                }}
              >
                <VolumeX className={`${audioBlocked ? "w-5 h-5" : "w-4 h-4"} text-red-300`} />
                {audioBlocked ? "Tap to enable audio" : "Tap to unmute"}
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

            <Button
              variant="secondary"
              size="icon"
              className="rounded-full bg-black/50 hover:bg-black/70 text-white"
              onClick={toggleFitMode}
              title={fitMode === "contain" ? "Fill screen (crop)" : "Fit screen (letterbox)"}
            >
              {fitMode === "contain" ? <Expand className="w-5 h-5" /> : <Shrink className="w-5 h-5" />}
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
                  style={
                    isFullscreen
                      ? {
                          // `--app-vh` is updated live from VisualViewport via
                          // useViewportHeight(); falls back to 100dvh on browsers
                          // where the CSS var isn't set yet (desktop / non-JS).
                          height: "var(--app-vh, 100dvh)",
                        }
                      : undefined
                  }
                  className={`relative bg-black ${
                    isFullscreen
                      ? "fixed inset-0 z-50 w-screen"
                      : "aspect-video w-full"
                  }`}
                >
                  {/* Video element is rendered here ALWAYS so the ref never goes stale.
                      getVideoContent() renders overlays and states on top of it.
                      NOTE: do NOT gate the display style on hostVideoEnabled — it can
                      be momentarily false/undefined right after connection while tracks
                      settle, which would hide the <video> and lose the gesture context
                      needed for auto-unmute. The "camera off" UI is handled as an
                      overlay inside getVideoContent() when tracks are truly absent. */}
                  <video
                    ref={videoRef}
                    autoPlay
                    playsInline
                    muted /* permanent — see audio element below */
                    controls={false}
                    className={`absolute inset-0 w-full h-full ${
                      fitMode === "cover" ? "object-cover" : "object-contain"
                    }`}
                    style={{
                      display:
                        isStreamLive && isConnected && remoteStream ? undefined : "none",
                      // GPU hint: promotes the <video> to its own compositor layer
                      // for smoother scaling and fullscreen transitions on mobile.
                      transform: "translateZ(0)",
                      backfaceVisibility: "hidden",
                    }}
                  />
                  {/* Dedicated audio sink. The same MediaStream is bound to
                      both <video> (silent) and this <audio> element so audio
                      survives any video-element re-binds during ICE recovery.
                      Hidden but kept in the DOM so the ref is always live. */}
                  <audio
                    ref={audioRef}
                    autoPlay
                    playsInline
                    aria-hidden="true"
                    style={{ display: "none" }}
                  />
                  {getVideoContent()}
                  {/* Host-controlled image slideshow — z-20, above video, below
                      StreamOverlay (which is a stronger full takeover). */}
                  <StreamSlideshow
                    active={slideshow.active}
                    imageUrl={slideshow.url}
                    caption={slideshow.caption}
                  />
                  {/* Host-controlled overlay — rendered on top of video, below controls badge */}
                  <StreamOverlay
                    active={overlay.active}
                    message={overlay.message}
                    background={overlay.background}
                    imageUrl={overlay.imageUrl}
                  />
                  <div className="absolute top-2 sm:top-3 right-2 sm:right-3 z-30 flex items-center gap-1.5">
                    {isUsingTurn && (
                      <Badge
                        variant="outline"
                        className="gap-1 bg-black/50 text-white border-white/20 text-[10px] h-5 px-1.5"
                        title="Connected through a TURN relay (slower networks)"
                      >
                        Relay
                      </Badge>
                    )}
                    {getConnectionStatusBadge()}
                  </div>
                </div>
              </div>

              {/* Host-controlled scrolling ticker — sits BELOW the video container,
                  outside videoContainerRef so fullscreen mode and the overlay
                  z-index stack are never affected. */}
              <StreamTicker
                active={ticker.active}
                message={ticker.message}
                speed={ticker.speed}
                style={ticker.style}
              />

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

            {/* Insider Circle subscribe \u2014 viewer-facing email signup. Lives
                under the chat panel because that's where engaged viewers
                already are. Hidden when host_id is missing (anon-fetched
                stream rows where the host couldn't be resolved). */}
            {stream.host_id && (
              <InsiderCircleSubscribe
                hostId={stream.host_id}
                hostName={hostName}
                roomCode={stream.room_code}
              />
            )}
          </div>
        </main>
      </div>
    </>
  );
}
