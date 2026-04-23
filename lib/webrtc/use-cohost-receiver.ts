"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { ICE_SERVERS } from "./config";

/**
 * Admin-side hook: silently connects to the co-host's isolated signaling
 * channel as a receiver and returns the co-host's MediaStream.
 *
 * The returned stream is used by useHostStream.relayStream() to push the
 * co-host's tracks to all existing viewers via replaceTrack() — no viewer
 * reconnection required.
 *
 * Pass participantId=null to disconnect.
 */
export function useCohostReceiver(participantId: string | null): MediaStream | null {
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);

  const pcRef       = useRef<RTCPeerConnection | null>(null);
  const channelRef  = useRef<ReturnType<ReturnType<typeof createClient>["channel"]> | null>(null);
  const retryRef    = useRef<ReturnType<typeof setInterval> | null>(null);
  const supabaseRef = useRef(createClient());
  const receiverId  = useRef(`director-${Math.random().toString(36).substr(2, 9)}`);

  const cleanup = useCallback(() => {
    if (retryRef.current) { clearInterval(retryRef.current); retryRef.current = null; }
    if (channelRef.current) {
      try {
        channelRef.current.send({
          type: "broadcast",
          event: "signal",
          payload: { type: "viewer-leave", from: receiverId.current, to: "host" },
        });
      } catch {}
      supabaseRef.current.removeChannel(channelRef.current);
      channelRef.current = null;
    }
    if (pcRef.current) {
      pcRef.current.close();
      pcRef.current = null;
    }
    setRemoteStream(null);
  }, []);

  useEffect(() => {
    if (!participantId) {
      cleanup();
      return;
    }

    const supabase   = supabaseRef.current;
    const myId       = receiverId.current;
    const channelName = `stream-signal-cohost-${participantId}`;

    const channel = supabase.channel(channelName, {
      config: { broadcast: { self: false } },
    });

    channel
      .on("broadcast", { event: "signal" }, async ({ payload }: { payload: any }) => {
        if (payload.to && payload.to !== myId) return;

        // Co-host stopped broadcasting — disconnect cleanly
        if (payload.type === "stream-end") {
          if (pcRef.current) { pcRef.current.close(); pcRef.current = null; }
          setRemoteStream(null);
          return;
        }

        if (payload.type === "offer") {
          if (pcRef.current) {
            pcRef.current.close();
          }
          const pc = new RTCPeerConnection(ICE_SERVERS);
          pcRef.current = pc;

          // Accumulate tracks with a NEW MediaStream reference each time so React
          // always re-renders and relayStream() receives a stream with ALL tracks
          // (video + audio). Using e.streams[0] fails because it's the same object
          // reference for both ontrack events — React bails out on the second call.
          pc.ontrack = (e) => {
            setRemoteStream((prev) => {
              const tracks = prev ? [...prev.getTracks()] : [];
              if (!tracks.some((t) => t.id === e.track.id)) tracks.push(e.track);
              return new MediaStream(tracks);
            });
          };

          pc.onicecandidate = (e) => {
            if (e.candidate) {
              channel.send({
                type: "broadcast",
                event: "signal",
                payload: {
                  type: "ice-candidate",
                  from: myId,
                  to: "host",
                  payload: e.candidate.toJSON(),
                },
              });
            }
          };

          try {
            await pc.setRemoteDescription(
              new RTCSessionDescription(payload.payload)
            );
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            channel.send({
              type: "broadcast",
              event: "signal",
              payload: {
                type: "answer",
                from: myId,
                to: "host",
                payload: pc.localDescription?.toJSON(),
              },
            });
          } catch (err) {
            console.error("[cohost-receiver] offer handling error:", err);
          }
        }

        if (payload.type === "ice-candidate" && pcRef.current && payload.payload) {
          await pcRef.current
            .addIceCandidate(new RTCIceCandidate(payload.payload))
            .catch(console.error);
        }
      })
      .subscribe(() => {
        const joinMsg = {
          type: "broadcast" as const,
          event: "signal",
          payload: { type: "viewer-join", from: myId, to: "host", viewerName: "Director" },
        };
        setTimeout(() => channel.send(joinMsg), 600);

        retryRef.current = setInterval(() => {
          const pc = pcRef.current;
          if (pc?.connectionState === "connected") {
            clearInterval(retryRef.current!); retryRef.current = null;
          } else {
            channel.send(joinMsg);
          }
        }, 4000);
      });

    channelRef.current = channel;
    return () => { cleanup(); };
  }, [participantId, cleanup]);

  return remoteStream;
}
