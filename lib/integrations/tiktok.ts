/**
 * Integrations — TikTok Content Posting API v2 (OAuth 2.0).
 *
 * Scopes requested
 * ─────────────────
 *   user.info.basic  — read display name, avatar URL, open_id
 *   video.upload     — upload videos to TikTok
 *
 * Cloudflare Worker secrets required
 * ────────────────────────────────────
 *   TIKTOK_CLIENT_KEY    — from TikTok for Developers > App > App Key
 *   TIKTOK_CLIENT_SECRET — App > App Secret
 *   TIKTOK_REDIRECT_URI  — must exactly match the redirect URI in the app
 *                          e.g. https://live.isunday.me/api/integrations/tiktok/callback
 *
 * Token lifecycle
 * ───────────────
 *   access_token  — valid for 24 hours (86400s)
 *   refresh_token — valid for 365 days; exchange before access expires
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

export interface TiktokConfig {
  clientKey: string;
  clientSecret: string;
  redirectUri: string;
}

export function getTiktokConfig(): TiktokConfig {
  const clientKey = readBinding("TIKTOK_CLIENT_KEY");
  const clientSecret = readBinding("TIKTOK_CLIENT_SECRET");
  const redirectUri = readBinding("TIKTOK_REDIRECT_URI");
  const missing: string[] = [];
  if (!clientKey) missing.push("TIKTOK_CLIENT_KEY");
  if (!clientSecret) missing.push("TIKTOK_CLIENT_SECRET");
  if (!redirectUri) missing.push("TIKTOK_REDIRECT_URI");
  if (missing.length) {
    throw new Error(
      `TikTok integration not configured. Missing Worker secrets: ${missing.join(", ")}`,
    );
  }
  return { clientKey: clientKey!, clientSecret: clientSecret!, redirectUri: redirectUri! };
}

export function isTiktokConfigured(): boolean {
  try {
    getTiktokConfig();
    return true;
  } catch {
    return false;
  }
}

// ─── OAuth ────────────────────────────────────────────────────────────

const SCOPES = ["user.info.basic", "video.upload"];

export function buildTiktokAuthUrl(state: string, csrfToken: string): string {
  const cfg = getTiktokConfig();
  const params = new URLSearchParams({
    client_key: cfg.clientKey,
    scope: SCOPES.join(","),
    response_type: "code",
    redirect_uri: cfg.redirectUri,
    state,
    // TikTok requires a separate csrf_state param on top of state
    csrf_state: csrfToken,
  });
  return `https://www.tiktok.com/v2/auth/authorize/?${params.toString()}`;
}

interface TiktokTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;       // seconds (access token lifetime)
  refresh_expires_in: number; // seconds (refresh token lifetime)
  open_id: string;
  scope: string;
  token_type: string;
}

/** Exchanges the authorization code for access + refresh tokens. */
export async function exchangeTiktokCode(code: string): Promise<TiktokTokenResponse> {
  const cfg = getTiktokConfig();
  const body = new URLSearchParams({
    client_key: cfg.clientKey,
    client_secret: cfg.clientSecret,
    code,
    grant_type: "authorization_code",
    redirect_uri: cfg.redirectUri,
  });
  const res = await fetch("https://open.tiktokapis.com/v2/oauth/token/", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`TikTok code exchange failed (${res.status}): ${text}`);
  }
  const json = JSON.parse(text) as { data?: TiktokTokenResponse; error?: string };
  if (json.error) throw new Error(`TikTok error: ${json.error}`);
  return json.data!;
}

/** Refreshes the access token using the stored refresh_token. */
export async function refreshTiktokToken(refreshToken: string): Promise<{
  access_token: string;
  refresh_token: string;
  expires_in: number;
  refresh_expires_in: number;
}> {
  const cfg = getTiktokConfig();
  const body = new URLSearchParams({
    client_key: cfg.clientKey,
    client_secret: cfg.clientSecret,
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });
  const res = await fetch("https://open.tiktokapis.com/v2/oauth/token/", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`TikTok token refresh failed (${res.status}): ${text}`);
  const json = JSON.parse(text) as { data?: { access_token: string; refresh_token: string; expires_in: number; refresh_expires_in: number }; error?: string };
  if (json.error) throw new Error(`TikTok error: ${json.error}`);
  return json.data!;
}

// ─── User info lookup ─────────────────────────────────────────────────

export interface TiktokUser {
  openId: string;
  displayName: string;
  avatarUrl: string | null;
}

export async function getTiktokUser(accessToken: string): Promise<TiktokUser> {
  const res = await fetch(
    "https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name,avatar_url",
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`TikTok user info failed (${res.status}): ${text}`);
  }
  const json = (await res.json()) as {
    data?: { user?: { open_id?: string; display_name?: string; avatar_url?: string } };
    error?: { code?: string; message?: string };
  };
  if (json.error?.code && json.error.code !== "ok") {
    throw new Error(`TikTok user info error: ${json.error.message}`);
  }
  const user = json.data?.user;
  return {
    openId: user?.open_id ?? "",
    displayName: user?.display_name ?? "TikTok user",
    avatarUrl: user?.avatar_url ?? null,
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

/** Gets a valid TikTok access token, refreshing if within 60s of expiry. */
export async function getValidTiktokToken(
  admin: SupabaseClient,
  hostId: string,
): Promise<{ accessToken: string; integration: IntegrationRow } | null> {
  const { data, error } = await admin
    .from("host_integrations")
    .select("id, host_id, access_token, refresh_token, token_expires_at")
    .eq("host_id", hostId)
    .eq("provider", "tiktok")
    .maybeSingle();
  if (error) throw new Error(`TikTok integration lookup failed: ${error.message}`);
  if (!data) return null;

  const integration = data as IntegrationRow;
  const expiresAt = integration.token_expires_at
    ? new Date(integration.token_expires_at).getTime()
    : 0;
  const needsRefresh = !expiresAt || expiresAt - Date.now() < 60_000;

  if (!needsRefresh) return { accessToken: integration.access_token, integration };

  if (!integration.refresh_token) {
    throw new Error("TikTok access expired and no refresh token stored. Reconnect required.");
  }

  const refreshed = await refreshTiktokToken(integration.refresh_token);
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
