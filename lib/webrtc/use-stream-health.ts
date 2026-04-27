"use client";

import { useEffect, useState } from "react";

/**
 * Health metrics for a live stream, sampled every ~2s from the host's
 * outbound RTCPeerConnections.
 *
 * Aggregation:
 *   - bitrateKbps   : sum of outbound video bitrate across all viewers
 *                     divided by viewer count, so the number stays
 *                     useful when audience size grows.
 *   - packetLossPct : worst-case packet-loss ratio reported by any
 *                     active outbound RTP stream. We surface the
 *                     worst peer, not the average, because a single
 *                     viewer with broken playback is what the host
 *                     wants to be alerted about.
 *   - rttMs         : worst-case selected-candidate-pair round-trip.
 *   - iceState      : worst-case ICE connection state across peers.
 *                     "connected" only if every peer is healthy.
 *   - status        : derived from the above metrics, used for the
 *                     topbar pill colour. ok < warn < bad < offline.
 */
export interface StreamHealth {
  bitrateKbps: number;
  packetLossPct: number;
  rttMs: number;
  iceState: RTCIceConnectionState | "no-peers";
  status: "ok" | "warn" | "bad" | "offline";
  sampledAt: number;
}

const EMPTY: StreamHealth = {
  bitrateKbps: 0,
  packetLossPct: 0,
  rttMs: 0,
  iceState: "no-peers",
  status: "offline",
  sampledAt: 0,
};

/**
 * Inputs:
 *   - getPeerConnections: function returning the current viewer peers
 *     each tick. We accept a getter rather than a snapshot so the host
 *     can add/remove viewers without us re-subscribing.
 *   - active: gate the poll. Pass false when the stream is not live to
 *     avoid burning CPU on idle pages.
 */
export function useStreamHealth(
  getPeerConnections: () => RTCPeerConnection[],
  active: boolean,
  intervalMs = 2000,
): StreamHealth {
  const [health, setHealth] = useState<StreamHealth>(EMPTY);

  useEffect(() => {
    if (!active) {
      setHealth(EMPTY);
      return;
    }

    // Per-peer running counters used to derive bitrate from cumulative
    // bytesSent. Map keyed by PC reference identity so removed peers
    // age out automatically when the host closes their connection.
    const previous = new WeakMap<
      RTCPeerConnection,
      { bytes: number; ts: number }
    >();

    let cancelled = false;
    const tick = async () => {
      const peers = getPeerConnections();
      if (peers.length === 0) {
        if (!cancelled) setHealth({ ...EMPTY, sampledAt: Date.now() });
        return;
      }

      let totalBitrate = 0;
      let worstLoss = 0;
      let worstRtt = 0;
      let worstIce: RTCIceConnectionState | "no-peers" =
        "connected" as RTCIceConnectionState;
      let healthyPeers = 0;

      const settled = await Promise.allSettled(
        peers.map(async (pc) => {
          if (pc.connectionState === "closed") return;
          const stats = await pc.getStats();
          let bytesSent = 0;
          let packetsSent = 0;
          let packetsLost = 0;
          let rtt = 0;

          stats.forEach((report: any) => {
            if (report.type === "outbound-rtp" && report.kind === "video") {
              bytesSent += report.bytesSent ?? 0;
            }
            if (report.type === "remote-inbound-rtp") {
              packetsLost += report.packetsLost ?? 0;
              if (typeof report.roundTripTime === "number") {
                rtt = Math.max(rtt, report.roundTripTime * 1000);
              }
            }
            if (report.type === "outbound-rtp") {
              packetsSent += report.packetsSent ?? 0;
            }
          });

          const now = Date.now();
          const prev = previous.get(pc);
          previous.set(pc, { bytes: bytesSent, ts: now });
          if (prev) {
            const dtSec = Math.max(0.001, (now - prev.ts) / 1000);
            const dBytes = Math.max(0, bytesSent - prev.bytes);
            // bytes → bits → kbps
            totalBitrate += (dBytes * 8) / 1000 / dtSec;
          }
          const lossPct =
            packetsSent > 0
              ? (packetsLost / Math.max(1, packetsSent + packetsLost)) * 100
              : 0;
          worstLoss = Math.max(worstLoss, lossPct);
          worstRtt = Math.max(worstRtt, rtt);

          // Aggregate ICE: "connected" only if every peer is connected.
          const ice = pc.iceConnectionState;
          if (
            ice === "failed" ||
            ice === "disconnected" ||
            ice === "closed"
          ) {
            worstIce = ice;
          } else if (
            worstIce === "connected" &&
            ice !== "connected" &&
            ice !== "completed"
          ) {
            worstIce = ice;
          }
          if (ice === "connected" || ice === "completed") healthyPeers += 1;
        }),
      );
      void settled;

      if (cancelled) return;

      const peerCount = peers.length;
      const avgBitrate = peerCount > 0 ? totalBitrate / peerCount : 0;

      // Status thresholds — chosen for a 720p/24fps target around
      // 1500-2500 kbps. Tunable; surfaced as a single colour pill.
      let status: StreamHealth["status"] = "ok";
      if (worstIce === "failed" || worstIce === "closed") status = "offline";
      else if (worstIce === "disconnected" || worstLoss >= 8 || worstRtt > 600)
        status = "bad";
      else if (worstLoss >= 3 || worstRtt > 250 || avgBitrate < 400)
        status = "warn";

      setHealth({
        bitrateKbps: Math.round(avgBitrate),
        packetLossPct: Number(worstLoss.toFixed(1)),
        rttMs: Math.round(worstRtt),
        iceState: worstIce,
        status,
        sampledAt: Date.now(),
      });
    };

    // Fire once immediately so the topbar pill has data before the
    // first interval tick (~2s) lands.
    void tick();
    const id = setInterval(tick, intervalMs);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [active, intervalMs, getPeerConnections]);

  return health;
}
