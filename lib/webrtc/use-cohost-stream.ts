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
  // Viewer-join requests that arrived before camera was ready — processed after init
  const pendingJoinsRef = useRef<{ from: string; viewerName: string }[]>([]);
  // Serialize concurrent viewer-join handling per viewerId — see use-host-stream.ts
  // for the full root-cause explanation.
  const inFlightJoinsRef = useRef<Set<string>>(new Set());
  // Prevents accepting new viewer connections while co-host is stopped
  const acceptingRef = useRef(false);
  // Shared broadcast channel so director panel updates without postgres_changes publication
  const statusChannelRef = useRef<RealtimeChannel | null>(null);

  // Update participant status in DB AND broadcast to director panel
  const updateStatus = useCallback(async (status: "ready" | "live" | "offline") => {
    const { error: dbError } = await supabase
      .from("stream_participants")
      .update({ status, ...(status === "live" ? { joined_at: new Date().toISOString() } : {}) })
      .eq("id", participantId);
    if (dbError) {
      console.error(`[cohost] updateStatus(${status}) failed:`, dbError.message, dbError.code);
    }
    // Broadcast so director panel reacts without needing a DB publication
    statusChannelRef.current?.send({
      type: "broadcast",
      event: "participant-status",
      payload: { participantId, status },
    });
  }, [participantId, supabase]);

  // Initialize camera (also used to reconnect after a drop)
  const initializeMedia = useCallback(async (facingMode: "user" | "environment" = "environment") => {
    try {
      // Release any existing tracks first — required on iOS to avoid camera conflicts
      mediaStreamRef.current?.getTracks().forEach((t) => t.stop());
      mediaStreamRef.current = null;

      // Progressive fallback: try ideal constraints first, then simpler ones for compatibility
      const attempts: MediaStreamConstraints[] = [
        // Attempt 1: Ideal quality with full audio processing
        {
          video: { ...(HOST_MEDIA_CONSTRAINTS.video as MediaTrackConstraints), facingMode },
          audio: HOST_MEDIA_CONSTRAINTS.audio,
        },
        // Attempt 2: Lower resolution, basic audio
        {
          video: { facingMode, width: { ideal: 640 }, height: { ideal: 480 } },
          audio: true,
        },
        // Attempt 3: Bare minimum — any camera, any mic
        { video: true, audio: true },
      ];

      let stream: MediaStream | null = null;
      let lastError: any = null;

      for (let i = 0; i < attempts.length; i++) {
        try {
          stream = await navigator.mediaDevices.getUserMedia(attempts[i]);
          console.log(`[cohost] Media initialized with constraint level ${i}`);
          break;
        } catch (err) {
          console.warn(`[cohost] getUserMedia attempt ${i} failed:`, err);
          lastError = err;
          if (i === attempts.length - 1) {
            setError("Failed to access camera/microphone. Please check permissions and reload.");
            throw err;
          }
        }
      }

      if (!stream) {
        setError("Failed to access camera/microphone. Please check permissions and reload.");
        throw lastError || new Error("Could not initialize media");
      }

      // On iOS/Android, combined video+audio getUserMedia can silently succeed but
      // return a video-only stream when the mic wasn't pre-permitted. Attempt a
      // separate audio-only request and merge the track if that happens.
      if (stream.getAudioTracks().length === 0) {
        console.warn("[cohost] No audio track in combined getUserMedia — retrying audio separately");
        try {
          const audioStream = await navigator.mediaDevices.getUserMedia({
            audio: HOST_MEDIA_CONSTRAINTS.audio,
          });
          audioStream.getAudioTracks().forEach((t) => stream!.addTrack(t));
          console.log("[cohost] Audio track added via separate capture");
        } catch (audioErr) {
          console.warn("[cohost] Could not capture audio separately:", audioErr);
          // Continue without audio rather than failing completely
        }
      }

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
      // Error already set in fallback loop above
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
        const viewerId = message.from;
        // If camera isn't ready yet, queue the join — initializeMedia will process it
        if (!mediaStreamRef.current) {
          pendingJoinsRef.current.push({ from: viewerId, viewerName: message.viewerName || "Viewer" });
          return;
        }
        // Not accepting connections while stopped (prevents zombie PCs after stopStream)
        if (!acceptingRef.current) return;

        // Same signaling-state guard as the host hook — see comments in
        // use-host-stream.ts. Prevents the "Called in wrong state: stable"
        // error when a viewer retries during an in-flight handshake.
        if (inFlightJoinsRef.current.has(viewerId)) return;

        const existing = viewersRef.current.get(viewerId);
        if (existing) {
          const pc = existing.peerConnection;
          const negotiating = pc.signalingState === "have-local-offer";
          const healthy =
            pc.connectionState === "connected" ||
            pc.connectionState === "connecting";
          if (negotiating || healthy) return;
          pc.close();
          viewersRef.current.delete(viewerId);
          setViewerCount(viewersRef.current.size);
        }

        inFlightJoinsRef.current.add(viewerId);
        try {
          const pc = await createPeerConnection(viewerId, message.viewerName || "Viewer");
          if (!pc) return;
          const offer = await pc.createOffer();
          const entryAfterCreate = viewersRef.current.get(viewerId);
          if (!entryAfterCreate || entryAfterCreate.peerConnection !== pc) {
            try { pc.close(); } catch { /* ignore */ }
            return;
          }
          await pc.setLocalDescription(offer);
          channelRef.current?.send({
            type: "broadcast", event: "signal",
            payload: { type: "offer", from: "host", to: viewerId, payload: pc.localDescription?.toJSON() } as SignalMessage,
          });
        } catch (err) { console.error("[cohost] Error creating offer:", err); }
        finally { inFlightJoinsRef.current.delete(viewerId); }
        break;
      }
      case "answer": {
        const viewer = viewersRef.current.get(message.from);
        if (!viewer || !message.payload) break;
        const pc = viewer.peerConnection;
        // Drop stale answers for superseded PCs — root-cause guard for
        // "InvalidStateError: Called in wrong state: stable".
        if (pc.signalingState !== "have-local-offer") break;
        await pc.setRemoteDescription(
          new RTCSessionDescription(message.payload as RTCSessionDescriptionInit)
        ).catch(console.error);
        break;
      }
      case "ice-candidate": {
        const viewer = viewersRef.current.get(message.from);
        if (!viewer || !message.payload) break;
        const pc = viewer.peerConnection;
        if (!pc.remoteDescription || pc.signalingState === "closed") break;
        await pc.addIceCandidate(
          new RTCIceCandidate(message.payload as RTCIceCandidateInit)
        ).catch(console.error);
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

    acceptingRef.current = true; // start accepting viewer connections

    // Process viewer-join requests that queued while camera was initialising
    if (pendingJoinsRef.current.length > 0) {
      const pending = pendingJoinsRef.current.splice(0);
      for (const { from, viewerName } of pending) {
        const pc = await createPeerConnection(from, viewerName);
        if (!pc) continue;
        try {
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          channelRef.current?.send({
            type: "broadcast", event: "signal",
            payload: { type: "offer", from: "host", to: from, payload: pc.localDescription?.toJSON() } as SignalMessage,
          });
        } catch (err) { console.error("[cohost] pending offer error:", err); }
      }
    }

    channelRef.current?.send({
      type: "broadcast", event: "signal",
      payload: { type: "stream-start", from: "host" } as SignalMessage,
    });

    await updateStatus("live");
    setIsStreaming(true);
    setError(null);
  }, [initializeMedia, updateStatus, createPeerConnection]);

  // Stop broadcasting
  const stopStream = useCallback(async () => {
    acceptingRef.current = false; // stop accepting new viewer connections
    pendingJoinsRef.current = []; // discard any queued joins

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

  // Set up isolated signaling channel + shared status broadcast channel
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

    // Shared channel: admin's director panel subscribes here for instant status updates
    const statusChannel = supabase.channel(`stream-cams-${streamId}`, {
      config: { broadcast: { self: false } },
    });
    statusChannel.subscribe();
    statusChannelRef.current = statusChannel;

    return () => {
      supabase.removeChannel(channel);
      supabase.removeChannel(statusChannel);
      statusChannelRef.current = null;
    };
  }, [signalingChannel, handleSignal, supabase, streamId]);

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
