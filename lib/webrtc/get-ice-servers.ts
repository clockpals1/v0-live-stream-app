"use client";

import { ICE_SERVERS } from "./config";

// Module-level cache so every peer connection in the same browser tab reuses
// the same credentials without re-fetching for up to 1 hour.
let _cached: RTCIceServer[] | null = null;
let _cacheAt = 0;
const TTL = 3_600_000; // 1 hour

/**
 * Returns an RTCConfiguration with freshly-fetched TURN credentials.
 * Falls back to the static ICE_SERVERS from config.ts if the API is
 * unreachable or env vars are not set.
 */
export async function getIceServers(): Promise<RTCConfiguration> {
  const now = Date.now();
  if (_cached && now - _cacheAt < TTL) {
    return { ...ICE_SERVERS, iceServers: _cached };
  }

  try {
    const res = await fetch("/api/ice-servers", { cache: "no-store" });
    if (res.ok) {
      const servers: RTCIceServer[] = await res.json();
      _cached = servers;
      _cacheAt = now;
      console.log("[ice] Dynamic ICE servers fetched:", servers.length, "entries");
      return { ...ICE_SERVERS, iceServers: servers };
    }
  } catch (err) {
    console.warn("[ice] Could not fetch dynamic ICE servers, using fallback:", err);
  }

  return ICE_SERVERS;
}
