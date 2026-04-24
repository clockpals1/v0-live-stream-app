"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { RealtimeChannel } from "@supabase/supabase-js";
import { ICE_SERVERS, SignalMessage, HOST_MEDIA_CONSTRAINTS, MAX_VIEWERS } from "./config";
import { warmIceServers, getIceConfig } from "./get-ice-servers";

interface ViewerConnection {
  id: string;
  name: string;
  peerConnection: RTCPeerConnection;
  connected: boolean;
  audioSender?: RTCRtpSender;
  /**
   * Monotonic generation counter — bumped every time we create a fresh PC
   * for this viewerId. Used to discard stale answers/ICE that were emitted
   * by the viewer for a previous PC generation (race when a viewer retries
   * joining while an earlier handshake is still in flight).
   */
  generation: number;
  /** Wall-clock timestamp the current PC was created — used to age-out stale offers. */
  createdAt: number;
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
  // Serialize viewer-join handling per viewerId. Supabase Realtime can deliver
  // duplicate `viewer-join` events (viewer's own 4-second retry loop fires
  // during the initial ICE `checking` phase). Without this guard, two concurrent
  // async handlers both call createPeerConnection() and then
  // setLocalDescription() on PCs that get overwritten in the map mid-flight,
  // which causes answers to arrive for already-closed PCs OR on PCs that are
  // already in `stable` — the source of the "Called in wrong state: stable"
  // error reported in logs.
  const inFlightJoinsRef = useRef<Set<string>>(new Set());
  // Global monotonic counter used to tag each freshly created PC with a unique
  // generation. Stored on the viewer entry so downstream answer/ICE handlers
  // can detect stale callbacks fired for an older generation of the same viewerId.
  const pcGenCounterRef = useRef(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const supabaseRef = useRef(createClient());
  const supabase = supabaseRef.current;

  // Initialize media stream — tries ideal constraints first, falls back to
  // progressively simpler ones for low-end / older mobile browsers.
  const initializeMedia = useCallback(async (facingMode: 'user' | 'environment' = 'environment') => {
    const attempts: MediaStreamConstraints[] = [
      {
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 24 },
          facingMode,
        },
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      },
      // Fallback 1: lower resolution, minimal audio constraints
      {
        video: { facingMode, width: { ideal: 640 }, height: { ideal: 480 } },
        audio: true,
      },
      // Fallback 2: bare minimum — any camera, any mic
      { video: true, audio: true },
    ];
    for (let i = 0; i < attempts.length; i++) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia(attempts[i]);
        console.log(`[v0] Media initialized with constraint level ${i}`);
        mediaStreamRef.current = stream;
        return stream;
      } catch (err) {
        console.warn(`[v0] getUserMedia attempt ${i} failed:`, err);
        if (i === attempts.length - 1) {
          setError("Camera/microphone access failed. Please allow permissions and reload.");
          throw err;
        }
      }
    }
  }, []);

  // Create peer connection for a viewer
  const createPeerConnection = useCallback(
    async (viewerId: string, viewerName: string) => {
      if (viewersRef.current.size >= MAX_VIEWERS) {
        console.log("[v0] Max viewers reached, rejecting:", viewerId);
        return null;
      }

      const pc = new RTCPeerConnection(getIceConfig());

      // Add tracks — use relay (co-host) stream if active, else own camera
      const sourceStream = activeRelayStreamRef.current ?? mediaStreamRef.current;
      console.log(`[v0] Creating peer for ${viewerId}, sourceStream:`, {
        hasStream: !!sourceStream,
        isRelay: !!activeRelayStreamRef.current,
        videoTracks: sourceStream?.getVideoTracks().length ?? 0,
        audioTracks: sourceStream?.getAudioTracks().length ?? 0,
      });
      
      // DIAGNOSTIC: Log detailed media state
      console.log('[DIAGNOSTIC] Peer creation media state:', {
        viewerId,
        hasMediaStream: !!mediaStreamRef.current,
        hasRelayStream: !!activeRelayStreamRef.current,
        hasSourceStream: !!sourceStream,
        mediaStreamTracks: mediaStreamRef.current?.getTracks().map(t => ({
          kind: t.kind,
          id: t.id,
          enabled: t.enabled,
          readyState: t.readyState,
        })) ?? [],
        sourceStreamTracks: sourceStream?.getTracks().map(t => ({
          kind: t.kind,
          id: t.id,
          enabled: t.enabled,
          readyState: t.readyState,
        })) ?? [],
      });
      let audioSenderRef: RTCRtpSender | undefined;
      if (sourceStream) {
        sourceStream.getTracks().forEach((track) => {
          console.log(`[v0] Adding ${track.kind} track to peer ${viewerId}:`, {
            id: track.id,
            enabled: track.enabled,
            readyState: track.readyState,
          });
          const s = pc.addTrack(track, sourceStream);
          if (track.kind === "audio") audioSenderRef = s;
        });
      } else {
        console.warn(`[v0] No source stream available for viewer ${viewerId}!`);
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

      pcGenCounterRef.current += 1;
      const viewerConnection: ViewerConnection = {
        id: viewerId,
        name: viewerName,
        peerConnection: pc,
        connected: false,
        audioSender: audioSenderRef,
        generation: pcGenCounterRef.current,
        createdAt: Date.now(),
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
          const viewerId = message.from;
          console.log("[v0] Viewer joining:", viewerId, message.viewerName);

          // Serialize: if we're mid-flight processing a join for this viewer,
          // drop the duplicate. The viewer's retry loop will re-emit if the
          // handshake genuinely fails, but we must not start a second
          // createPeerConnection() before the first finishes setLocalDescription,
          // or answers will collide on the map entry.
          if (inFlightJoinsRef.current.has(viewerId)) {
            console.log("[v0] Dropping duplicate viewer-join (in flight):", viewerId);
            break;
          }

          // If an existing PC is mid-negotiation and young, the viewer will still
          // receive the in-flight offer — no need to recreate. Only recycle
          // when the PC is clearly stale (closed/failed) or old enough that the
          // previous offer is presumed lost.
          const existing = viewersRef.current.get(viewerId);
          if (existing) {
            const pc = existing.peerConnection;
            const ageMs = Date.now() - existing.createdAt;
            const negotiating =
              pc.signalingState === "have-local-offer" && ageMs < 15000;
            const healthy =
              pc.connectionState === "connected" ||
              pc.connectionState === "connecting";
            if (negotiating || healthy) {
              console.log(
                `[v0] Ignoring re-join for ${viewerId}; existing PC signalingState=${pc.signalingState} connectionState=${pc.connectionState} ageMs=${ageMs}`
              );
              break;
            }
            console.log("[v0] Closing stale connection for viewer:", viewerId);
            pc.close();
            viewersRef.current.delete(viewerId);
          } else if (viewersRef.current.size >= MAX_VIEWERS) {
            console.log("[v0] Max viewers reached");
            break;
          }

          inFlightJoinsRef.current.add(viewerId);
          try {
            const pc = await createPeerConnection(
              viewerId,
              message.viewerName || "Anonymous"
            );
            if (!pc) return;

            const offer = await pc.createOffer();
            // Abort if a newer generation has replaced us during the await.
            const entryAfterCreate = viewersRef.current.get(viewerId);
            if (!entryAfterCreate || entryAfterCreate.peerConnection !== pc) {
              console.log("[v0] Aborting offer for superseded PC:", viewerId);
              try { pc.close(); } catch { /* ignore */ }
              return;
            }
            await pc.setLocalDescription(offer);

            const signalMessage: SignalMessage = {
              type: "offer",
              from: "host",
              to: viewerId,
              payload: pc.localDescription?.toJSON(),
            };

            channelRef.current?.send({
              type: "broadcast",
              event: "signal",
              payload: signalMessage,
            });
          } catch (err) {
            console.error("[v0] Error creating offer:", err);
          } finally {
            inFlightJoinsRef.current.delete(viewerId);
          }
          break;
        }

        case "answer": {
          const viewer = viewersRef.current.get(message.from);
          if (!viewer || !message.payload) break;
          const pc = viewer.peerConnection;
          // Guard against the exact bug that caused
          // "InvalidStateError: Called in wrong state: stable":
          // only a PC that has sent its local offer and not yet received an
          // answer is in `have-local-offer`. Any other state means this answer
          // is stale (already-applied duplicate, or for a superseded PC that
          // happened to share the viewerId key), and applying it would corrupt
          // the live connection.
          if (pc.signalingState !== "have-local-offer") {
            console.warn(
              `[v0] Dropping stale answer for ${message.from}; signalingState=${pc.signalingState}`
            );
            break;
          }
          try {
            await pc.setRemoteDescription(
              new RTCSessionDescription(message.payload as RTCSessionDescriptionInit)
            );
          } catch (err) {
            console.error("[v0] Error setting remote description:", err);
          }
          break;
        }

        case "ice-candidate": {
          const viewer = viewersRef.current.get(message.from);
          if (!viewer || !message.payload) break;
          const pc = viewer.peerConnection;
          // addIceCandidate on a PC with no remote description yet throws.
          // This happens when ICE arrives before the answer handshake for a
          // superseded PC has been unwound. Silently drop — the PC currently
          // live for this viewerId will get its own ICE batch.
          if (!pc.remoteDescription || pc.signalingState === "closed") {
            break;
          }
          try {
            await pc.addIceCandidate(
              new RTCIceCandidate(message.payload as RTCIceCandidateInit)
            );
          } catch (err) {
            console.error("[v0] Error adding ICE candidate:", err);
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
        console.log("[v0] Media not initialized, initializing now...");
        await initializeMedia();
      }

      // Verify media stream has tracks before going live
      if (!mediaStreamRef.current) {
        throw new Error("Failed to initialize media stream");
      }

      const videoTracks = mediaStreamRef.current.getVideoTracks();
      const audioTracks = mediaStreamRef.current.getAudioTracks();
      console.log("[v0] Starting stream with tracks:", {
        video: videoTracks.length,
        audio: audioTracks.length,
        videoEnabled: videoTracks[0]?.enabled,
        audioEnabled: audioTracks[0]?.enabled,
        videoState: videoTracks[0]?.readyState,
        audioState: audioTracks[0]?.readyState,
      });

      if (videoTracks.length === 0) {
        throw new Error("No video track available. Please check camera permissions.");
      }

      // Update stream status in database
      await supabase
        .from("streams")
        .update({ status: "live", started_at: new Date().toISOString() })
        .eq("id", streamId);

      // Start recording
      if (mediaStreamRef.current) {
        try {
          // Pick the best supported mimeType — VP9 is not available on all browsers
          const mimeTypes = [
            "video/webm;codecs=vp9,opus",
            "video/webm;codecs=vp8,opus",
            "video/webm;codecs=h264,opus",
            "video/webm",
            "video/mp4",
          ];
          const mimeType = mimeTypes.find((t) => {
            try { return MediaRecorder.isTypeSupported(t); } catch { return false; }
          }) ?? "";
          const mediaRecorder = new MediaRecorder(
            mediaStreamRef.current,
            mimeType ? { mimeType } : {}
          );

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
      console.log("[v0] Broadcasting stream-start signal");
      channelRef.current?.send({
        type: "broadcast",
        event: "signal",
        payload: { type: "stream-start", from: "host" } as SignalMessage,
      });

      setIsStreaming(true);
      setError(null);
      console.log("[v0] Stream started successfully");
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

  // ── Overlay music: replace the audio track sent to every viewer with a
  // mixed/music track, or restore the original mic track when null.
  // Uses sender.replaceTrack() — no renegotiation needed, matches the
  // same pattern as switchCamera + relayStream.
  //
  // The caller (overlay-music component) owns the mixed MediaStreamTrack
  // produced by createOverlayAudioMixer() and is responsible for tearing
  // it down when stopping. Pass null here to revert to the live mic track.
  const liveAudioTrackRef = useRef<MediaStreamTrack | null>(null);
  const setLiveAudioTrack = useCallback((track: MediaStreamTrack | null) => {
    liveAudioTrackRef.current = track;
    const ownStream = mediaStreamRef.current;
    const relayStream = activeRelayStreamRef.current;
    // Resolution priority when track is null (restore): relay audio > mic audio.
    const restoreAudio =
      relayStream?.getAudioTracks()[0] ??
      ownStream?.getAudioTracks()[0] ??
      null;
    const next = track ?? restoreAudio;
    viewersRef.current.forEach((viewer) => {
      const sender =
        viewer.audioSender ??
        viewer.peerConnection.getSenders().find((s) => s.track?.kind === "audio");
      if (!sender) return;
      if (sender.track !== next) {
        sender.replaceTrack(next).catch((err) => {
          console.error("[v0] setLiveAudioTrack replaceTrack failed:", err);
        });
      }
    });
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

  // Pre-warm ICE servers on mount so credentials are ready before the first
  // viewer joins. warmIceServers() is a no-op if cache is still fresh.
  useEffect(() => {
    warmIceServers();
  }, []);

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
    setLiveAudioTrack,
    downloadRecording,
  };
}
