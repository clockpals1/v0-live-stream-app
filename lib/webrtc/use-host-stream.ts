"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { RealtimeChannel } from "@supabase/supabase-js";
import { ICE_SERVERS, SignalMessage, HOST_MEDIA_CONSTRAINTS, MAX_VIEWERS } from "./config";

interface ViewerConnection {
  id: string;
  name: string;
  peerConnection: RTCPeerConnection;
  connected: boolean;
  audioSender?: RTCRtpSender;
}

interface UseHostStreamProps {
  streamId: string;
  roomCode: string;
}

export function useHostStream({ streamId, roomCode }: UseHostStreamProps) {
  const [isStreaming, setIsStreaming] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [videoEnabled, setVideoEnabled] = useState(true);
  const [audioEnabled, setAudioEnabled] = useState(true);
  const [viewerCount, setViewerCount] = useState(0);
  const [viewers, setViewers] = useState<Map<string, ViewerConnection>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [recordedChunks, setRecordedChunks] = useState<Blob[]>([]);

  const mediaStreamRef = useRef<MediaStream | null>(null);
  const activeRelayStreamRef = useRef<MediaStream | null>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const viewersRef = useRef<Map<string, ViewerConnection>>(new Map());
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const supabaseRef = useRef(createClient());
  const supabase = supabaseRef.current;

  // Initialize media stream
  const initializeMedia = useCallback(async (facingMode: 'user' | 'environment' = 'environment') => {
    try {
      const constraints: MediaStreamConstraints = {
        ...HOST_MEDIA_CONSTRAINTS,
        video: {
          ...(HOST_MEDIA_CONSTRAINTS.video as MediaTrackConstraints),
          facingMode,
        },
      };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      mediaStreamRef.current = stream;
      return stream;
    } catch (err) {
      console.error("[v0] Error getting user media:", err);
      setError("Failed to access camera/microphone. Please check permissions.");
      throw err;
    }
  }, []);

  // Create peer connection for a viewer
  const createPeerConnection = useCallback(
    async (viewerId: string, viewerName: string) => {
      if (viewersRef.current.size >= MAX_VIEWERS) {
        console.log("[v0] Max viewers reached, rejecting:", viewerId);
        return null;
      }

      const pc = new RTCPeerConnection(ICE_SERVERS);

      // Add tracks — use relay (co-host) stream if active, else own camera
      const sourceStream = activeRelayStreamRef.current ?? mediaStreamRef.current;
      let audioSenderRef: RTCRtpSender | undefined;
      if (sourceStream) {
        sourceStream.getTracks().forEach((track) => {
          const s = pc.addTrack(track, sourceStream);
          if (track.kind === "audio") audioSenderRef = s;
        });
      }
      // Guarantee an audio transceiver always exists so replaceTrack() can relay
      // co-host audio even when the admin's own stream captured no microphone.
      // IMPORTANT: pass streams:[sourceStream] so the receiver's ontrack fires with
      // event.streams[0] containing the audio track — without this event.streams is
      // empty, the viewer's handler skips it, and audio never enters remoteStream.
      if (!audioSenderRef) {
        const at = pc.addTransceiver("audio", {
          direction: "sendonly",
          streams: sourceStream ? [sourceStream] : [],
        });
        audioSenderRef = at.sender;
      }

      // Handle ICE candidates
      pc.onicecandidate = (event) => {
        if (event.candidate && channelRef.current) {
          const message: SignalMessage = {
            type: "ice-candidate",
            from: "host",
            to: viewerId,
            payload: event.candidate.toJSON(),
          };
          channelRef.current.send({
            type: "broadcast",
            event: "signal",
            payload: message,
          });
        }
      };

      // Handle connection state changes
      pc.onconnectionstatechange = () => {
        console.log(`[v0] Connection state for ${viewerId}:`, pc.connectionState);
        if (pc.connectionState === "connected") {
          const viewer = viewersRef.current.get(viewerId);
          if (viewer) {
            viewer.connected = true;
            viewersRef.current.set(viewerId, viewer);
            setViewers(new Map(viewersRef.current));
            setViewerCount(viewersRef.current.size);
          }
        } else if (
          pc.connectionState === "disconnected" ||
          pc.connectionState === "failed" ||
          pc.connectionState === "closed"
        ) {
          removeViewer(viewerId);
        }
      };

      pc.oniceconnectionstatechange = () => {
        console.log(`[v0] ICE state for ${viewerId}:`, pc.iceConnectionState);
      };

      const viewerConnection: ViewerConnection = {
        id: viewerId,
        name: viewerName,
        peerConnection: pc,
        connected: false,
        audioSender: audioSenderRef,
      };

      viewersRef.current.set(viewerId, viewerConnection);
      setViewers(new Map(viewersRef.current));

      return pc;
    },
    []
  );

  // Remove a viewer
  const removeViewer = useCallback((viewerId: string) => {
    const viewer = viewersRef.current.get(viewerId);
    if (viewer) {
      viewer.peerConnection.close();
      viewersRef.current.delete(viewerId);
      setViewers(new Map(viewersRef.current));
      setViewerCount(viewersRef.current.size);
    }
  }, []);

  // Handle incoming signals
  const handleSignal = useCallback(
    async (message: SignalMessage) => {
      if (message.to && message.to !== "host") return;

      switch (message.type) {
        case "viewer-join": {
          console.log("[v0] Viewer joining:", message.from, message.viewerName);
          
          if (viewersRef.current.size >= MAX_VIEWERS) {
            console.log("[v0] Max viewers reached");
            return;
          }

          const pc = await createPeerConnection(message.from, message.viewerName || "Anonymous");
          if (!pc) return;

          // Create and send offer
          try {
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);

            const signalMessage: SignalMessage = {
              type: "offer",
              from: "host",
              to: message.from,
              payload: pc.localDescription?.toJSON(),
            };

            channelRef.current?.send({
              type: "broadcast",
              event: "signal",
              payload: signalMessage,
            });
          } catch (err) {
            console.error("[v0] Error creating offer:", err);
          }
          break;
        }

        case "answer": {
          const viewer = viewersRef.current.get(message.from);
          if (viewer && message.payload) {
            try {
              await viewer.peerConnection.setRemoteDescription(
                new RTCSessionDescription(message.payload as RTCSessionDescriptionInit)
              );
            } catch (err) {
              console.error("[v0] Error setting remote description:", err);
            }
          }
          break;
        }

        case "ice-candidate": {
          const viewer = viewersRef.current.get(message.from);
          if (viewer && message.payload) {
            try {
              await viewer.peerConnection.addIceCandidate(
                new RTCIceCandidate(message.payload as RTCIceCandidateInit)
              );
            } catch (err) {
              console.error("[v0] Error adding ICE candidate:", err);
            }
          }
          break;
        }

        case "viewer-leave": {
          removeViewer(message.from);
          break;
        }
      }
    },
    [createPeerConnection, removeViewer]
  );

  // Start streaming
  const startStream = useCallback(async () => {
    try {
      // Make sure media is initialized
      if (!mediaStreamRef.current) {
        await initializeMedia();
      }

      // Update stream status in database
      await supabase
        .from("streams")
        .update({ status: "live", started_at: new Date().toISOString() })
        .eq("id", streamId);

      // Start recording
      if (mediaStreamRef.current) {
        try {
          const mediaRecorder = new MediaRecorder(mediaStreamRef.current, {
            mimeType: "video/webm;codecs=vp9,opus",
          });

          mediaRecorder.ondataavailable = (event) => {
            if (event.data.size > 0) {
              setRecordedChunks((prev) => [...prev, event.data]);
            }
          };

          mediaRecorderRef.current = mediaRecorder;
          mediaRecorder.start(1000);
          setIsRecording(true);
        } catch (err) {
          console.error("[v0] Recording not supported:", err);
        }
      }

      // Broadcast stream start to all viewers
      channelRef.current?.send({
        type: "broadcast",
        event: "signal",
        payload: { type: "stream-start", from: "host" } as SignalMessage,
      });

      setIsStreaming(true);
      setError(null);
    } catch (err) {
      console.error("[v0] Error starting stream:", err);
      setError("Failed to start stream");
    }
  }, [streamId, initializeMedia, supabase]);

  // Stop streaming
  const stopStream = useCallback(async () => {
    // Stop recording
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }

    // Close all peer connections
    viewersRef.current.forEach((viewer) => {
      viewer.peerConnection.close();
    });
    viewersRef.current.clear();
    setViewers(new Map());
    setViewerCount(0);

    // Update stream status
    await supabase
      .from("streams")
      .update({ status: "ended", ended_at: new Date().toISOString() })
      .eq("id", streamId);

    // Broadcast stream end
    channelRef.current?.send({
      type: "broadcast",
      event: "signal",
      payload: { type: "stream-end", from: "host" } as SignalMessage,
    });

    setIsStreaming(false);
    setIsPaused(false);
  }, [streamId, isRecording, supabase]);

  // Pause streaming
  const pauseStream = useCallback(async () => {
    if (!isStreaming || isPaused) return;

    // Pause recording
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.pause();
    }

    // Disable video tracks to save bandwidth
    if (mediaStreamRef.current) {
      const videoTrack = mediaStreamRef.current.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.enabled = false;
      }
    }

    // Broadcast pause signal to viewers
    channelRef.current?.send({
      type: "broadcast",
      event: "signal",
      payload: { type: "stream-pause", from: "host" } as SignalMessage,
    });

    setIsPaused(true);
  }, [isStreaming, isPaused, isRecording]);

  // Resume streaming
  const resumeStream = useCallback(async () => {
    if (!isStreaming || !isPaused) return;

    // Resume recording
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.resume();
    }

    // Re-enable video tracks
    if (mediaStreamRef.current) {
      const videoTrack = mediaStreamRef.current.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.enabled = videoEnabled;
      }
    }

    // Broadcast resume signal to viewers
    channelRef.current?.send({
      type: "broadcast",
      event: "signal",
      payload: { type: "stream-resume", from: "host" } as SignalMessage,
    });

    setIsPaused(false);
  }, [isStreaming, isPaused, isRecording, videoEnabled]);

  // Toggle video
  const toggleVideo = useCallback(() => {
    if (mediaStreamRef.current) {
      const videoTrack = mediaStreamRef.current.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.enabled = !videoTrack.enabled;
        setVideoEnabled(videoTrack.enabled);

        // Notify viewers
        channelRef.current?.send({
          type: "broadcast",
          event: "signal",
          payload: {
            type: "track-toggle",
            from: "host",
            payload: { video: videoTrack.enabled },
          } as SignalMessage,
        });
      }
    }
  }, []);

  // Toggle audio
  const toggleAudio = useCallback(() => {
    if (mediaStreamRef.current) {
      const audioTrack = mediaStreamRef.current.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        setAudioEnabled(audioTrack.enabled);

        // Notify viewers
        channelRef.current?.send({
          type: "broadcast",
          event: "signal",
          payload: {
            type: "track-toggle",
            from: "host",
            payload: { audio: audioTrack.enabled },
          } as SignalMessage,
        });
      }
    }
  }, []);

  // Switch camera (front/rear) — replaces track in all active peer connections
  const switchCamera = useCallback(async (facingMode: 'user' | 'environment') => {
    try {
      const newVideoStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
        audio: false,
      });

      const newVideoTrack = newVideoStream.getVideoTracks()[0];
      if (!newVideoTrack) return null;

      // Replace track in all active peer connections — no renegotiation needed
      const replaces: Promise<void>[] = [];
      viewersRef.current.forEach((viewer) => {
        const sender = viewer.peerConnection.getSenders().find((s) => s.track?.kind === 'video');
        if (sender) replaces.push(sender.replaceTrack(newVideoTrack));
      });
      await Promise.allSettled(replaces);

      // Update mediaStreamRef: stop old video track, swap in new one
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getVideoTracks().forEach((t) => {
          t.stop();
          mediaStreamRef.current!.removeTrack(t);
        });
        mediaStreamRef.current.addTrack(newVideoTrack);
      } else {
        mediaStreamRef.current = newVideoStream;
      }

      return mediaStreamRef.current;
    } catch (err) {
      console.error('[v0] Error switching camera:', err);
      setError('Could not switch camera. Please check camera permissions.');
      return null;
    }
  }, []);

  // Relay a remote stream to all existing viewer connections via replaceTrack().
  // Pass null to restore the admin's own camera on all connections.
  const relayStream = useCallback((remoteStream: MediaStream | null) => {
    const ownStream = mediaStreamRef.current;
    viewersRef.current.forEach((viewer) => {
      viewer.peerConnection.getSenders().forEach((sender) => {
        // Resolve kind: use track.kind when available, else fall back to the
        // stored audioSender reference (covers guaranteed null-track transceivers).
        const kind: "video" | "audio" | undefined =
          (sender.track?.kind as "video" | "audio" | undefined) ??
          (viewer.audioSender === sender ? "audio" : undefined);
        if (!kind) return;
        const newTrack =
          remoteStream?.getTracks().find((t) => t.kind === kind) ??
          ownStream?.getTracks().find((t) => t.kind === kind) ??
          null;
        if (newTrack !== sender.track) {
          sender.replaceTrack(newTrack).catch(console.error);
        }
      });
    });
    activeRelayStreamRef.current = remoteStream;
  }, []);

  // Download recording
  const downloadRecording = useCallback(() => {
    if (recordedChunks.length === 0) return;

    const blob = new Blob(recordedChunks, { type: "video/webm" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `stream-${roomCode}-${Date.now()}.webm`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [recordedChunks, roomCode]);

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
      .subscribe((status: any) => {
        console.log("[v0] Host channel status:", status);
      });

    channelRef.current = channel;

    return () => {
      supabase.removeChannel(channel);
    };
  }, [roomCode, handleSignal]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      }
      viewersRef.current.forEach((viewer) => {
        viewer.peerConnection.close();
      });
    };
  }, []);

  return {
    mediaStream: mediaStreamRef.current,
    initializeMedia,
    isStreaming,
    isPaused,
    videoEnabled,
    audioEnabled,
    viewerCount,
    viewers: Array.from(viewers.values()),
    error,
    isRecording,
    hasRecording: recordedChunks.length > 0,
    startStream,
    stopStream,
    pauseStream,
    resumeStream,
    toggleVideo,
    toggleAudio,
    switchCamera,
    relayStream,
    downloadRecording,
  };
}
