"use client";

import { useState, useRef, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { ICE_SERVERS } from "./config";

interface CohostConnection {
  pc: RTCPeerConnection | null;
  channel: ReturnType<ReturnType<typeof createClient>["channel"]>;
  receiverId: string;
  retryTimer: ReturnType<typeof setInterval> | null;
}

/**
 * Pre-warms a WebRTC receiver connection for every participantId provided.
 * Returns a Map<participantId, MediaStream> of already-flowing streams so
 * that replaceTrack() can be called instantly with zero perceptible lag.
 *
 * Connections are maintained as long as the ID is in the list.
 * When a participant is removed the connection is torn down.
 */
export function useWarmCohostPool(participantIds: string[]): Map<string, MediaStream> {
  const [streamMap, setStreamMap] = useState<Map<string, MediaStream>>(new Map());
  const connectionsRef = useRef<Map<string, CohostConnection>>(new Map());
  const supabaseRef    = useRef(createClient());

  // Stable key — sort so order doesn't matter
  const idsKey = [...participantIds].sort().join(",");

  useEffect(() => {
    const supabase    = supabaseRef.current;
    const currentIds  = new Set(participantIds);
    const existingIds = new Set(connectionsRef.current.keys());

    // ── Tear down connections no longer needed ──────────────────────────────
    existingIds.forEach((id) => {
      if (currentIds.has(id)) return;
      const conn = connectionsRef.current.get(id)!;
      if (conn.retryTimer) clearInterval(conn.retryTimer);
      conn.pc?.close();
      try { supabase.removeChannel(conn.channel); } catch {}
      connectionsRef.current.delete(id);
      setStreamMap((prev) => { const m = new Map(prev); m.delete(id); return m; });
    });

    // ── Warm up new connections ─────────────────────────────────────────────
    participantIds.forEach((id) => {
      if (existingIds.has(id)) return; // already connected

      const receiverId  = `warm-${id.slice(0, 8)}-${Math.random().toString(36).substr(2, 5)}`;
      const channelName = `stream-signal-cohost-${id}`;
      const channel     = supabase.channel(channelName, {
        config: { broadcast: { self: false } },
      });

      const conn: CohostConnection = { pc: null, channel, receiverId, retryTimer: null };
      connectionsRef.current.set(id, conn);

      channel
        .on("broadcast", { event: "signal" }, async ({ payload }: { payload: any }) => {
          if (payload.to && payload.to !== receiverId) return;
          const c = connectionsRef.current.get(id);
          if (!c) return;

          if (payload.type === "offer") {
            c.pc?.close();
            const pc = new RTCPeerConnection(ICE_SERVERS);
            c.pc = pc;

            pc.ontrack = (e) => {
              if (e.streams[0]) {
                setStreamMap((prev) => new Map(prev).set(id, e.streams[0]));
              }
            };

            pc.onicecandidate = (e) => {
              if (e.candidate) {
                channel.send({
                  type: "broadcast", event: "signal",
                  payload: { type: "ice-candidate", from: receiverId, to: "host", payload: e.candidate.toJSON() },
                });
              }
            };

            try {
              await pc.setRemoteDescription(new RTCSessionDescription(payload.payload));
              const answer = await pc.createAnswer();
              await pc.setLocalDescription(answer);
              channel.send({
                type: "broadcast", event: "signal",
                payload: { type: "answer", from: receiverId, to: "host", payload: pc.localDescription?.toJSON() },
              });
            } catch (err) {
              console.error("[warm-pool] offer error:", err);
            }
          }

          if (payload.type === "ice-candidate" && c.pc && payload.payload) {
            await c.pc.addIceCandidate(new RTCIceCandidate(payload.payload)).catch(console.error);
          }
        })
        .subscribe(() => {
          const joinMsg = {
            type: "broadcast", event: "signal",
            payload: { type: "viewer-join", from: receiverId, to: "host", viewerName: "Director" },
          };
          // Initial join attempt
          setTimeout(() => channel.send(joinMsg), 400);

          // Retry every 3s until the peer connection is fully established
          conn.retryTimer = setInterval(() => {
            const c = connectionsRef.current.get(id);
            if (!c) { clearInterval(conn.retryTimer!); return; }
            if (!c.pc || c.pc.connectionState !== "connected") {
              channel.send(joinMsg);
            } else {
              clearInterval(conn.retryTimer!);
              conn.retryTimer = null;
            }
          }, 3000);
        });
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey]);

  // Full cleanup on unmount
  useEffect(() => {
    return () => {
      const supabase = supabaseRef.current;
      connectionsRef.current.forEach((conn) => {
        if (conn.retryTimer) clearInterval(conn.retryTimer);
        conn.pc?.close();
        try { supabase.removeChannel(conn.channel); } catch {}
      });
      connectionsRef.current.clear();
    };
  }, []);

  return streamMap;
}
