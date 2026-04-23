"use client";

import { ICE_SERVERS } from "./config";

// ---------- module-level cache (survives re-renders, cleared on page reload) ----------
let _cached: RTCIceServer[] | null = null;
let _cacheAt = 0;
let _inflight: Promise<void> | null = null;
const TTL = 3_600_000; // 1 hour

function _fetch(): Promise<void> {
  if (_inflight) return _inflight; // deduplicate concurrent calls
  _inflight = fetch("/api/ice-servers", { cache: "no-store" })
    .then((res) => {
      if (!res.ok) throw new Error(`/api/ice-servers ${res.status}`);
      return res.json() as Promise<RTCIceServer[]>;
    })
    .then((servers) => {
      _cached = servers;
      _cacheAt = Date.now();
      console.log("[ice] ICE servers pre-warmed:", servers.length, "entries");
    })
    .catch((err) => {
      console.warn("[ice] Pre-warm failed — static fallback will be used:", err);
    })
    .finally(() => {
      _inflight = null;
    });
  return _inflight;
}

/**
 * Call once on component mount (e.g. in a useEffect with [] deps).
 * Starts fetching dynamic TURN credentials in the background so they are
 * ready before the first peer connection is needed. Safe to call multiple
 * times — duplicate in-flight requests are deduplicated automatically.
 */
export function warmIceServers(): void {
  if (_cached && Date.now() - _cacheAt < TTL) return; // already fresh
  _fetch();
}

/**
 * Returns RTCConfiguration SYNCHRONOUSLY from the in-memory cache.
 * Always returns immediately — falls back to the static ICE_SERVERS from
 * config.ts when warmIceServers() hasn't resolved yet (e.g. on first call).
 * Never blocks the peer-connection hot path.
 */
export function getIceConfig(): RTCConfiguration {
  if (_cached && Date.now() - _cacheAt < TTL) {
    return { ...ICE_SERVERS, iceServers: _cached };
  }
  return ICE_SERVERS; // safe fallback for all non-symmetric-NAT networks
}
