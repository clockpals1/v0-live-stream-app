"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { RealtimeChannel } from "@supabase/supabase-js";
import { warmIceServers, getIceConfig } from "./get-ice-servers";
import { getTwilioTurnCreds, hasFreshTurnCreds } from "./twilio-turn";

// Start every peer connection with STUN only — most users (Canada/US/UK/Europe)
// connect directly without any relay. TURN is added ONLY when ICE struggles.
const STUN_ONLY_CONFIG: RTCConfiguration = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
  iceCandidatePoolSize: 2,
};

// If ICE stays in 'checking' this long without reaching 'connected',
// we assume a restrictive NAT / high-latency carrier and inject TURN.
const ICE_CHECKING_TIMEOUT_MS = 8000;

interface UseSimpleStreamProps {
  streamId: string;
  roomCode: string;
  signalingChannel?: string; // overrides default stream-signal-{roomCode} channel
  onStreamEnd?: () => void;
}

export function useSimpleStream({
  streamId,
  roomCode,
  signalingChannel,
  onStreamEnd,
}: UseSimpleStreamProps) {
  // Compute the active channel — co-host switch overrides the default
  const activeChannel = signalingChannel || `stream-signal-${roomCode}`;
  const [isConnected, setIsConnected] = useState(false);
  const [isStreamLive, setIsStreamLive] = useState(false);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hostVideoEnabled, setHostVideoEnabled] = useState(true);
  const [hostAudioEnabled, setHostAudioEnabled] = useState(true);
  const [connectionState, setConnectionState] = useState<string>("new");
  const [reconnectAttempts, setReconnectAttempts] = useState(0);
  const [isStreamPaused, setIsStreamPaused] = useState(false);
  // Debug/UX flag: surfaces whether the current PC is relaying through TURN.
  // Viewer UI may show a subtle badge when true. Invisible to end users otherwise.
  const [isUsingTurn, setIsUsingTurn] = useState(false);

  const viewerIdRef = useRef<string>(Math.random().toString(36).substr(2, 9));
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const joinStreamRef = useRef<() => void>(() => {});
  const supabaseRef = useRef(createClient());
  const supabase = supabaseRef.current;

  // ICE-recovery bookkeeping: tracks the 'checking' watchdog and whether TURN
  // has already been injected on the current PC so we don't loop.
  const iceCheckingTimerRef = useRef<NodeJS.Timeout | null>(null);
  const turnInjectedRef = useRef(false);

  // Inject Twilio TURN into the CURRENT peer connection and restart ICE.
  // restartIce() avoids tearing down the PC so the existing stream keeps flowing
  // as soon as new candidates succeed — no re-negotiation from scratch.
  const injectTurnAndRestart = useCallback(async (reason: string) => {
    const pc = peerConnectionRef.current;
    if (!pc || pc.connectionState === "closed") return;
    if (turnInjectedRef.current) return; // already relaying on this PC

    console.log(`[simple] ICE fallback triggered (${reason}) — fetching Twilio TURN`);
    const turnServers = await getTwilioTurnCreds();
    if (!turnServers || turnServers.length === 0) {
      console.warn("[simple] Twilio TURN unavailable — staying on STUN-only");
      return;
    }
    // Current PC may have been closed while fetching.
    const current = peerConnectionRef.current;
    if (!current || current.connectionState === "closed") return;

    try {
      current.setConfiguration({
        iceServers: [
          { urls: "stun:stun.l.google.com:19302" },
          ...turnServers,
        ],
        iceCandidatePoolSize: 2,
      });
      current.restartIce();
      turnInjectedRef.current = true;
      setIsUsingTurn(true);
      console.log("[simple] TURN injected + restartIce() called");
    } catch (err) {
      console.error("[simple] setConfiguration/restartIce failed:", err);
    }
  }, []);

  // Join stream (declared FIRST to avoid TDZ in closures below)
  // Note: viewerName is NOT in dependencies - stream connection is independent of chat identity
  const joinStream = useCallback(() => {
    if (!channelRef.current) return;

    const joinMessage = {
      type: "viewer-join",
      from: viewerIdRef.current,
      to: "host",
      viewerName: "Viewer", // Use generic name for signaling - chat identity is separate
    };

    channelRef.current.send({
      type: "broadcast",
      event: "signal",
      payload: joinMessage,
    });
  }, []);

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
  }, []);

  // Handle incoming signals
  const handleSignal = useCallback(
    async (message: any) => {
      if (message.to && message.to !== viewerIdRef.current) return;

      console.log("[simple] Received signal:", message.type);

      switch (message.type) {
        case "offer": {
          console.log("[simple] Received offer from host");
          
          // Close existing connection
          if (peerConnectionRef.current) {
            peerConnectionRef.current.close();
            peerConnectionRef.current = null;
          }
          if (iceCheckingTimerRef.current) {
            clearTimeout(iceCheckingTimerRef.current);
            iceCheckingTimerRef.current = null;
          }
          turnInjectedRef.current = false;
          setIsUsingTurn(false);

          // Start STUN-only. If the client already has fresh TURN creds cached
          // from a prior struggling connection (e.g. same user re-joining on a
          // bad network), seed the PC with them up-front to avoid the 8s wait.
          const initialConfig: RTCConfiguration = hasFreshTurnCreds()
            ? (await (async () => {
                const turn = await getTwilioTurnCreds();
                return turn && turn.length > 0
                  ? {
                      iceServers: [
                        { urls: "stun:stun.l.google.com:19302" },
                        ...turn,
                      ],
                      iceCandidatePoolSize: 2,
                    }
                  : STUN_ONLY_CONFIG;
              })())
            : STUN_ONLY_CONFIG;

          const pc = new RTCPeerConnection(initialConfig);
          peerConnectionRef.current = pc;
          if (initialConfig !== STUN_ONLY_CONFIG) {
            turnInjectedRef.current = true;
            setIsUsingTurn(true);
          }
          
          pc.ontrack = (event) => {
            console.log("[simple] Received track:", {
              kind: event.track.kind,
              id: event.track.id,
              enabled: event.track.enabled,
              readyState: event.track.readyState,
              streamsCount: event.streams.length,
              streamId: event.streams[0]?.id,
            });
            
            // DIAGNOSTIC: Detailed track info
            console.log('[DIAGNOSTIC] ontrack detailed:', {
              trackKind: event.track.kind,
              trackId: event.track.id,
              trackEnabled: event.track.enabled,
              trackReadyState: event.track.readyState,
              trackMuted: event.track.muted,
              hasStreams: event.streams.length > 0,
              streamCount: event.streams.length,
              firstStreamId: event.streams[0]?.id,
              firstStreamTracks: event.streams[0]?.getTracks().map(t => ({
                kind: t.kind,
                id: t.id,
                enabled: t.enabled,
                readyState: t.readyState,
              })) ?? [],
            });

            if (event.streams.length > 0) {
              const stream = event.streams[0];
              
              // Check if stream has video/audio tracks and update states
              const videoTracks = stream.getVideoTracks();
              const audioTracks = stream.getAudioTracks();
              
              console.log("[simple] Stream received with tracks:", {
                streamId: stream.id,
                videoCount: videoTracks.length,
                audioCount: audioTracks.length,
                videoEnabled: videoTracks[0]?.enabled,
                audioEnabled: audioTracks[0]?.enabled,
                videoState: videoTracks[0]?.readyState,
                audioState: audioTracks[0]?.readyState,
              });
              
              if (videoTracks.length > 0) {
                const videoTrack = videoTracks[0];
                const videoEnabled = videoTrack.enabled && videoTrack.readyState === 'live';
                setHostVideoEnabled(videoEnabled);
                console.log("[simple] Video track enabled:", videoEnabled);
              } else {
                setHostVideoEnabled(false);
                console.log("[simple] No video tracks available");
              }
              
              if (audioTracks.length > 0) {
                const audioTrack = audioTracks[0];
                const audioEnabled = audioTrack.enabled && audioTrack.readyState === 'live';
                setHostAudioEnabled(audioEnabled);
                console.log("[simple] Audio track enabled:", audioEnabled);
              } else {
                setHostAudioEnabled(false);
                console.log("[simple] No audio tracks available");
              }
              
              setRemoteStream(stream);
              setIsConnected(true);
              setError(null);
            } else {
              // Track arrived with no associated stream (sender used addTransceiver
              // without streams option). Merge into existing remoteStream so the
              // video element's srcObject receives the track data.
              console.warn("[simple] Track has no streams — merging into remoteStream:", {
                kind: event.track.kind,
                id: event.track.id,
                enabled: event.track.enabled,
                readyState: event.track.readyState,
              });
              setRemoteStream((prev) => {
                const tracks = prev ? [...prev.getTracks()] : [];
                if (!tracks.some((t) => t.id === event.track.id)) {
                  tracks.push(event.track);
                  console.log("[simple] Added track to remoteStream, total tracks:", tracks.length);
                }
                const newStream = new MediaStream(tracks);
                console.log("[simple] New remoteStream:", {
                  id: newStream.id,
                  videoCount: newStream.getVideoTracks().length,
                  audioCount: newStream.getAudioTracks().length,
                });
                return newStream;
              });
              setIsConnected(true);
              setError(null);
            }
          };
          
          pc.onconnectionstatechange = () => {
            const state = pc.connectionState;
            console.log("[simple] Connection state:", state);
            setConnectionState(state);
            
            if (state === 'connected') {
              setIsConnected(true);
              setError(null);
            } else if (state === 'failed' || state === 'disconnected') {
              setIsConnected(false);
              setRemoteStream(null);
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
                  payload: event.candidate,
                },
              });
            }
          };

          // ICE recovery strategy:
          //   - 'checking' for > 8s with no 'connected' → inject TURN + restartIce()
          //   - 'failed' or 'disconnected' → inject TURN + restartIce() (no PC teardown)
          //   - If TURN is already injected and we still fail → fall back to full rejoin
          // restartIce() keeps the existing PC alive so viewers don't lose the stream.
          pc.oniceconnectionstatechange = () => {
            const s = pc.iceConnectionState;
            console.log("[simple] ICE connection state:", s);

            // Clear any pending 'checking' watchdog on state change.
            if (iceCheckingTimerRef.current) {
              clearTimeout(iceCheckingTimerRef.current);
              iceCheckingTimerRef.current = null;
            }

            if (s === "checking") {
              iceCheckingTimerRef.current = setTimeout(() => {
                if (
                  peerConnectionRef.current === pc &&
                  pc.iceConnectionState === "checking"
                ) {
                  injectTurnAndRestart("stuck in checking > 8s");
                }
              }, ICE_CHECKING_TIMEOUT_MS);
            } else if (s === "failed" || s === "disconnected") {
              if (!turnInjectedRef.current) {
                injectTurnAndRestart(s);
              } else if (s === "failed") {
                // Already on TURN and still failed — last resort: full rejoin.
                console.log("[simple] ICE failed even with TURN — triggering rejoin");
                joinStreamRef.current();
              }
            } else if (s === "connected" || s === "completed") {
              // Successful — nothing to do.
            }
          };
          
          try {
            await pc.setRemoteDescription(new RTCSessionDescription(message.payload));
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            
            if (channelRef.current) {
              channelRef.current.send({
                type: "broadcast",
                event: "signal",
                payload: {
                  type: "answer",
                  from: viewerIdRef.current,
                  to: "host",
                  payload: answer,
                },
              });
            }
            
            console.log("[simple] Answer sent to host");
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
          setIsStreamPaused(true);
          break;
        }

        case "stream-resume": {
          console.log("[simple] Stream resumed by host");
          setIsStreamPaused(false);
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
    viewerIdRef.current = Math.random().toString(36).substr(2, 9);
    setTimeout(() => {
      joinStreamRef.current();
    }, 1000);
  }, []);

  // Set up signaling channel — re-runs whenever activeChannel changes (camera switch)
  useEffect(() => {
    const channel = supabase.channel(activeChannel, {
      config: {
        broadcast: { self: false },
      },
    });

    // Start fetching dynamic TURN credentials in the background so they are
    // ready before the first offer arrives. Non-blocking — uses static fallback
    // if the fetch hasn't resolved by the time the first peer connection is created.
    warmIceServers();

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
            setError(null);
            // Initial join after 1s
            setTimeout(joinStream, 1000);
            // Retry viewer-join ONLY when we're clearly not in a live handshake.
            //
            // Root-cause guard for the "Called in wrong state: stable" error
            // seen on the host:
            //   - A healthy WebRTC handshake spends 2-10s in iceConnectionState
            //     "checking" before reaching "connected".
            //   - The OLD retry condition `pc.connectionState !== "connected"`
            //     fired every 4s during this normal window, so the viewer sent
            //     multiple "viewer-join" messages per join. The host then
            //     created multiple PCs for the same viewerId, answers arrived
            //     for superseded PCs, and setRemoteDescription threw.
            //
            // Retry here is only meant for the catastrophic case where the
            // first join broadcast was dropped entirely and NO PC was ever
            // created (or the one we had is dead). Anything else — including
            // mid-handshake states — we let run to completion.
            const retryInterval = setInterval(() => {
              const pc = peerConnectionRef.current;
              // No PC at all → first join likely never reached the host, retry.
              if (!pc) {
                console.log("[simple] No peer yet — retrying viewer-join");
                joinStream();
                return;
              }
              // Fully connected — we're done, stop the retry loop.
              if (pc.connectionState === "connected") {
                clearInterval(retryInterval);
                return;
              }
              // PC is dead → rebuild.
              if (
                pc.connectionState === "closed" ||
                pc.connectionState === "failed" ||
                pc.signalingState === "closed"
              ) {
                console.log("[simple] Peer is dead — retrying viewer-join");
                joinStream();
                return;
              }
              // Everything else (new / connecting / disconnected transient,
              // have-local-offer / have-remote-offer / stable) means a
              // handshake is in flight or the PC has recovered — do NOT
              // emit another join. Let the existing negotiation finish.
            }, 4000);
            reconnectTimeoutRef.current = retryInterval as any;
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
      if (reconnectTimeoutRef.current) {
        clearInterval(reconnectTimeoutRef.current as any);
        reconnectTimeoutRef.current = null;
      }
      // Close old peer connection so the retry loop correctly retries when switching channels.
      // Without this, peerConnectionRef.current would be non-null (old host) and retries stop.
      if (peerConnectionRef.current) {
        peerConnectionRef.current.close();
        peerConnectionRef.current = null;
      }
      if (iceCheckingTimerRef.current) {
        clearTimeout(iceCheckingTimerRef.current);
        iceCheckingTimerRef.current = null;
      }
      turnInjectedRef.current = false;
      setIsUsingTurn(false);
      setIsConnected(false);
      setRemoteStream(null);
      leaveStream();
      supabase.removeChannel(channel);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeChannel, streamId]);

  return {
    viewerId: viewerIdRef.current,
    isConnected,
    isStreamLive,
    remoteStream,
    error,
    hostVideoEnabled,
    hostAudioEnabled,
    connectionState,
    isStreamPaused,
    isUsingTurn,
    joinStream,
    leaveStream,
    attemptAlternativeConnection,
  };
}
