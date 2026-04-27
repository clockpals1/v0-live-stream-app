/**
 * Integrations — Instagram via Meta Graph API (OAuth 2.0).
 *
 * Publishing requires a Business or Creator Instagram account connected
 * to a Facebook Page. This uses Facebook Login (not Instagram Basic Display
 * API) because only the Graph API supports content publishing.
 *
 * Scopes requested
 * ─────────────────
 *   instagram_basic           — read connected IG account info
 *   instagram_content_publish — upload photos, videos, Reels
 *   pages_show_list           — list the host's FB Pages
 *   pages_read_engagement     — required alongside pages_show_list
 *
 * Cloudflare Worker secrets required
 * ────────────────────────────────────
 *   META_APP_ID           — Meta App > Dashboard > App ID
 *   META_APP_SECRET       — Meta App > Settings > Basic > App Secret
 *   INSTAGRAM_REDIRECT_URI — must exactly match "Valid OAuth Redirect URIs"
 *                            in App > Facebook Login > Settings
 *
 * Token lifecycle
 * ───────────────
 *   Short-lived token (1 hour) → exchanged for long-lived on callback
 *   Long-lived token (60 days) → call refreshLongLivedToken before expiry
 *   No separate refresh_token — refreshing issues a NEW long-lived token
 *   Strategy: refresh when token_expires_at − now() < 10 days
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

export interface InstagramConfig {
  appId: string;
  appSecret: string;
  redirectUri: string;
}

export function getInstagramConfig(): InstagramConfig {
  const appId = readBinding("META_APP_ID");
  const appSecret = readBinding("META_APP_SECRET");
  const redirectUri = readBinding("INSTAGRAM_REDIRECT_URI");
  const missing: string[] = [];
  if (!appId) missing.push("META_APP_ID");
  if (!appSecret) missing.push("META_APP_SECRET");
  if (!redirectUri) missing.push("INSTAGRAM_REDIRECT_URI");
  if (missing.length) {
    throw new Error(
      `Instagram integration not configured. Missing Worker secrets: ${missing.join(", ")}`,
    );
  }
  return { appId: appId!, appSecret: appSecret!, redirectUri: redirectUri! };
}

export function isInstagramConfigured(): boolean {
  try {
    getInstagramConfig();
    return true;
  } catch {
    return false;
  }
}

// ─── OAuth ────────────────────────────────────────────────────────────

const SCOPES = [
  "instagram_basic",
  "instagram_content_publish",
  "pages_show_list",
  "pages_read_engagement",
];

/** Builds the Facebook Login consent URL that starts the OAuth flow. */
export function buildInstagramAuthUrl(state: string): string {
  const cfg = getInstagramConfig();
  const params = new URLSearchParams({
    client_id: cfg.appId,
    redirect_uri: cfg.redirectUri,
    scope: SCOPES.join(","),
    response_type: "code",
    state,
  });
  return `https://www.facebook.com/v19.0/dialog/oauth?${params.toString()}`;
}

interface ShortLivedToken {
  access_token: string;
  token_type: string;
}

/** Exchanges the authorization code for a short-lived (1h) user access token. */
export async function exchangeCodeForShortLivedToken(
  code: string,
): Promise<ShortLivedToken> {
  const cfg = getInstagramConfig();
  const url = new URL("https://graph.facebook.com/v19.0/oauth/access_token");
  url.searchParams.set("client_id", cfg.appId);
  url.searchParams.set("client_secret", cfg.appSecret);
  url.searchParams.set("redirect_uri", cfg.redirectUri);
  url.searchParams.set("code", code);
  const res = await fetch(url.toString());
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Meta code exchange failed (${res.status}): ${text}`);
  }
  return JSON.parse(text) as ShortLivedToken;
}

interface LongLivedToken {
  access_token: string;
  token_type: string;
  expires_in: number; // seconds (~5184000 = 60 days)
}

/** Exchanges a short-lived token for a long-lived (60-day) token. */
export async function exchangeForLongLivedToken(
  shortLivedToken: string,
): Promise<LongLivedToken> {
  const cfg = getInstagramConfig();
  const url = new URL("https://graph.instagram.com/access_token");
  url.searchParams.set("grant_type", "ig_exchange_token");
  url.searchParams.set("client_secret", cfg.appSecret);
  url.searchParams.set("access_token", shortLivedToken);
  const res = await fetch(url.toString());
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Instagram long-lived token exchange failed (${res.status}): ${text}`);
  }
  return JSON.parse(text) as LongLivedToken;
}

/** Refreshes a long-lived token before it expires. Returns a new long-lived token. */
export async function refreshLongLivedToken(
  currentToken: string,
): Promise<LongLivedToken> {
  const url = new URL("https://graph.instagram.com/refresh_access_token");
  url.searchParams.set("grant_type", "ig_refresh_token");
  url.searchParams.set("access_token", currentToken);
  const res = await fetch(url.toString());
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Instagram token refresh failed (${res.status}): ${text}`);
  }
  return JSON.parse(text) as LongLivedToken;
}

// ─── Account lookup ───────────────────────────────────────────────────

export interface InstagramAccount {
  id: string;
  name: string;
  profilePictureUrl: string | null;
}

/**
 * Gets the first Instagram Business Account connected to any Facebook Page
 * that the access token can see. Returns null if none are connected.
 */
export async function getConnectedInstagramAccount(
  accessToken: string,
): Promise<InstagramAccount | null> {
  const meRes = await fetch(
    "https://graph.facebook.com/v19.0/me?fields=id",
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!meRes.ok) throw new Error("Could not fetch user ID from Meta.");
  const me = (await meRes.json()) as { id: string };

  const pagesRes = await fetch(
    `https://graph.facebook.com/v19.0/${me.id}/accounts?fields=instagram_business_account`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!pagesRes.ok) throw new Error("Could not fetch Facebook pages.");
  const pages = (await pagesRes.json()) as {
    data?: Array<{ instagram_business_account?: { id: string } }>;
  };

  const igId = pages.data?.find((p) => p.instagram_business_account)
    ?.instagram_business_account?.id;
  if (!igId) return null;

  const igRes = await fetch(
    `https://graph.facebook.com/v19.0/${igId}?fields=id,name,profile_picture_url`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!igRes.ok) throw new Error("Could not fetch Instagram account details.");
  const ig = (await igRes.json()) as {
    id: string;
    name?: string;
    profile_picture_url?: string;
  };
  return {
    id: ig.id,
    name: ig.name ?? ig.id,
    profilePictureUrl: ig.profile_picture_url ?? null,
  };
}

// ─── Token validation from host_integrations ─────────────────────────

interface IntegrationRow {
  id: string;
  host_id: string;
  access_token: string;
  token_expires_at: string | null;
}

/**
 * Fetches the host's Instagram token, refreshing it if it expires within 10 days.
 * Returns null if no Instagram connection exists.
 */
export async function getValidInstagramToken(
  admin: SupabaseClient,
  hostId: string,
): Promise<{ accessToken: string; integration: IntegrationRow } | null> {
  const { data, error } = await admin
    .from("host_integrations")
    .select("id, host_id, access_token, token_expires_at")
    .eq("host_id", hostId)
    .eq("provider", "instagram")
    .maybeSingle();
  if (error) throw new Error(`Instagram integration lookup failed: ${error.message}`);
  if (!data) return null;

  const integration = data as IntegrationRow;
  const expiresAt = integration.token_expires_at
    ? new Date(integration.token_expires_at).getTime()
    : 0;
  const tenDays = 10 * 24 * 60 * 60 * 1000;
  const needsRefresh = !expiresAt || expiresAt - Date.now() < tenDays;

  if (!needsRefresh) {
    return { accessToken: integration.access_token, integration };
  }

  const refreshed = await refreshLongLivedToken(integration.access_token);
  const newExpiry = new Date(Date.now() + refreshed.expires_in * 1000);

  await admin
    .from("host_integrations")
    .update({
      access_token: refreshed.access_token,
      token_expires_at: newExpiry.toISOString(),
      last_refreshed_at: new Date().toISOString(),
    })
    .eq("id", integration.id);

  return {
    accessToken: refreshed.access_token,
    integration: { ...integration, access_token: refreshed.access_token },
  };
}
