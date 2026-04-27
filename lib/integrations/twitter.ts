/**
 * Integrations — Twitter/X API v2 (OAuth 2.0 with PKCE).
 *
 * Uses Authorization Code with PKCE. The code_verifier is stored in an
 * HttpOnly cookie during the auth flow and consumed on callback. This
 * prevents authorization code injection attacks even without a secret.
 *
 * Scopes requested
 * ─────────────────
 *   tweet.read     — read own tweets (required for user context)
 *   tweet.write    — post new tweets
 *   users.read     — read own profile (name, avatar)
 *   offline.access — get a refresh token for long-lived sessions
 *
 * Cloudflare Worker secrets required
 * ────────────────────────────────────
 *   TWITTER_CLIENT_ID     — from developer.twitter.com > App > Keys & Tokens
 *   TWITTER_CLIENT_SECRET — Client Secret (keep it secret — prevents token theft)
 *   TWITTER_REDIRECT_URI  — must exactly match the Callback URI in the app settings
 *                           e.g. https://live.isunday.me/api/integrations/twitter/callback
 *
 * Token lifecycle
 * ───────────────
 *   access_token  — valid for 2 hours (7200s) when offline.access scope is granted
 *   refresh_token — valid until used once; each refresh yields a new pair
 *   Strategy: refresh when token_expires_at − now() < 60 seconds
 */

import type { SupabaseClient } from "@supabase/supabase-js";

// ─── env ──────────────────────────────────────────────────────────────

function readBinding(name: string): string | undefined {
  const fromProc = (process.env as Record<string, string | undefined>)[name];
  if (fromProc) return fromProc;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require("@opennextjs/cloudflare") as {
      getCloudflareContext?: () => { env: Record<string, unknown> };
    };
    const v = mod.getCloudflareContext?.().env?.[name];
    return typeof v === "string" ? v : undefined;
  } catch {
    return undefined;
  }
}

export interface TwitterConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export function getTwitterConfig(): TwitterConfig {
  const clientId = readBinding("TWITTER_CLIENT_ID");
  const clientSecret = readBinding("TWITTER_CLIENT_SECRET");
  const redirectUri = readBinding("TWITTER_REDIRECT_URI");
  const missing: string[] = [];
  if (!clientId) missing.push("TWITTER_CLIENT_ID");
  if (!clientSecret) missing.push("TWITTER_CLIENT_SECRET");
  if (!redirectUri) missing.push("TWITTER_REDIRECT_URI");
  if (missing.length) {
    throw new Error(
      `Twitter integration not configured. Missing Worker secrets: ${missing.join(", ")}`,
    );
  }
  return { clientId: clientId!, clientSecret: clientSecret!, redirectUri: redirectUri! };
}

export function isTwitterConfigured(): boolean {
  try {
    getTwitterConfig();
    return true;
  } catch {
    return false;
  }
}

// ─── PKCE helpers ─────────────────────────────────────────────────────

/**
 * Generates a code_verifier and code_challenge for PKCE.
 * code_verifier: 32 random bytes → base64url (43–128 chars, no padding)
 * code_challenge: SHA-256(code_verifier) → base64url
 */
export async function generatePKCE(): Promise<{
  codeVerifier: string;
  codeChallenge: string;
}> {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  const codeVerifier = btoa(String.fromCharCode(...array))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");

  const encoded = new TextEncoder().encode(codeVerifier);
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  const codeChallenge = btoa(
    String.fromCharCode(...new Uint8Array(digest)),
  )
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");

  return { codeVerifier, codeChallenge };
}

// ─── OAuth ────────────────────────────────────────────────────────────

const SCOPES = ["tweet.read", "tweet.write", "users.read", "offline.access"];

export function buildTwitterAuthUrl(state: string, codeChallenge: string): string {
  const cfg = getTwitterConfig();
  const params = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: cfg.redirectUri,
    response_type: "code",
    scope: SCOPES.join(" "),
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  });
  return `https://twitter.com/i/oauth2/authorize?${params.toString()}`;
}

interface TwitterTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope: string;
  token_type: "bearer";
}

/** Exchanges the authorization code (+ PKCE verifier) for tokens. */
export async function exchangeTwitterCode(
  code: string,
  codeVerifier: string,
): Promise<TwitterTokenResponse> {
  const cfg = getTwitterConfig();
  const body = new URLSearchParams({
    code,
    grant_type: "authorization_code",
    client_id: cfg.clientId,
    redirect_uri: cfg.redirectUri,
    code_verifier: codeVerifier,
  });

  const basicAuth = btoa(`${cfg.clientId}:${cfg.clientSecret}`);
  const res = await fetch("https://api.twitter.com/2/oauth2/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${basicAuth}`,
    },
    body,
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Twitter code exchange failed (${res.status}): ${text}`);
  }
  return JSON.parse(text) as TwitterTokenResponse;
}

/** Refreshes the access token. Returns a new pair (old refresh_token is invalidated). */
export async function refreshTwitterToken(refreshToken: string): Promise<{
  access_token: string;
  refresh_token: string;
  expires_in: number;
}> {
  const cfg = getTwitterConfig();
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: cfg.clientId,
  });
  const basicAuth = btoa(`${cfg.clientId}:${cfg.clientSecret}`);
  const res = await fetch("https://api.twitter.com/2/oauth2/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${basicAuth}`,
    },
    body,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Twitter token refresh failed (${res.status}): ${text}`);
  return JSON.parse(text) as { access_token: string; refresh_token: string; expires_in: number };
}

// ─── User info ────────────────────────────────────────────────────────

export interface TwitterUser {
  id: string;
  name: string;
  username: string;
  profileImageUrl: string | null;
}

export async function getTwitterUser(accessToken: string): Promise<TwitterUser> {
  const res = await fetch(
    "https://api.twitter.com/2/users/me?user.fields=profile_image_url",
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Twitter user info failed (${res.status}): ${text}`);
  }
  const json = (await res.json()) as {
    data?: { id: string; name: string; username: string; profile_image_url?: string };
  };
  const u = json.data!;
  return {
    id: u.id,
    name: u.name,
    username: u.username,
    profileImageUrl: u.profile_image_url ?? null,
  };
}

// ─── Token validation from host_integrations ─────────────────────────

interface IntegrationRow {
  id: string;
  host_id: string;
  access_token: string;
  refresh_token: string | null;
  token_expires_at: string | null;
}

/** Gets a valid Twitter access token, refreshing if within 60s of expiry. */
export async function getValidTwitterToken(
  admin: SupabaseClient,
  hostId: string,
): Promise<{ accessToken: string; integration: IntegrationRow } | null> {
  const { data, error } = await admin
    .from("host_integrations")
    .select("id, host_id, access_token, refresh_token, token_expires_at")
    .eq("host_id", hostId)
    .eq("provider", "twitter")
    .maybeSingle();
  if (error) throw new Error(`Twitter integration lookup failed: ${error.message}`);
  if (!data) return null;

  const integration = data as IntegrationRow;
  const expiresAt = integration.token_expires_at
    ? new Date(integration.token_expires_at).getTime()
    : 0;
  const needsRefresh = !expiresAt || expiresAt - Date.now() < 60_000;

  if (!needsRefresh) return { accessToken: integration.access_token, integration };

  if (!integration.refresh_token) {
    throw new Error("Twitter access expired and no refresh token stored. Reconnect required.");
  }

  const refreshed = await refreshTwitterToken(integration.refresh_token);
  const newExpiry = new Date(Date.now() + refreshed.expires_in * 1000);

  await admin.from("host_integrations").update({
    access_token: refreshed.access_token,
    refresh_token: refreshed.refresh_token,
    token_expires_at: newExpiry.toISOString(),
    last_refreshed_at: new Date().toISOString(),
  }).eq("id", integration.id);

  return {
    accessToken: refreshed.access_token,
    integration: {
      ...integration,
      access_token: refreshed.access_token,
      refresh_token: refreshed.refresh_token,
    },
  };
}
