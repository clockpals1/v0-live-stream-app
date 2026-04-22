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
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isDataSaver, setIsDataSaver] = useState(false);
  const [videoQuality, setVideoQuality] = useState<'auto' | 'high' | 'medium' | 'low'>('auto');
  const [showControls, setShowControls] = useState(true);
  const [isMobile, setIsMobile] = useState(false);
  const [showEmergencyDialog, setShowEmergencyDialog] = useState(false);
  const [emergencyMessage, setEmergencyMessage] = useState("");
  const [emergencySent, setEmergencySent] = useState(false);
  const [isRefreshingChat, setIsRefreshingChat] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const supabase = createClient();

  const handleStreamEnd = useCallback(() => {
    setStream((prev) => ({ ...prev, status: "ended" }));
  }, []);

  // Always use the simple stream hook for reliability
  const streamHook = useSimpleStream({
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
    isStreamPaused,
  } = streamHook;

  // Handle connection errors and retry logic
  useEffect(() => {
    if (error) {
      console.log("Connection error detected:", error);
      setRetryCount(prev => prev + 1);
    }
  }, [error, retryCount]);

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
    console.log('[Viewer] Setting up chat subscription for stream:', stream.id);
    
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
          console.log('[Viewer] New chat message received:', payload.new);
          setMessages((prev) => [...prev, payload.new as ChatMessage]);
        }
      )
      .subscribe((status) => {
        console.log('[Viewer] Chat subscription status:', status);
        
        if (status === 'SUBSCRIBED') {
          console.log('[Viewer] Chat channel subscribed successfully');
          // Load existing messages after subscription
          loadExistingMessages();
        } else if (status === 'CHANNEL_ERROR') {
          console.error('[Viewer] Chat channel error, retrying...');
          setTimeout(() => {
            // Retry setup
          }, 2000);
        }
      });

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
    };
  }, [stream.id, supabase]);

  // Subscribe to viewer count
  useEffect(() => {
    console.log('[Viewer] Setting up viewer count subscription for stream:', stream.id);
    
    // Load initial viewer count
    loadViewerCount();
    
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
        (payload) => {
          console.log('[Viewer] Viewer table changed:', payload);
          // Reload viewer count on any change
          loadViewerCount();
        }
      )
      .subscribe((status) => {
        console.log('[Viewer] Viewer count subscription status:', status);
        
        if (status === 'SUBSCRIBED') {
          console.log('[Viewer] Viewer count channel subscribed successfully');
        } else if (status === 'CHANNEL_ERROR') {
          console.error('[Viewer] Viewer count channel error, retrying...');
          setTimeout(() => {
            loadViewerCount();
          }, 2000);
        }
      });

    const loadViewerCount = async () => {
      try {
        console.log('[Viewer] Loading viewer count...');
        const { count, error } = await supabase
          .from("viewers")
          .select("*", { count: "exact", head: true })
          .eq("stream_id", stream.id)
          .is("left_at", null);

        if (error) {
          console.error('[Viewer] Error loading viewer count:', error);
        } else {
          console.log('[Viewer] Viewer count loaded:', count);
          setViewerCount(count || 0);
        }
      } catch (error) {
        console.error('[Viewer] Exception loading viewer count:', error);
      }
    };

    return () => {
      console.log('[Viewer] Cleaning up viewer count channel');
      supabase.removeChannel(channel);
    };
  }, [stream.id, supabase]);

  // Auto-scroll chat
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const joinStream = async () => {
    if (!viewerName.trim()) return;
    
    try {
      // Register viewer in database
      await supabase.from("viewers").insert({
        stream_id: stream.id,
        viewer_name: viewerName.trim(),
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

    await supabase.from("chat_messages").insert({
      stream_id: stream.id,
      sender_name: viewerName,
      message: newMessage.trim(),
    });

    setNewMessage("");
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

  const formatDuration = (startedAt: string | null, endedAt: string | null): string => {
    if (!startedAt) return 'unknown time';
    
    const start = new Date(startedAt);
    const end = endedAt ? new Date(endedAt) : new Date();
    const duration = Math.floor((end.getTime() - start.getTime()) / 1000);
    
    if (duration < 60) return `${duration} seconds`;
    if (duration < 3600) return `${Math.floor(duration / 60)} minutes`;
    return `${Math.floor(duration / 3600)}h ${Math.floor((duration % 3600) / 60)}m`;
  };

  const toggleFullscreen = async () => {
    try {
      const element = document.documentElement;
      
      if (!isFullscreen) {
        // Enter fullscreen
        console.log('[Viewer] Attempting to enter fullscreen');
        
        // Try different fullscreen methods
        const fullscreenMethods = [
          () => element.requestFullscreen(),
          () => (element as any).webkitRequestFullscreen(),
          () => (element as any).mozRequestFullScreen(),
          () => (element as any).msRequestFullscreen(),
        ];
        
        for (const method of fullscreenMethods) {
          try {
            await method();
            console.log('[Viewer] Fullscreen entered successfully');
            return;
          } catch (err) {
            console.log('[Viewer] Method failed, trying next:', err);
            continue;
          }
        }
        
        console.warn('[Viewer] Fullscreen not supported on this browser');
      } else {
        // Exit fullscreen
        console.log('[Viewer] Attempting to exit fullscreen');
        
        // Try different exit methods
        const exitMethods = [
          () => document.exitFullscreen(),
          () => (document as any).webkitExitFullscreen(),
          () => (document as any).mozCancelFullScreen(),
          () => (document as any).msExitFullscreen(),
        ];
        
        for (const method of exitMethods) {
          try {
            await method();
            console.log('[Viewer] Fullscreen exited successfully');
            return;
          } catch (err) {
            console.log('[Viewer] Exit method failed, trying next:', err);
            continue;
          }
        }
      }
    } catch (error) {
      console.error('[Viewer] Fullscreen toggle error:', error);
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

    // Add all fullscreen event listeners
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
    document.addEventListener('mozfullscreenchange', handleFullscreenChange);
    document.addEventListener('MSFullscreenChange', handleFullscreenChange);
    
    document.addEventListener('fullscreenerror', handleFullscreenError);
    document.addEventListener('webkitfullscreenerror', handleFullscreenError);
    document.addEventListener('mozfullscreenerror', handleFullscreenError);

    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      document.removeEventListener('webkitfullscreenchange', handleFullscreenChange);
      document.removeEventListener('mozfullscreenchange', handleFullscreenChange);
      document.removeEventListener('MSFullscreenChange', handleFullscreenChange);
      
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
              style={{
                transform: 'scaleX(-1)', // Mirror video for more natural feel
              }}
            />
            
            {/* Loading overlay */}
            <div className="absolute inset-0 flex items-center justify-center bg-black/50 pointer-events-none opacity-0 transition-opacity duration-300" id="video-loading">
              <div className="text-center">
                <Loader2 className="w-12 h-12 text-white animate-spin mx-auto mb-2" />
                <p className="text-white text-sm">Loading stream...</p>
              </div>
            </div>
            
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
                onClick={() => setIsMuted(!isMuted)}
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
