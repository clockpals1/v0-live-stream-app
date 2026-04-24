"use client";

/**
 * Client-side helper that fetches Twilio TURN credentials from the
 * server route `/api/turn-credentials` and caches them at module level.
 *
 * Twilio tokens last 1 hour. We reuse a cached token for up to 50 minutes
 * so we have a 10-minute safety margin before expiry. Each fetch counts
 * against Twilio rate limits, so aggressive caching matters.
 *
 * This module is intentionally separate from `get-ice-servers.ts` because
 * Twilio is a CONDITIONAL FALLBACK — only fetched when ICE actually fails
 * or gets stuck. The default path (STUN-only direct P2P) never touches it.
 */

let _cached: RTCIceServer[] | null = null;
let _cachedAt = 0;
let _inflight: Promise<RTCIceServer[] | null> | null = null;

const CACHE_TTL_MS = 50 * 60 * 1000; // 50 minutes

export function hasFreshTurnCreds(): boolean {
  return !!_cached && Date.now() - _cachedAt < CACHE_TTL_MS;
}

/**
 * Fetch Twilio TURN credentials, deduplicating concurrent callers and
 * reusing the cached value when still fresh (< 50 min old). Returns null
 * when Twilio is not configured on the server or the call failed — the
 * caller should then continue with STUN-only (no disruption).
 */
export async function getTwilioTurnCreds(): Promise<RTCIceServer[] | null> {
  if (hasFreshTurnCreds()) return _cached;
  if (_inflight) return _inflight;

  _inflight = (async () => {
    try {
      const res = await fetch("/api/turn-credentials", { cache: "no-store" });
      if (!res.ok) {
        console.warn("[turn] fetch failed:", res.status);
        return null;
      }
      const data = (await res.json()) as { iceServers?: RTCIceServer[] };
      const servers = Array.isArray(data.iceServers) ? data.iceServers : [];
      if (servers.length === 0) return null;
      _cached = servers;
      _cachedAt = Date.now();
      console.log("[turn] Twilio TURN creds cached:", servers.length, "servers");
      return servers;
    } catch (err) {
      console.warn("[turn] fetch exception:", err);
      return null;
    } finally {
      _inflight = null;
    }
  })();

  return _inflight;
}
