"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { useCohostStream } from "@/lib/webrtc/use-cohost-stream";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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

  const {
    mediaStream,
    initializeMedia,
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

  // Keep video element in sync
  useEffect(() => {
    if (videoRef.current && mediaStream) videoRef.current.srcObject = mediaStream;
  }, [mediaStream]);

  const rotateCamera = async () => {
    if (isSwitching) return;
    setIsSwitching(true);
    const next = cameraFacingMode === "environment" ? "user" : "environment";
    setCameraFacingMode(next);
    const newStream = await switchCamera(next);
    if (newStream && videoRef.current) videoRef.current.srcObject = newStream;
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

      <main className="flex-1 flex flex-col items-center justify-center p-4 gap-4">
        {/* Camera Preview */}
        <div className="relative w-full max-w-lg aspect-video bg-black rounded-xl overflow-hidden shadow-lg">
          <video
            ref={videoRef}
            autoPlay
            muted
            playsInline
            className="w-full h-full object-cover"
          />
          {!mediaInitialized && (
            <div className="absolute inset-0 flex items-center justify-center text-white/60 text-sm">
              Starting camera…
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
              <p className="text-xs text-destructive mb-3">{error}</p>
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

              <Button variant="outline" size="icon" onClick={toggleVideo} title="Toggle camera">
                {videoEnabled ? <Video className="w-4 h-4" /> : <VideoOff className="w-4 h-4" />}
              </Button>
              <Button variant="outline" size="icon" onClick={toggleAudio} title="Toggle mic">
                {audioEnabled ? <Mic className="w-4 h-4" /> : <MicOff className="w-4 h-4" />}
              </Button>
              <Button variant="outline" size="icon" onClick={rotateCamera} disabled={isSwitching} title="Flip camera">
                <SwitchCamera className={`w-4 h-4 ${isSwitching ? "animate-spin" : ""}`} />
              </Button>
            </div>

            {isStreaming && (
              <div className="mt-3 flex items-center justify-center gap-2 text-xs text-muted-foreground">
                <Wifi className="w-3 h-3 text-green-500" />
                Broadcasting on isolated channel · {viewerCount} watching your feed
              </div>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
