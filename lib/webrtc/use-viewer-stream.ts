"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { RealtimeChannel } from "@supabase/supabase-js";
import { ICE_SERVERS, SignalMessage, RECONNECT_ATTEMPTS, RECONNECT_DELAY } from "./config";
import { nanoid } from "nanoid";

interface UseViewerStreamProps {
  streamId: string;
  roomCode: string;
  viewerName: string;
  onStreamEnd?: () => void;
}

export function useViewerStream({
  streamId,
  roomCode,
  viewerName,
  onStreamEnd,
}: UseViewerStreamProps) {
  const [isConnected, setIsConnected] = useState(false);
  const [isStreamLive, setIsStreamLive] = useState(false);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hostVideoEnabled, setHostVideoEnabled] = useState(true);
  const [hostAudioEnabled, setHostAudioEnabled] = useState(true);
  const [connectionState, setConnectionState] = useState<RTCPeerConnectionState>("new");
  const [reconnectAttempts, setReconnectAttempts] = useState(0);

  const viewerIdRef = useRef<string>(nanoid(10));
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const joinStreamRef = useRef<() => void>(() => {});
  const supabase = createClient();

  // Handle incoming signals
  const handleSignal = useCallback(
    async (message: SignalMessage) => {
      // Only process messages meant for this viewer or broadcast messages
      if (message.to && message.to !== viewerIdRef.current) return;

      switch (message.type) {
        case "offer": {
          console.log("[v0] Received offer from host");
          
          if (!peerConnectionRef.current) {
            // Create peer connection if not exists
            const pc = new RTCPeerConnection(ICE_SERVERS);
            
            pc.ontrack = (event) => {
              console.log("[v0] Received track:", event.track.kind);
              const stream = event.streams[0];
              if (stream) {
                setRemoteStream(stream);
                setIsConnected(true);
              }
            };

            pc.onicecandidate = (event) => {
              if (event.candidate && channelRef.current) {
                const signalMessage: SignalMessage = {
                  type: "ice-candidate",
                  from: viewerIdRef.current,
                  to: "host",
                  payload: event.candidate.toJSON(),
                };
                channelRef.current.send({
                  type: "broadcast",
                  event: "signal",
                  payload: signalMessage,
                });
              }
            };

            pc.onconnectionstatechange = () => {
              console.log("[v0] Viewer connection state:", pc.connectionState);
              setConnectionState(pc.connectionState);
              
              if (pc.connectionState === "connected") {
                setIsConnected(true);
                setError(null);
                setReconnectAttempts(0);
              } else if (
                pc.connectionState === "disconnected" ||
                pc.connectionState === "failed"
              ) {
                setIsConnected(false);
                
                // Try to reconnect
                if (reconnectAttempts < RECONNECT_ATTEMPTS) {
                  setError(`Connection lost. Reconnecting... (${reconnectAttempts + 1}/${RECONNECT_ATTEMPTS})`);
                  reconnectTimeoutRef.current = setTimeout(() => {
                    setReconnectAttempts((prev) => prev + 1);
                    // Close old connection and rejoin
                    if (peerConnectionRef.current) {
                      peerConnectionRef.current.close();
                      peerConnectionRef.current = null;
                    }
                    joinStreamRef.current();
                  }, RECONNECT_DELAY);
                } else {
                  setError("Connection failed. Please refresh the page to try again.");
                }
              }
            };

            pc.oniceconnectionstatechange = () => {
              console.log("[v0] Viewer ICE state:", pc.iceConnectionState);
            };

            peerConnectionRef.current = pc;
          }

          try {
            await peerConnectionRef.current.setRemoteDescription(
              new RTCSessionDescription(message.payload as RTCSessionDescriptionInit)
            );

            const answer = await peerConnectionRef.current.createAnswer();
            await peerConnectionRef.current.setLocalDescription(answer);

            const answerMessage: SignalMessage = {
              type: "answer",
              from: viewerIdRef.current,
              to: "host",
              payload: peerConnectionRef.current.localDescription?.toJSON(),
            };

            channelRef.current?.send({
              type: "broadcast",
              event: "signal",
              payload: answerMessage,
            });
          } catch (err) {
            console.error("[v0] Error handling offer:", err);
            setError("Failed to connect to stream");
          }
          break;
        }

        case "ice-candidate": {
          if (peerConnectionRef.current && message.payload) {
            try {
              await peerConnectionRef.current.addIceCandidate(
                new RTCIceCandidate(message.payload as RTCIceCandidateInit)
              );
            } catch (err) {
              console.error("[v0] Error adding ICE candidate:", err);
            }
          }
          break;
        }

        case "stream-start": {
          setIsStreamLive(true);
          // Request to join the stream
          joinStream();
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
          const payload = message.payload as { video?: boolean; audio?: boolean };
          if (payload.video !== undefined) {
            setHostVideoEnabled(payload.video);
          }
          if (payload.audio !== undefined) {
            setHostAudioEnabled(payload.audio);
          }
          break;
        }
      }
    },
    [onStreamEnd]
  );

  // Join stream
  const joinStream = useCallback(() => {
    if (!channelRef.current) return;

    const joinMessage: SignalMessage = {
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
      const leaveMessage: SignalMessage = {
        type: "viewer-leave",
        from: viewerIdRef.current,
        to: "host",
      };

      channelRef.current.send({
        type: "broadcast",
        event: "signal",
        payload: leaveMessage,
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
        handleSignal(payload as SignalMessage);
      })
      .subscribe(async (status: any) => {
        console.log("[v0] Viewer channel status:", status);
        if (status === "SUBSCRIBED") {
          // Check if stream is already live
          const { data: stream } = await supabase
            .from("streams")
            .select("status")
            .eq("id", streamId)
            .single();

          if (stream?.status === "live") {
            setIsStreamLive(true);
            // Wait a moment then join
            setTimeout(joinStream, 500);
          }
        }
      });

    channelRef.current = channel;

    return () => {
      leaveStream();
      supabase.removeChannel(channel);
    };
  }, [roomCode, streamId, handleSignal, joinStream, leaveStream, supabase]);

  // Update viewer record in database
  useEffect(() => {
    let viewerRecordId: string | null = null;

    const trackViewer = async () => {
      const { data } = await supabase
        .from("viewers")
        .insert({
          stream_id: streamId,
          viewer_name: viewerName,
        })
        .select()
        .single();

      if (data) {
        viewerRecordId = data.id;
      }
    };

    if (viewerName) {
      trackViewer();
    }

    return () => {
      if (viewerRecordId) {
        supabase
          .from("viewers")
          .update({ left_at: new Date().toISOString() })
          .eq("id", viewerRecordId);
      }
    };
  }, [streamId, viewerName, supabase]);

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
