"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { RealtimeChannel } from "@supabase/supabase-js";

interface UseSimpleStreamProps {
  streamId: string;
  roomCode: string;
  viewerName: string;
  onStreamEnd?: () => void;
}

export function useSimpleStream({
  streamId,
  roomCode,
  viewerName,
  onStreamEnd,
}: UseSimpleStreamProps) {
  const [isConnected, setIsConnected] = useState(false);
  const [isStreamLive, setIsStreamLive] = useState(false);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hostVideoEnabled, setHostVideoEnabled] = useState(true);
  const [hostAudioEnabled, setHostAudioEnabled] = useState(true);
  const [connectionState, setConnectionState] = useState<string>("new");
  const [reconnectAttempts, setReconnectAttempts] = useState(0);

  const viewerIdRef = useRef<string>(Math.random().toString(36).substr(2, 9));
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const joinStreamRef = useRef<() => void>(() => {});
  const supabase = createClient();

  // Simplified ICE servers with public STUN only
  const SIMPLE_ICE_SERVERS: RTCConfiguration = {
    iceServers: [
      { urls: "stun:stun.l.google.com:19302" },
      { urls: "stun:stun1.l.google.com:19302" },
    ]
  };

  // Handle incoming signals
  const handleSignal = useCallback(
    async (message: any) => {
      if (message.to && message.to !== viewerIdRef.current) return;

      switch (message.type) {
        case "offer": {
          console.log("[simple] Received offer from host");
          
          // Close existing connection
          if (peerConnectionRef.current) {
            peerConnectionRef.current.close();
            peerConnectionRef.current = null;
          }
          
          const pc = new RTCPeerConnection(SIMPLE_ICE_SERVERS);
          
          pc.ontrack = (event) => {
            console.log("[simple] Received track:", event.track.kind);
            if (event.streams.length > 0) {
              const stream = event.streams[0];
              setRemoteStream(stream);
              setIsConnected(true);
              setError(null);
            }
          };

          pc.onicecandidate = (event) => {
            if (event.candidate && channelRef.current) {
              channelRef.current.send({
                type: "broadcast",
                event: "signal",
                payload: {
                  type: "ice-candidate",
                  from: viewerIdRef.current,
                  to: "host",
                  payload: event.candidate.toJSON(),
                },
              });
            }
          };

          pc.onconnectionstatechange = () => {
            console.log("[simple] Connection state:", pc.connectionState);
            setConnectionState(pc.connectionState);
            
            if (pc.connectionState === "connected") {
              setIsConnected(true);
              setError(null);
              setReconnectAttempts(0);
            } else if (pc.connectionState === "failed") {
              setIsConnected(false);
              setRemoteStream(null);
              setError("Connection failed. Trying alternative method...");
              
              // Try alternative connection method
              setTimeout(() => {
                attemptAlternativeConnection();
              }, 2000);
            }
          };

          peerConnectionRef.current = pc;

          try {
            await pc.setRemoteDescription(new RTCSessionDescription(message.payload));
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);

            channelRef.current?.send({
              type: "broadcast",
              event: "signal",
              payload: {
                type: "answer",
                from: viewerIdRef.current,
                to: "host",
                payload: pc.localDescription?.toJSON(),
              },
            });
          } catch (err) {
            console.error("[simple] Error handling offer:", err);
            setError("Connection failed. Please refresh the page.");
          }
          break;
        }

        case "ice-candidate": {
          if (peerConnectionRef.current && message.payload) {
            try {
              await peerConnectionRef.current.addIceCandidate(
                new RTCIceCandidate(message.payload)
              );
            } catch (err) {
              console.error("[simple] Error adding ICE candidate:", err);
            }
          }
          break;
        }

        case "stream-start": {
          console.log("[simple] Stream started");
          setIsStreamLive(true);
          setError(null);
          setTimeout(() => joinStream(), 500);
          break;
        }

        case "stream-end": {
          setIsStreamLive(false);
          setIsConnected(false);
          setRemoteStream(null);
          onStreamEnd?.();
          break;
        }

        case "track-toggle": {
          const payload = message.payload;
          if (payload.video !== undefined) {
            setHostVideoEnabled(payload.video);
          }
          if (payload.audio !== undefined) {
            setHostAudioEnabled(payload.audio);
          }
          break;
        }

        case "stream-pause": {
          console.log("[simple] Stream paused by host");
          // Handle stream pause - could show a pause indicator
          break;
        }

        case "stream-resume": {
          console.log("[simple] Stream resumed by host");
          // Handle stream resume - hide pause indicator
          break;
        }
      }
    },
    [onStreamEnd]
  );

  // Alternative connection attempt
  const attemptAlternativeConnection = useCallback(() => {
    console.log("[simple] Trying alternative connection method");
    setError("Attempting alternative connection...");
    
    // Try to reconnect with a new viewer ID
    viewerIdRef.current = Math.random().toString(36).substr(2, 9);
    setTimeout(() => {
      joinStream();
    }, 1000);
  }, []);

  // Join stream
  const joinStream = useCallback(() => {
    if (!channelRef.current) return;

    const joinMessage = {
      type: "viewer-join",
      from: viewerIdRef.current,
      to: "host",
      viewerName: viewerName,
    };

    channelRef.current.send({
      type: "broadcast",
      event: "signal",
      payload: joinMessage,
    });
  }, [viewerName]);

  // Leave stream
  const leaveStream = useCallback(() => {
    if (channelRef.current) {
      channelRef.current.send({
        type: "broadcast",
        event: "signal",
        payload: {
          type: "viewer-leave",
          from: viewerIdRef.current,
          to: "host",
        },
      });
    }

    if (peerConnectionRef.current) {
      peerConnectionRef.current.close();
      peerConnectionRef.current = null;
    }

    setIsConnected(false);
    setRemoteStream(null);
  }, []);

  // Set up signaling channel
  useEffect(() => {
    const channel = supabase.channel(`stream-signal-${roomCode}`, {
      config: {
        broadcast: { self: false },
      },
    });

    channel
      .on("broadcast", { event: "signal" }, ({ payload }: { payload: any }) => {
        handleSignal(payload);
      })
      .subscribe(async (status: any) => {
        console.log("[simple] Channel status:", status);
        if (status === "SUBSCRIBED") {
          // Check if stream is already live
          const { data: stream } = await supabase
            .from("streams")
            .select("status")
            .eq("id", streamId)
            .single();

          if (stream?.status === "live") {
            setIsStreamLive(true);
            setTimeout(joinStream, 1000);
          } else if (stream?.status === "ended") {
            setError("This stream has ended");
          } else {
            setError("Waiting for stream to start...");
          }
        }
      });

    channelRef.current = channel;
    joinStreamRef.current = joinStream;

    return () => {
      leaveStream();
      supabase.removeChannel(channel);
    };
  }, [roomCode, streamId, handleSignal, joinStream, leaveStream, supabase]);

  return {
    viewerId: viewerIdRef.current,
    isConnected,
    isStreamLive,
    remoteStream,
    error,
    hostVideoEnabled,
    hostAudioEnabled,
    connectionState,
    joinStream,
    leaveStream,
  };
}
