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
}

interface UseCohostStreamProps {
  participantId: string; // stream_participants.id
  streamId: string;       // for DB status updates on stream_participants
}

// Lightweight host-side stream hook for co-hosts.
// Mirrors useHostStream but:
//   - Uses an ISOLATED signaling channel (stream-signal-cohost-{participantId})
//   - Does NOT update streams.status (only stream_participants.status)
//   - No recording (admin's stream is the one of record)
export function useCohostStream({ participantId, streamId }: UseCohostStreamProps) {
  const signalingChannel = `stream-signal-cohost-${participantId}`;

  const [isStreaming, setIsStreaming] = useState(false);
  const [videoEnabled, setVideoEnabled] = useState(true);
  const [audioEnabled, setAudioEnabled] = useState(true);
  const [viewerCount, setViewerCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [mediaStream, setMediaStream] = useState<MediaStream | null>(null);
  const [isCameraLost, setIsCameraLost] = useState(false);

  const mediaStreamRef = useRef<MediaStream | null>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const viewersRef = useRef<Map<string, ViewerConnection>>(new Map());
  const supabaseRef = useRef(createClient());
  const supabase = supabaseRef.current;

  // Update participant status in DB
  const updateStatus = useCallback(async (status: "ready" | "live" | "offline") => {
    const { error: dbError } = await supabase
      .from("stream_participants")
      .update({ status, ...(status === "live" ? { joined_at: new Date().toISOString() } : {}) })
      .eq("id", participantId);
    if (dbError) {
      console.error(`[cohost] updateStatus(${status}) failed:`, dbError.message, dbError.code);
    }
  }, [participantId, supabase]);

  // Initialize camera (also used to reconnect after a drop)
  const initializeMedia = useCallback(async (facingMode: "user" | "environment" = "environment") => {
    try {
      // Release any existing tracks first — required on iOS to avoid camera conflicts
      mediaStreamRef.current?.getTracks().forEach((t) => t.stop());
      mediaStreamRef.current = null;

      const constraints: MediaStreamConstraints = {
        ...HOST_MEDIA_CONSTRAINTS,
        video: { ...(HOST_MEDIA_CONSTRAINTS.video as MediaTrackConstraints), facingMode },
      };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);

      // Detect if the browser silently kills the camera (suspend, permission revoke, etc.)
      stream.getVideoTracks()[0]?.addEventListener("ended", () => {
        setIsCameraLost(true);
        setMediaStream(null);
        mediaStreamRef.current = null;
      });

      // If there are live viewer connections, replace their tracks seamlessly (reconnect path)
      if (viewersRef.current.size > 0) {
        const newVideo = stream.getVideoTracks()[0];
        const newAudio = stream.getAudioTracks()[0];
        viewersRef.current.forEach((v) => {
          v.peerConnection.getSenders().forEach((sender) => {
            if (sender.track?.kind === "video" && newVideo) sender.replaceTrack(newVideo).catch(console.error);
            if (sender.track?.kind === "audio" && newAudio) sender.replaceTrack(newAudio).catch(console.error);
          });
        });
      }

      mediaStreamRef.current = stream;
      setMediaStream(stream);
      setIsCameraLost(false);
      setError(null);
      await updateStatus("ready");
      return stream;
    } catch (err) {
      setError("Failed to access camera/microphone. Please check permissions.");
      throw err;
    }
  }, [updateStatus]);

  // Remove a viewer connection
  const removeViewer = useCallback((viewerId: string) => {
    const viewer = viewersRef.current.get(viewerId);
    if (viewer) {
      viewer.peerConnection.close();
      viewersRef.current.delete(viewerId);
      setViewerCount(viewersRef.current.size);
    }
  }, []);

  // Create WebRTC peer connection for an incoming viewer
  const createPeerConnection = useCallback(async (viewerId: string, viewerName: string) => {
    if (viewersRef.current.size >= MAX_VIEWERS) return null;

    const pc = new RTCPeerConnection(ICE_SERVERS);

    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => {
        pc.addTrack(track, mediaStreamRef.current!);
      });
    }

    pc.onicecandidate = (event) => {
      if (event.candidate && channelRef.current) {
        channelRef.current.send({
          type: "broadcast",
          event: "signal",
          payload: {
            type: "ice-candidate",
            from: "host",
            to: viewerId,
            payload: event.candidate.toJSON(),
          } as SignalMessage,
        });
      }
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "connected") {
        const v = viewersRef.current.get(viewerId);
        if (v) { v.connected = true; viewersRef.current.set(viewerId, v); }
        setViewerCount(viewersRef.current.size);
      } else if (["disconnected", "failed", "closed"].includes(pc.connectionState)) {
        removeViewer(viewerId);
      }
    };

    viewersRef.current.set(viewerId, { id: viewerId, name: viewerName, peerConnection: pc, connected: false });
    return pc;
  }, [removeViewer]);

  // Handle incoming signals from viewers
  const handleSignal = useCallback(async (message: SignalMessage) => {
    if (message.to && message.to !== "host") return;

    switch (message.type) {
      case "viewer-join": {
        const pc = await createPeerConnection(message.from, message.viewerName || "Viewer");
        if (!pc) return;
        try {
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          channelRef.current?.send({
            type: "broadcast", event: "signal",
            payload: { type: "offer", from: "host", to: message.from, payload: pc.localDescription?.toJSON() } as SignalMessage,
          });
        } catch (err) { console.error("[cohost] Error creating offer:", err); }
        break;
      }
      case "answer": {
        const viewer = viewersRef.current.get(message.from);
        if (viewer && message.payload) {
          await viewer.peerConnection.setRemoteDescription(
            new RTCSessionDescription(message.payload as RTCSessionDescriptionInit)
          ).catch(console.error);
        }
        break;
      }
      case "ice-candidate": {
        const viewer = viewersRef.current.get(message.from);
        if (viewer && message.payload) {
          await viewer.peerConnection.addIceCandidate(
            new RTCIceCandidate(message.payload as RTCIceCandidateInit)
          ).catch(console.error);
        }
        break;
      }
      case "viewer-leave":
        removeViewer(message.from);
        break;
    }
  }, [createPeerConnection, removeViewer]);

  // Start broadcasting
  const startStream = useCallback(async () => {
    // Re-init if stream is absent OR if all tracks have silently ended (e.g. after network drop)
    const hasLiveTracks = mediaStreamRef.current?.getTracks().some((t) => t.readyState === "live") ?? false;
    if (!mediaStreamRef.current || !hasLiveTracks) await initializeMedia();

    channelRef.current?.send({
      type: "broadcast", event: "signal",
      payload: { type: "stream-start", from: "host" } as SignalMessage,
    });

    await updateStatus("live");
    setIsStreaming(true);
    setError(null);
  }, [initializeMedia, updateStatus]);

  // Stop broadcasting
  const stopStream = useCallback(async () => {
    viewersRef.current.forEach((v) => v.peerConnection.close());
    viewersRef.current.clear();
    setViewerCount(0);

    channelRef.current?.send({
      type: "broadcast", event: "signal",
      payload: { type: "stream-end", from: "host" } as SignalMessage,
    });

    await updateStatus("offline");
    setIsStreaming(false);
  }, [updateStatus]);

  // Toggle video
  const toggleVideo = useCallback(() => {
    if (!mediaStreamRef.current) return;
    const track = mediaStreamRef.current.getVideoTracks()[0];
    if (track) {
      track.enabled = !track.enabled;
      setVideoEnabled(track.enabled);
      channelRef.current?.send({
        type: "broadcast", event: "signal",
        payload: { type: "track-toggle", from: "host", payload: { video: track.enabled } } as SignalMessage,
      });
    }
  }, []);

  // Toggle audio
  const toggleAudio = useCallback(() => {
    if (!mediaStreamRef.current) return;
    const track = mediaStreamRef.current.getAudioTracks()[0];
    if (track) {
      track.enabled = !track.enabled;
      setAudioEnabled(track.enabled);
      channelRef.current?.send({
        type: "broadcast", event: "signal",
        payload: { type: "track-toggle", from: "host", payload: { audio: track.enabled } } as SignalMessage,
      });
    }
  }, []);

  // Switch camera (front/rear)
  const switchCamera = useCallback(async (facingMode: "user" | "environment") => {
    try {
      // Preserve audio tracks before stopping video (iOS requires old camera released first)
      const oldAudioTracks = mediaStreamRef.current?.getAudioTracks() ?? [];
      mediaStreamRef.current?.getVideoTracks().forEach((t) => t.stop());

      // Request the new camera AFTER releasing the old one (iOS compatibility)
      const newVideoStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      const newVideoTrack = newVideoStream.getVideoTracks()[0];
      if (!newVideoTrack) return null;

      // Replace video track in all active viewer / admin-receiver peer connections
      viewersRef.current.forEach((v) => {
        const sender = v.peerConnection.getSenders().find((s) => s.track?.kind === "video");
        if (sender) sender.replaceTrack(newVideoTrack).catch(console.error);
      });

      // Build a brand-new MediaStream so React detects the reference change and
      // re-renders — the old srcObject mutation approach is unreliable on some browsers.
      const newStream = new MediaStream([newVideoTrack, ...oldAudioTracks]);
      mediaStreamRef.current = newStream;
      setMediaStream(newStream);  // new reference → triggers re-render + useEffect srcObject update
      return newStream;
    } catch (err) {
      console.error("[cohost] switchCamera error:", err);
      setError("Could not switch camera.");
      return null;
    }
  }, []);

  // Set up isolated signaling channel
  useEffect(() => {
    const channel = supabase.channel(signalingChannel, {
      config: { broadcast: { self: false } },
    });

    channel
      .on("broadcast", { event: "signal" }, ({ payload }: { payload: any }) => {
        handleSignal(payload as SignalMessage);
      })
      .subscribe();

    channelRef.current = channel;

    return () => {
      supabase.removeChannel(channel);
    };
  }, [signalingChannel, handleSignal, supabase]);

  // Mark offline on unmount
  useEffect(() => {
    return () => {
      updateStatus("offline").catch(() => {});
      mediaStreamRef.current?.getTracks().forEach((t) => t.stop());
      viewersRef.current.forEach((v) => v.peerConnection.close());
    };
  }, [updateStatus]);

  return {
    mediaStream,
    initializeMedia,
    isCameraLost,
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
  };
}
