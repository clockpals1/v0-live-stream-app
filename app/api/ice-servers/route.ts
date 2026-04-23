import { NextResponse } from "next/server";

// Static fallback — openrelay (free, public Metered.ca tier).
// Used when METERED_API_KEY / METERED_APP_NAME env vars are not set.
const FALLBACK_ICE_SERVERS = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
  // UDP — works on most home/office networks
  {
    urls: "turn:openrelay.metered.ca:80",
    username: "openrelayproject",
    credential: "openrelayproject",
  },
  // TCP-443 — bypasses carrier-level firewalls (Nigeria mobile networks)
  {
    urls: "turn:openrelay.metered.ca:443?transport=tcp",
    username: "openrelayproject",
    credential: "openrelayproject",
  },
  // TLS-443 — looks identical to HTTPS, works through deep-packet-inspection
  {
    urls: "turns:openrelay.metered.ca:443",
    username: "openrelayproject",
    credential: "openrelayproject",
  },
];

export async function GET() {
  const apiKey = process.env.METERED_API_KEY;
  const appName = process.env.METERED_APP_NAME;

  if (!apiKey || !appName) {
    return NextResponse.json(FALLBACK_ICE_SERVERS, {
      headers: { "Cache-Control": "public, max-age=300" },
    });
  }

  try {
    const res = await fetch(
      `https://${appName}.metered.live/api/v1/turn/credentials?apiKey=${apiKey}`,
      { next: { revalidate: 3600 } }
    );
    if (!res.ok) throw new Error(`Metered API ${res.status}`);
    const iceServers = await res.json();
    return NextResponse.json(iceServers, {
      headers: { "Cache-Control": "public, max-age=3600" },
    });
  } catch (err) {
    console.error("[ice-servers] Metered.ca fetch failed, using fallback:", err);
    return NextResponse.json(FALLBACK_ICE_SERVERS, {
      headers: { "Cache-Control": "public, max-age=300" },
    });
  }
}
