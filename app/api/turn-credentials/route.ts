import { NextResponse } from "next/server";

/**
 * Server-side route that returns SHORT-LIVED Twilio TURN credentials.
 *
 * Why a server route: Twilio Account SID and Auth Token must NEVER reach the
 * client bundle. This endpoint authenticates server-side and returns only
 * the ice_servers array (username/credential are ephemeral, 1h TTL).
 *
 * Env vars required:
 *   TWILIO_ACCOUNT_SID
 *   TWILIO_AUTH_TOKEN
 *
 * If the env vars are missing or the Twilio call fails, we respond with 503
 * so the client can gracefully fall back to STUN-only / existing paths.
 */

// Prevent caching at the edge — TURN creds are per-client, short-lived.
export const dynamic = "force-dynamic";
export const revalidate = 0;

interface TwilioIceServer {
  url?: string;
  urls?: string;
  username?: string;
  credential?: string;
}

interface TwilioTokenResponse {
  ice_servers?: TwilioIceServer[];
  ttl?: string;
}

export async function GET() {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;

  if (!sid || !token) {
    return NextResponse.json(
      { error: "twilio-not-configured" },
      { status: 503, headers: { "Cache-Control": "no-store" } }
    );
  }

  try {
    const auth = Buffer.from(`${sid}:${token}`).toString("base64");
    const res = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${sid}/Tokens.json`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${auth}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ Ttl: "3600" }).toString(),
        cache: "no-store",
      }
    );

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.error("[turn-credentials] Twilio error:", res.status, text);
      return NextResponse.json(
        { error: "twilio-fetch-failed", status: res.status },
        { status: 503, headers: { "Cache-Control": "no-store" } }
      );
    }

    const data = (await res.json()) as TwilioTokenResponse;
    const raw = data.ice_servers ?? [];

    // Normalize to RTCIceServer shape: modern browsers expect `urls`, not `url`.
    const iceServers: RTCIceServer[] = raw
      .map((s) => {
        const urls = s.urls ?? s.url;
        if (!urls) return null;
        const out: RTCIceServer = { urls };
        if (s.username) out.username = s.username;
        if (s.credential) out.credential = s.credential;
        return out;
      })
      .filter((s): s is RTCIceServer => s !== null);

    return NextResponse.json(
      { iceServers, ttl: Number(data.ttl ?? 3600) },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err) {
    console.error("[turn-credentials] Exception:", err);
    return NextResponse.json(
      { error: "twilio-exception" },
      { status: 503, headers: { "Cache-Control": "no-store" } }
    );
  }
}
