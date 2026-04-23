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
  Settings,
  WifiOff as DataSaver,
  Monitor,
  Smartphone,
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
  const [useFallback, setUseFallback] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isDataSaver, setIsDataSaver] = useState(false);
  const [videoQuality, setVideoQuality] = useState<'auto' | 'high' | 'medium' | 'low'>('auto');
  const [showControls, setShowControls] = useState(true);
  const [isMobile, setIsMobile] = useState(false);
  const [showEmergencyDialog, setShowEmergencyDialog] = useState(false);
  const [emergencyMessage, setEmergencyMessage] = useState("");
  const [emergencySent, setEmergencySent] = useState(false);
  const [isRefreshingChat, setIsRefreshingChat] = useState(false);
  const [streamElapsed, setStreamElapsed] = useState(0);
  const [connectingSeconds, setConnectingSeconds] = useState(0);
  const [isPiP, setIsPiP] = useState(false);
  const [pipSupported, setPipSupported] = useState(false);
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const videoContainerRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const supabaseRef = useRef(createClient());
  const supabase = supabaseRef.current;
  const chatChannelRef = useRef<any>(null);

  const handleStreamEnd = useCallback(() => {
    setStream((prev) => ({ ...prev, status: "ended" }));
  }, []);

  // Always connect to the main host channel — camera relaying happens on the host side
  const streamHook = useSimpleStream({
    streamId: stream.id,
    roomCode: stream.room_code,
    viewerName: viewerName || "Viewer",
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

  // Handle connection errors and retry logic
  useEffect(() => {
    if (error) {
      console.log("Connection error detected:", error);
      setRetryCount(prev => prev + 1);
    }
  }, [error]);

  // Track how long viewer has been stuck connecting — drives progressive UX messages
  useEffect(() => {
    const isStuckConnecting =
      (stream.status === 'live' || isStreamLive) && !isConnected && !remoteStream;
    if (!isStuckConnecting) {
      setConnectingSeconds(0);
      return;
    }
    const id = setInterval(() => setConnectingSeconds(s => s + 1), 1000);
    return () => clearInterval(id);
  }, [stream.status, isStreamLive, isConnected, remoteStream]);

  // Auto-reload after 90s stuck connecting — host likely refreshed and re-joined
  useEffect(() => {
    if (connectingSeconds >= 90) {
      window.location.reload();
    }
  }, [connectingSeconds]);

  const shareLink =
    typeof window !== "undefined"
      ? `${window.location.origin}/watch/${stream.room_code}`
      : "";

  // Update video element when remote stream changes with enhanced error handling
  useEffect(() => {
    const videoElement = videoRef.current;
    
    if (!videoElement) return;
    
    if (remoteStream) {
      console.log('[Viewer] Setting video stream:', remoteStream.id, remoteStream.getVideoTracks().length, remoteStream.getAudioTracks().length);
      
      // Set the stream
      videoElement.srcObject = remoteStream;
      
      // Check if video is actually playing and update hostVideoEnabled state
      const checkVideoPlaying = () => {
        const videoTracks = remoteStream.getVideoTracks();
        const hasVideoTracks = videoTracks.length > 0;
        const videoElementReady = videoElement.readyState >= 2; // HAVE_CURRENT_DATA
        
        if (hasVideoTracks && videoElementReady) {
          const videoTrack = videoTracks[0];
          const videoEnabled = videoTrack.enabled && videoTrack.readyState === 'live';
          console.log('[Viewer] Video check - tracks:', hasVideoTracks, 'element ready:', videoElementReady, 'track enabled:', videoEnabled);
          
          // If video is playing, ensure hostVideoEnabled is true
          if (videoEnabled && !hostVideoEnabled) {
            console.log('[Viewer] Correcting hostVideoEnabled state - video is actually playing');
            // This will be handled by the stream manager, but we can add additional checks
          }
        }
      };
      
      // Check video state after a short delay
      setTimeout(checkVideoPlaying, 1000);
      
      // Play the video (handle autoplay restrictions)
      const playVideo = async () => {
        try {
          await videoElement.play();
          console.log('[Viewer] Video playing successfully');
        } catch (error) {
          console.error('[Viewer] Error playing video:', error);
          // Handle autoplay restrictions
          if (error instanceof Error && error.name === 'NotAllowedError') {
            // Add user interaction hint
            console.log('[Viewer] Autoplay blocked, waiting for user interaction');
          }
        }
      };
      
      // Try to play immediately
      playVideo();
      
      // Also try on user interaction
      const handleUserInteraction = () => {
        playVideo();
        document.removeEventListener('click', handleUserInteraction);
        document.removeEventListener('touchstart', handleUserInteraction);
      };
      
      document.addEventListener('click', handleUserInteraction, { once: true });
      document.addEventListener('touchstart', handleUserInteraction, { once: true });
      
    } else {
      console.log('[Viewer] Clearing video stream');
      videoElement.srcObject = null;
    }
  }, [remoteStream]);

  // Handle video element events
  useEffect(() => {
    const videoElement = videoRef.current;
    if (!videoElement) return;
    
    const handleLoadStart = () => {
      console.log('[Viewer] Video load start');
      const loadingOverlay = document.getElementById('video-loading');
      if (loadingOverlay) {
        loadingOverlay.classList.remove('opacity-0');
        loadingOverlay.classList.add('opacity-100');
      }
    };
    
    const handleCanPlay = () => {
      console.log('[Viewer] Video can play');
      const loadingOverlay = document.getElementById('video-loading');
      if (loadingOverlay) {
        loadingOverlay.classList.remove('opacity-100');
        loadingOverlay.classList.add('opacity-0');
      }
    };
    
    const handleError = (e: Event) => {
      console.error('[Viewer] Video error:', e);
      // setError('Video playback failed. Please try refreshing.');
      const loadingOverlay = document.getElementById('video-loading');
      if (loadingOverlay) {
        loadingOverlay.classList.remove('opacity-100');
        loadingOverlay.classList.add('opacity-0');
      }
    };
    
    const handleStalled = () => {
      console.log('[Viewer] Video stalled');
      const loadingOverlay = document.getElementById('video-loading');
      if (loadingOverlay) {
        loadingOverlay.classList.remove('opacity-0');
        loadingOverlay.classList.add('opacity-100');
      }
    };
    
    const handleSuspend = () => {
      console.log('[Viewer] Video suspended');
      const loadingOverlay = document.getElementById('video-loading');
      if (loadingOverlay) {
        loadingOverlay.classList.remove('opacity-0');
        loadingOverlay.classList.add('opacity-100');
      }
    };
    
    const handlePlaying = () => {
      console.log('[Viewer] Video playing');
      const loadingOverlay = document.getElementById('video-loading');
      if (loadingOverlay) {
        loadingOverlay.classList.remove('opacity-100');
        loadingOverlay.classList.add('opacity-0');
      }
    };
    
    videoElement.addEventListener('loadstart', handleLoadStart);
    videoElement.addEventListener('canplay', handleCanPlay);
    videoElement.addEventListener('error', handleError);
    videoElement.addEventListener('stalled', handleStalled);
    videoElement.addEventListener('suspend', handleSuspend);
    videoElement.addEventListener('playing', handlePlaying);
    
    return () => {
      videoElement.removeEventListener('loadstart', handleLoadStart);
      videoElement.removeEventListener('canplay', handleCanPlay);
      videoElement.removeEventListener('error', handleError);
      videoElement.removeEventListener('stalled', handleStalled);
      videoElement.removeEventListener('suspend', handleSuspend);
      videoElement.removeEventListener('playing', handlePlaying);
    };
  }, []);

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
          const updated = payload.new as Stream;
          setStream(updated);
          // DB trigger keeps viewer_count — only use if higher than presence count
          if (typeof updated.viewer_count === 'number' && updated.viewer_count > 0) {
            setViewerCount(prev => Math.max(prev, updated.viewer_count));
          }
          // Camera switching is handled transparently by the host via replaceTrack()
          // — viewers never need to reconnect or change channels.
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [stream.id, supabase]);

  // Real-time chat via Broadcast (same channel as host — no publication config needed)
  useEffect(() => {
    console.log('[Viewer] Setting up chat broadcast subscription for stream:', stream.id);

    const channel = supabase
      .channel(`chat-room-${stream.id}`, {
        config: { broadcast: { self: true } },
      })
      .on("broadcast", { event: "chat-message" }, ({ payload }) => {
        console.log('[Viewer] New chat message received via broadcast:', payload);
        setMessages((prev) => {
          if (prev.some((m) => m.id === payload.id)) return prev;
          return [...prev, payload as ChatMessage];
        });
        vibrateDevice([60]); // subtle buzz for every new chat message
      })
      .subscribe((status) => {
        console.log('[Viewer] Chat subscription status:', status);
        if (status === 'SUBSCRIBED') {
          console.log('[Viewer] Chat channel subscribed, loading existing messages...');
          loadExistingMessages();
        }
      });

    chatChannelRef.current = channel;

    const loadExistingMessages = async () => {
      try {
        console.log('[Viewer] Loading existing chat messages...');
        const { data, error } = await supabase
          .from("chat_messages")
          .select("*")
          .eq("stream_id", stream.id)
          .order("created_at", { ascending: true });
        if (error) {
          console.error('[Viewer] Error loading existing messages:', error);
        } else {
          console.log('[Viewer] Loaded existing messages:', data?.length || 0);
          if (data) setMessages(data);
        }
      } catch (error) {
        console.error('[Viewer] Exception loading existing messages:', error);
      }
    };

    return () => {
      console.log('[Viewer] Cleaning up chat channel');
      supabase.removeChannel(channel);
      chatChannelRef.current = null;
    };
  }, [stream.id]);

  // Presence-based viewer count — starts immediately on page load, no DB insert needed
  // Runs regardless of hasJoined: PC users who dismiss the dialog were never being counted
  useEffect(() => {
    const ch = supabase
      .channel(`presence-${stream.id}`, { config: { presence: { key: presenceIdRef.current } } })
      .on('presence', { event: 'sync' }, () => {
        setViewerCount(Object.keys(ch.presenceState()).length);
      })
      .on('presence', { event: 'join' }, () => {
        setViewerCount(Object.keys(ch.presenceState()).length);
      })
      .on('presence', { event: 'leave' }, () => {
        setViewerCount(Object.keys(ch.presenceState()).length);
      })
      .subscribe(async (status: string) => {
        if (status === 'SUBSCRIBED') {
          await ch.track({ id: presenceIdRef.current, joined_at: Date.now() });
        }
      });

    return () => { supabase.removeChannel(ch); };
  }, [stream.id, supabase]);

  // Auto-scroll chat
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const joinStream = async () => {
    if (!viewerName.trim()) return;
    
    // Persist name in localStorage
    if (typeof window !== 'undefined') {
      localStorage.setItem('viewerName', viewerName.trim());
    }

    try {
      // Register viewer in database
      await supabase.from("viewers").insert({
        stream_id: stream.id,
        name: viewerName.trim(),
        joined_at: new Date().toISOString(),
      });
      
      setHasJoined(true);
      setShowNameDialog(false);
      console.log('[Viewer] Successfully joined stream with name:', viewerName);
      
      // Immediately update viewer count after joining
      setTimeout(() => {
        const currentCount = viewerCount;
        setViewerCount(currentCount + 1);
        console.log('[Viewer] Incremented viewer count to:', currentCount + 1);
      }, 500);
    } catch (error) {
      console.error('[Viewer] Error joining stream:', error);
      // Still allow local join even if database fails
      setHasJoined(true);
      setShowNameDialog(false);
    }
  };

  const sendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMessage.trim() || !hasJoined) return;
    const msgText = newMessage.trim();
    setNewMessage(""); // clear immediately for responsive feel
    const { data } = await supabase
      .from("chat_messages")
      .insert({ stream_id: stream.id, sender_name: viewerName, message: msgText })
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

  const sendEmergencyMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!emergencyMessage.trim() || !hasJoined) return;

    try {
      // Send as a special system message with high priority
      await supabase.from("chat_messages").insert({
        stream_id: stream.id,
        sender_name: `SYSTEM - ${viewerName}`,
        message: `EMERGENCY: ${emergencyMessage.trim()}`,
        is_emergency: true,
      });

      setEmergencyMessage("");
      setEmergencySent(true);
      setShowEmergencyDialog(false);
      
      // Reset success message after 5 seconds
      setTimeout(() => setEmergencySent(false), 5000);
      
      console.log('[Viewer] Emergency message sent:', emergencyMessage);
    } catch (error) {
      console.error('[Viewer] Error sending emergency message:', error);
    }
  };

  const refreshChat = async () => {
    setIsRefreshingChat(true);
    try {
      console.log('[Viewer] Refreshing chat messages...');
      
      // Load existing messages
      const { data, error } = await supabase
        .from("chat_messages")
        .select("*")
        .eq("stream_id", stream.id)
        .order("created_at", { ascending: true });

      if (error) {
        console.error('[Viewer] Error refreshing chat:', error);
      } else if (data) {
        console.log('[Viewer] Chat refreshed, loaded', data.length, 'messages');
        setMessages(data);
      }
    } catch (error) {
      console.error('[Viewer] Error refreshing chat:', error);
    } finally {
      setIsRefreshingChat(false);
    }
  };

  const copyShareLink = () => {
    navigator.clipboard.writeText(shareLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const formatElapsed = (s: number) => {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
    return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  };

  const getNameColor = (name: string) => {
    const colors = ['text-blue-400', 'text-emerald-400', 'text-purple-400', 'text-orange-400', 'text-pink-400', 'text-cyan-400', 'text-yellow-400', 'text-rose-400', 'text-indigo-400', 'text-teal-400'];
    let hash = 0;
    for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
    return colors[Math.abs(hash) % colors.length];
  };

  const formatDuration = (startedAt: string | null, endedAt: string | null): string => {
    if (!startedAt) return 'unknown time';
    
    const start = new Date(startedAt);
    const end = endedAt ? new Date(endedAt) : new Date();
    const duration = Math.floor((end.getTime() - start.getTime()) / 1000);
    
    if (duration < 60) return `${duration} seconds`;
    if (duration < 3600) return `${Math.floor(duration / 60)} minutes`;
    return `${Math.floor(duration / 3600)}h ${Math.floor((duration % 3600) / 60)}m`;
  };

  const togglePiP = async () => {
    const video = videoRef.current;
    if (!video) return;
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      } else if (typeof (video as any).webkitSetPresentationMode === 'function') {
        // iOS Safari
        const current = (video as any).webkitPresentationMode;
        (video as any).webkitSetPresentationMode(
          current === 'picture-in-picture' ? 'inline' : 'picture-in-picture'
        );
      } else if (video.requestPictureInPicture) {
        await video.requestPictureInPicture();
      }
    } catch (err) {
      console.log('[Viewer] PiP error:', err);
    }
  };

  const toggleFullscreen = async () => {
    if (!isFullscreen) {
      const video = videoRef.current;
      const container = videoContainerRef.current;

      // iOS Safari: only the <video> element supports native fullscreen
      if (video && typeof (video as any).webkitEnterFullscreen === 'function') {
        try {
          (video as any).webkitEnterFullscreen();
          return;
        } catch (err) {
          console.log('[Viewer] webkitEnterFullscreen failed, trying container:', err);
        }
      }

      // Android / Desktop: try native fullscreen on container
      const element = container || document.documentElement;
      try {
        if (element.requestFullscreen) {
          await element.requestFullscreen();
        } else if ((element as any).webkitRequestFullscreen) {
          (element as any).webkitRequestFullscreen();
        } else if ((element as any).mozRequestFullScreen) {
          (element as any).mozRequestFullScreen();
        } else if ((element as any).msRequestFullscreen) {
          (element as any).msRequestFullscreen();
        } else {
          // CSS pseudo-fullscreen fallback
          setIsFullscreen(true);
        }
      } catch (err) {
        console.log('[Viewer] Native fullscreen failed, using CSS overlay:', err);
        setIsFullscreen(true);
      }
    } else {
      // Check if native fullscreen is active
      const nativeActive = !!(document.fullscreenElement || (document as any).webkitFullscreenElement);
      if (nativeActive) {
        try {
          if (document.exitFullscreen) await document.exitFullscreen();
          else if ((document as any).webkitExitFullscreen) (document as any).webkitExitFullscreen();
          else if ((document as any).mozCancelFullScreen) (document as any).mozCancelFullScreen();
          else if ((document as any).msExitFullscreen) (document as any).msExitFullscreen();
        } catch (err) {
          console.log('[Viewer] Exit fullscreen failed:', err);
          setIsFullscreen(false);
        }
      } else {
        // Exit CSS pseudo-fullscreen
        setIsFullscreen(false);
      }
    }
  };

  // Handle fullscreen change events
  useEffect(() => {
    const handleFullscreenChange = () => {
      const isFullscreenActive = !!(
        document.fullscreenElement ||
        (document as any).webkitFullscreenElement ||
        (document as any).mozFullScreenElement ||
        (document as any).msFullscreenElement
      );
      setIsFullscreen(isFullscreenActive);
      console.log('[Viewer] Fullscreen state changed:', isFullscreenActive);
    };

    const handleFullscreenError = (event: Event) => {
      console.error('[Viewer] Fullscreen error:', event);
    };

    // Escape key exits CSS pseudo-fullscreen
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsFullscreen(false);
    };

    // Add all fullscreen event listeners
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
    document.addEventListener('mozfullscreenchange', handleFullscreenChange);
    document.addEventListener('MSFullscreenChange', handleFullscreenChange);
    document.addEventListener('keydown', handleKeyDown);
    
    document.addEventListener('fullscreenerror', handleFullscreenError);
    document.addEventListener('webkitfullscreenerror', handleFullscreenError);
    document.addEventListener('mozfullscreenerror', handleFullscreenError);

    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      document.removeEventListener('webkitfullscreenchange', handleFullscreenChange);
      document.removeEventListener('mozfullscreenchange', handleFullscreenChange);
      document.removeEventListener('MSFullscreenChange', handleFullscreenChange);
      document.removeEventListener('keydown', handleKeyDown);
      
      document.removeEventListener('fullscreenerror', handleFullscreenError);
      document.removeEventListener('webkitfullscreenerror', handleFullscreenError);
      document.removeEventListener('mozfullscreenerror', handleFullscreenError);
    };
  }, []);

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

  // Restore session from localStorage
  useEffect(() => {
    const savedName = typeof window !== 'undefined' ? localStorage.getItem('viewerName') : null;
    if (savedName && savedName !== 'Guest') {
      setViewerName(savedName);
      supabase.from('viewers').insert({
        stream_id: stream.id,
        name: savedName,
        joined_at: new Date().toISOString(),
      }).then(() => {
        setHasJoined(true);
        setShowNameDialog(false);
      }).catch(() => {
        setHasJoined(true);
        setShowNameDialog(false);
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load chat messages immediately on mount
  useEffect(() => {
    const loadInitial = async () => {
      const { data } = await supabase
        .from('chat_messages')
        .select('*')
        .eq('stream_id', stream.id)
        .order('created_at', { ascending: true });
      if (data && data.length > 0) setMessages(data);
    };
    loadInitial();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stream.id]);

  // Apply video quality settings
  useEffect(() => {
    if (videoRef.current && remoteStream) {
      const videoTrack = remoteStream.getVideoTracks()[0];
      if (videoTrack) {
        const constraints = {
          width: isDataSaver ? { ideal: 640 } : videoQuality === 'low' ? { ideal: 480 } : videoQuality === 'medium' ? { ideal: 720 } : videoQuality === 'high' ? { ideal: 1080 } : { ideal: 720 },
          height: isDataSaver ? { ideal: 360 } : videoQuality === 'low' ? { ideal: 360 } : videoQuality === 'medium' ? { ideal: 480 } : videoQuality === 'high' ? { ideal: 720 } : { ideal: 480 },
          frameRate: isDataSaver ? { ideal: 15 } : { ideal: 30 }
        };
        
        // Apply constraints to the video track
        videoTrack.applyConstraints(constraints).catch(err => {
          console.log('Could not apply video constraints:', err);
        });
      }
    }
  }, [videoQuality, isDataSaver, remoteStream]);

  // Detect PiP support on mount
  useEffect(() => {
    const video = videoRef.current;
    const supported =
      !!document.pictureInPictureEnabled ||
      (video && typeof (video as any).webkitSetPresentationMode === 'function');
    setPipSupported(!!supported);
  }, []);

  // Sync PiP state from native events
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const onEnter = () => setIsPiP(true);
    const onLeave = () => setIsPiP(false);
    video.addEventListener('enterpictureinpicture', onEnter);
    video.addEventListener('leavepictureinpicture', onLeave);
    return () => {
      video.removeEventListener('enterpictureinpicture', onEnter);
      video.removeEventListener('leavepictureinpicture', onLeave);
    };
  }, []);

  // Wake Lock — keep screen on while stream is live
  useEffect(() => {
    const requestWakeLock = async () => {
      try {
        if ('wakeLock' in navigator) {
          wakeLockRef.current = await (navigator as any).wakeLock.request('screen');
        }
      } catch { /* not supported or denied */ }
    };
    const releaseWakeLock = () => {
      wakeLockRef.current?.release();
      wakeLockRef.current = null;
    };

    if (stream.status === 'live') {
      requestWakeLock();
    }

    // Re-acquire after page becomes visible again (browsers release it on hide)
    const handleVisibility = () => {
      if (document.visibilityState === 'visible' && stream.status === 'live') {
        requestWakeLock();
        // Resume video if browser paused it in background
        if (videoRef.current?.paused) {
          videoRef.current.play().catch(() => {});
        }
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      releaseWakeLock();
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [stream.status]);

  // Live duration timer
  useEffect(() => {
    if (stream.status !== 'live' || !stream.started_at) return;
    const start = new Date(stream.started_at).getTime();
    const tick = () => setStreamElapsed(Math.floor((Date.now() - start) / 1000));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [stream.status, stream.started_at]);

  // Fallback: sync viewer_count from DB trigger via streams table every 10s
  // Only updates if presence count is still 0 (presence is primary source)
  useEffect(() => {
    if (stream.status !== 'live') return;
    const refresh = async () => {
      const { data } = await supabase
        .from('streams')
        .select('viewer_count')
        .eq('id', stream.id)
        .single();
      if (data && typeof data.viewer_count === 'number' && data.viewer_count > 0) {
        setViewerCount(prev => Math.max(prev, data.viewer_count));
      }
    };
    const id = setInterval(refresh, 10000);
    return () => clearInterval(id);
  }, [stream.id, stream.status, supabase]);

  // Auto-hide controls in fullscreen
  useEffect(() => {
    let timeout: NodeJS.Timeout;
    
    if (isFullscreen) {
      const showControlsTemporarily = () => {
        setShowControls(true);
        clearTimeout(timeout);
        timeout = setTimeout(() => {
          setShowControls(false);
        }, 3000);
      };
      
      const handleMouseMove = () => showControlsTemporarily();
      const handleTouchStart = () => showControlsTemporarily();
      
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('touchstart', handleTouchStart);
      
      showControlsTemporarily();
      
      return () => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('touchstart', handleTouchStart);
        clearTimeout(timeout);
      };
    } else {
      setShowControls(true);
    }
  }, [isFullscreen]);

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
  };

  const getVideoContent = () => {
    // Stream ended
    if (stream.status === "ended") {
      return (
        <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-gray-900 to-gray-800">
          <div className="text-center max-w-md mx-auto px-6">
            <div className="w-20 h-20 bg-red-500/20 rounded-full flex items-center justify-center mx-auto mb-6 border-2 border-red-500">
              <Circle className="w-10 h-10 text-red-400" />
            </div>
            <h2 className="text-2xl font-bold text-white mb-3">
              Stream Ended
            </h2>
            <p className="text-gray-300 text-lg mb-6">
              This stream has ended. Thank you for watching!
            </p>
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
              <Button 
                variant="outline" 
                className="w-full border-gray-600 text-gray-300 hover:bg-gray-800"
                onClick={() => window.location.href = '/'}
              >
                <ArrowLeft className="w-4 h-4 mr-2" />
                Back to Home
              </Button>
              <Button 
                className="w-full bg-red-500 hover:bg-red-600 text-white"
                onClick={copyShareLink}
              >
                <Share2 className="w-4 h-4 mr-2" />
                {copied ? "Link Copied!" : "Share Stream"}
              </Button>
            </div>
          </div>
        </div>
      );
    }

    // Stream is live and connected with video
    if (isStreamLive && isConnected && remoteStream) {
      return (
        <>
          <div className={`relative w-full h-full ${isFullscreen ? 'bg-black' : ''}`}>
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted={isMuted}
              controls={false}
              className={`w-full h-full object-contain ${
                !hostVideoEnabled ? "hidden" : ""
              } ${isFullscreen ? 'max-h-screen' : ''}`}
            />
            
            {/* Loading overlay */}
            <div className="absolute inset-0 flex items-center justify-center bg-black/50 pointer-events-none opacity-0 transition-opacity duration-300" id="video-loading">
              <div className="text-center">
                <Loader2 className="w-12 h-12 text-white animate-spin mx-auto mb-2" />
                <p className="text-white text-sm">Loading stream...</p>
              </div>
            </div>
            

            {/* Unmute overlay — shown when muted so mobile viewers know to tap */}
            {isMuted && isConnected && remoteStream && (
              <div
                className="absolute inset-0 flex items-end justify-center pb-20 pointer-events-none z-10"
              >
                <button
                  className="pointer-events-auto flex items-center gap-2 bg-black/70 hover:bg-black/90 text-white text-sm font-medium px-4 py-2 rounded-full border border-white/20 backdrop-blur-sm"
                  onClick={() => {
                    setIsMuted(false);
                    if (videoRef.current) {
                      videoRef.current.muted = false;
                      videoRef.current.play().catch(() => {});
                    }
                  }}
                >
                  <VolumeX className="w-4 h-4 text-red-400" />
                  Tap to unmute
                </button>
              </div>
            )}

            {/* Pause notification overlay */}
            {isStreamPaused && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/70 pointer-events-none transition-opacity duration-300">
                <div className="text-center">
                  <div className="w-16 h-16 bg-orange-500/20 rounded-full flex items-center justify-center mx-auto mb-4 border-2 border-orange-500">
                    <Pause className="w-8 h-8 text-orange-400" />
                  </div>
                  <h3 className="text-white text-xl font-semibold mb-2">Stream Paused</h3>
                  <p className="text-gray-300 text-sm max-w-md">
                    The host has paused the stream. Please wait a moment while they resume...
                  </p>
                  <div className="mt-4">
                    <div className="flex items-center justify-center gap-2">
                      <Loader2 className="w-4 h-4 text-orange-400 animate-spin" />
                      <span className="text-orange-400 text-sm">Will resume shortly</span>
                    </div>
                  </div>
                </div>
              </div>
            )}
            
            {!hostVideoEnabled && remoteStream && remoteStream.getVideoTracks().length === 0 && (
              <div className="absolute inset-0 flex items-center justify-center bg-muted">
                <div className="text-center">
                  <VideoOff className="w-16 h-16 text-muted-foreground mx-auto mb-4" />
                  <p className="text-muted-foreground">
                    Host has turned off their camera
                  </p>
                </div>
              </div>
            )}

            {!hostVideoEnabled && remoteStream && remoteStream.getVideoTracks().length > 0 && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/50">
                <div className="text-center">
                  <Loader2 className="w-12 h-12 text-white animate-spin mx-auto mb-4" />
                  <p className="text-white">
                    Connecting to video...
                  </p>
                </div>
              </div>
            )}
            
            {/* Enhanced video controls */}
            <div 
              className={`absolute bottom-4 left-1/2 transform -translate-x-1/2 flex items-center gap-2 transition-opacity duration-300 ${
                showControls || !isFullscreen ? 'opacity-100' : 'opacity-0'
              }`}
            >
              {/* Quality selector */}
              <div className="flex items-center bg-black/50 rounded-full px-3 py-2 gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-white hover:bg-white/20 p-1"
                  onClick={() => setIsDataSaver(!isDataSaver)}
                >
                  <DataSaver className={`w-4 h-4 ${isDataSaver ? 'text-orange-400' : ''}`} />
                </Button>
                
                <select
                  value={videoQuality}
                  onChange={(e) => setVideoQuality(e.target.value as any)}
                  className="bg-transparent text-white text-sm border-none outline-none cursor-pointer"
                >
                  <option value="auto" className="bg-gray-800">Auto</option>
                  <option value="high" className="bg-gray-800">1080p</option>
                  <option value="medium" className="bg-gray-800">720p</option>
                  <option value="low" className="bg-gray-800">480p</option>
                </select>
              </div>
              
              {/* Audio control */}
              <Button
                variant="secondary"
                size="icon"
                className="rounded-full bg-black/50 hover:bg-black/70 text-white"
                onClick={() => {
                  const newMuted = !isMuted;
                  setIsMuted(newMuted);
                  // Set directly on the DOM element inside the click handler so iOS
                  // considers this a user-gesture context — React's useEffect is
                  // async and iOS Safari blocks audio enabling outside gesture scope.
                  if (videoRef.current) {
                    videoRef.current.muted = newMuted;
                    if (!newMuted) {
                      videoRef.current.play().catch(() => {});
                    }
                  }
                }}
              >
                {isMuted ? (
                  <VolumeX className="w-5 h-5" />
                ) : (
                  <Volume2 className="w-5 h-5" />
                )}
              </Button>
              
              {/* Fullscreen control */}
              <Button
                variant="secondary"
                size="icon"
                className="rounded-full bg-black/50 hover:bg-black/70 text-white"
                onClick={toggleFullscreen}
              >
                {isFullscreen ? (
                  <Minimize className="w-5 h-5" />
                ) : (
                  <Maximize className="w-5 h-5" />
                )}
              </Button>
              
              {/* Picture-in-Picture button */}
              {pipSupported && remoteStream && (
                <Button
                  variant="secondary"
                  size="icon"
                  className={`rounded-full text-white ${
                    isPiP ? 'bg-blue-500/80 hover:bg-blue-600' : 'bg-black/50 hover:bg-black/70'
                  }`}
                  onClick={togglePiP}
                  title={isPiP ? 'Exit picture-in-picture' : 'Pop out — watch while browsing'}
                >
                  <PictureInPicture2 className="w-5 h-5" />
                </Button>
              )}

              {/* Emergency contact button */}
              <Button
                variant="secondary"
                size="icon"
                className="rounded-full bg-red-500/80 hover:bg-red-600 text-white"
                onClick={() => setShowEmergencyDialog(true)}
                title="Report issue to host"
              >
                <HelpCircle className="w-5 h-5" />
              </Button>
            </div>
            
            {/* PiP active banner — shown when popped out */}
            {isPiP && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/80 pointer-events-none">
                <div className="text-center">
                  <PictureInPicture2 className="w-10 h-10 text-blue-400 mx-auto mb-3" />
                  <p className="text-white font-medium">Watching in picture-in-picture</p>
                  <p className="text-gray-400 text-sm mt-1">Stream continues playing in the overlay</p>
                </div>
              </div>
            )}

            {/* Status indicators */}
            <div className={`absolute top-4 right-4 flex items-center gap-2 transition-opacity duration-300 ${
              showControls || !isFullscreen ? 'opacity-100' : 'opacity-0'
            }`}>
              {isDataSaver && (
                <Badge className="bg-orange-500 text-white text-xs">
                  <DataSaver className="w-3 h-3 mr-1" />
                  Data Saver
                </Badge>
              )}
              {isMobile && (
                <Badge variant="outline" className="text-xs">
                  <Smartphone className="w-3 h-3 mr-1" />
                  Mobile
                </Badge>
              )}
            </div>
            
            {/* Click to show controls in fullscreen */}
            {isFullscreen && (
              <div 
                className="absolute inset-0 cursor-default"
                onClick={() => setShowControls(true)}
              />
            )}
          </div>
        </>
      );
    }

    // Stream is live but still connecting — show progressive messages based on wait time
    if (stream.status === "live" || isStreamLive) {
      const isLongWait = connectingSeconds >= 15;
      const isVeryLongWait = connectingSeconds >= 40;
      const autoReloadIn = Math.max(0, 90 - connectingSeconds);

      return (
        <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-gray-950 to-gray-900">
          <div className="text-center max-w-sm mx-auto px-6">

            {/* Icon — changes based on wait time */}
            <div className={`w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-5 border-2 ${
              isVeryLongWait
                ? 'bg-amber-500/20 border-amber-500'
                : 'bg-blue-500/20 border-blue-500'
            }`}>
              {isVeryLongWait ? (
                <Radio className="w-10 h-10 text-amber-400 animate-pulse" />
              ) : (
                <Loader2 className="w-10 h-10 text-blue-400 animate-spin" />
              )}
            </div>

            {/* Title — progressive */}
            <h2 className="text-xl font-bold text-white mb-2">
              {isVeryLongWait
                ? 'Host is reconnecting...'
                : isLongWait
                  ? 'Still connecting...'
                  : 'Joining the stream...'}
            </h2>

            {/* Subtitle — progressive */}
            <p className="text-gray-400 text-sm mb-4">
              {isVeryLongWait
                ? `${hostName} may have refreshed their page. We\'ll reconnect automatically.`
                : isLongWait
                  ? `Taking a bit longer than usual. ${hostName} might be loading.`
                  : 'Please wait while we connect you to the stream.'}
            </p>

            {/* Progress dots / wait indicator */}
            {!isVeryLongWait && (
              <div className="flex items-center justify-center gap-1.5 mb-4">
                {[0,1,2].map(i => (
                  <span key={i} className={`w-2 h-2 rounded-full bg-blue-400 animate-bounce`}
                    style={{ animationDelay: `${i * 0.15}s` }} />
                ))}
              </div>
            )}

            {/* Auto-reload countdown when very long */}
            {isVeryLongWait && (
              <div className="mb-4 text-xs text-gray-500">
                Auto-refreshing in {autoReloadIn}s...
              </div>
            )}

            {/* Error message */}
            {error && (
              <p className="text-xs text-red-400 mb-3">{error}</p>
            )}

            {/* Action buttons — appear after 15s */}
            {isLongWait && (
              <div className="flex flex-col gap-2">
                <Button
                  size="sm"
                  className="gap-2 bg-blue-600 hover:bg-blue-700 text-white"
                  onClick={() => window.location.reload()}
                >
                  <RefreshCw className="w-4 h-4" />
                  Refresh now
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="gap-2 text-gray-400 hover:text-white"
                  onClick={handleRetry}
                >
                  Try different connection
                </Button>
              </div>
            )}

            {/* Wait counter */}
            {connectingSeconds > 5 && (
              <p className="text-xs text-gray-600 mt-3">Waiting {connectingSeconds}s...</p>
            )}
          </div>
        </div>
      );
    }

    // Waiting for host (stream not yet live)
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
            {[0,1,2].map(i => (
              <span key={i} className="w-2 h-2 rounded-full bg-primary/50 animate-bounce"
                style={{ animationDelay: `${i * 0.2}s` }} />
            ))}
          </div>
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
          <form onSubmit={(e) => { e.preventDefault(); joinStream(); }}>
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <Label htmlFor="name">Your Name</Label>
                <Input
                  id="name"
                  placeholder="Enter your name"
                  value={viewerName}
                  onChange={(e) => setViewerName(e.target.value)}
                  required
                />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                className="flex-1"
                onClick={async () => {
                  const guestName = "Guest";
                  setViewerName(guestName);
                  try {
                    await supabase.from("viewers").insert({
                      stream_id: stream.id,
                      name: guestName,
                      joined_at: new Date().toISOString(),
                    });
                  } catch {}
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

      {/* Emergency Contact Dialog */}
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
                  placeholder="e.g., Video not loading, Can't hear audio, Technical problem..."
                  value={emergencyMessage}
                  onChange={(e) => setEmergencyMessage(e.target.value)}
                  className="min-h-[100px] w-full p-3 border rounded-md resize-none"
                  maxLength={500}
                />
                <p className="text-xs text-muted-foreground">
                  {emergencyMessage.length}/500 characters
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                className="flex-1"
                onClick={() => setShowEmergencyDialog(false)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                className="flex-1 bg-red-500 hover:bg-red-600"
                disabled={!emergencyMessage.trim()}
              >
                Send Emergency Message
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Emergency Success Notification */}
      {emergencySent && (
        <div className="fixed top-4 right-4 z-50 bg-green-500 text-white px-4 py-2 rounded-lg shadow-lg flex items-center gap-2">
          <AlertTriangle className="w-4 h-4" />
          Emergency message sent to host
        </div>
      )}

      <div className="min-h-screen bg-background">
        <header className="sticky top-0 z-40 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
          <div className="container mx-auto px-4 py-3 flex items-center justify-between gap-3">
            <Link href="/" className="flex items-center gap-2 shrink-0">
              <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
                <Radio className="w-4 h-4 text-primary-foreground" />
              </div>
              <span className="font-bold text-foreground hidden sm:block">Isunday Stream Live</span>
            </Link>

            <h2 className="text-sm font-medium text-foreground truncate flex-1 text-center hidden md:block">
              {stream.title}
            </h2>

            <div className="flex items-center gap-2 shrink-0">
              {stream.status === "live" && (
                <>
                  <Badge className="bg-red-500 text-white gap-1.5 px-2.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-white animate-ping" />
                    LIVE
                  </Badge>
                  {streamElapsed > 0 && (
                    <span className="text-xs text-muted-foreground font-mono hidden sm:block tabular-nums">
                      {formatElapsed(streamElapsed)}
                    </span>
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

        <main className="container mx-auto px-4 py-6">
          <div className="grid lg:grid-cols-3 gap-6">
            {/* Video Area */}
            <div className="lg:col-span-2 flex flex-col gap-4">
              <Card className="overflow-hidden">
                <CardContent className="p-0">
                  <div ref={videoContainerRef} className={`relative bg-black ${isFullscreen ? 'fixed inset-0 z-50 w-screen h-screen' : 'aspect-video'}`}>
                    {getVideoContent()}
                    {/* isunday brand watermark */}
                    {isStreamLive && isConnected && remoteStream && !isPiP && (
                      <div className="absolute bottom-14 left-3 pointer-events-none select-none z-10">
                        <div className="flex items-center gap-1.5 bg-black/25 backdrop-blur-sm rounded-full px-2.5 py-1 border border-white/10 opacity-60">
                          <div className="w-4 h-4 bg-gradient-to-br from-violet-500 to-purple-700 rounded-full flex items-center justify-center shrink-0">
                            <Radio className="w-2 h-2 text-white" />
                          </div>
                          <span className="text-white text-[10px] font-bold tracking-[0.15em] uppercase" style={{ textShadow: '0 1px 3px rgba(0,0,0,0.7)' }}>
                            isunday
                          </span>
                        </div>
                      </div>
                    )}

                    {/* Unmute prompt — shown when video is playing but muted */}
                    {isMuted && isConnected && remoteStream && (
                      <div
                        className="absolute inset-0 flex items-end justify-center pb-16 pointer-events-none"
                      >
                        <button
                          className="pointer-events-auto bg-black/70 hover:bg-black/90 text-white text-sm px-4 py-2 rounded-full flex items-center gap-2 border border-white/20"
                          onClick={() => setIsMuted(false)}
                        >
                          <VolumeX className="w-4 h-4" />
                          Click to unmute
                        </button>
                      </div>
                    )}
                    {/* Connection status */}
                    <div className="absolute top-4 right-4">
                      {getConnectionStatusBadge()}
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Stream Info */}
              <div className="flex items-start justify-between gap-4 flex-wrap">
                <div className="flex-1 min-w-0">
                  <h1 className="text-lg font-semibold text-foreground truncate md:hidden">{stream.title}</h1>
                  <div className="flex items-center gap-2 flex-wrap mt-1 md:mt-0">
                    <p className="text-sm text-muted-foreground">Hosted by <span className="font-medium text-foreground">{hostName}</span></p>
                    {stream.status === 'live' && streamElapsed > 0 && (
                      <span className="flex items-center gap-1 text-xs text-muted-foreground">
                        <Clock className="w-3 h-3" />
                        {formatElapsed(streamElapsed)}
                      </span>
                    )}
                    {stream.status === 'live' && (
                      <span className="flex items-center gap-1 text-xs text-red-500 font-medium">
                        <Users className="w-3 h-3" />
                        {viewerCount} {viewerCount === 1 ? 'viewer' : 'viewers'}
                      </span>
                    )}
                  </div>
                </div>
                <Button variant="outline" size="sm" onClick={copyShareLink} className="shrink-0">
                  {copied ? "Copied!" : (<><Share2 className="w-4 h-4 mr-2" />Share</>)}
                </Button>
              </div>
            </div>

            {/* Chat Panel */}
            <Card className="lg:col-span-1 flex flex-col h-[380px] sm:h-[480px] lg:h-[calc(100vh-11rem)] lg:sticky lg:top-20">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <MessageCircle className="w-4 h-4" />
                  Live Chat
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={refreshChat}
                    disabled={isRefreshingChat}
                    className="ml-auto h-8 w-8 p-0"
                    title="Refresh chat messages"
                  >
                    <RefreshCw className={`w-4 h-4 ${isRefreshingChat ? 'animate-spin' : ''}`} />
                  </Button>
                  {hasJoined && viewerName !== "Guest" && (
                    <Badge variant="secondary" className="text-xs">
                      {viewerName}
                    </Badge>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent className="flex-1 min-h-0 flex flex-col p-0">
                <ScrollArea className="flex-1 min-h-0 px-4">
                  <div className="flex flex-col gap-2 py-2 w-full">
                    {messages.length === 0 ? (
                      <p className="text-sm text-muted-foreground text-center py-8">
                        No messages yet. Be the first to say something!
                      </p>
                    ) : (
                      messages.map((msg) => {
                        const isEmergency = msg.sender_name?.startsWith('SYSTEM -') || msg.message?.startsWith('EMERGENCY:');
                        const isOwn = msg.sender_name === viewerName;
                        return (
                          <div key={msg.id} className={`w-full overflow-hidden flex flex-col gap-0.5 rounded-lg px-2 py-1.5 ${
                            isEmergency ? 'bg-red-500/10 border border-red-500/20' :
                            isOwn ? 'bg-primary/5 border border-primary/10' : 'bg-muted/40'
                          }`}>
                            <div className="flex items-center gap-1.5 min-w-0">
                              <span className={`text-xs font-semibold truncate max-w-[120px] shrink ${
                                isEmergency ? 'text-red-500' :
                                isOwn ? 'text-primary' :
                                getNameColor(msg.sender_name)
                              }`}>
                                {isEmergency ? '\uD83D\uDEA8 Alert' : isOwn ? `${msg.sender_name} (you)` : msg.sender_name}
                              </span>
                              <span className="text-xs text-muted-foreground whitespace-nowrap shrink-0">
                                {new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                              </span>
                            </div>
                            <p className={`text-sm [overflow-wrap:anywhere] leading-snug ${
                              isEmergency ? 'text-red-400 font-medium' : 'text-foreground/80'
                            }`}>
                              {isEmergency ? msg.message.replace('EMERGENCY: ', '') : msg.message}
                            </p>
                          </div>
                        );
                      })
                    )}
                    <div ref={messagesEndRef} />
                  </div>
                </ScrollArea>
                <form
                  onSubmit={sendMessage}
                  className="shrink-0 p-4 border-t border-border"
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
