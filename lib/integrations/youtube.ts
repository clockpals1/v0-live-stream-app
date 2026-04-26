/**
 * Integrations — YouTube (Data API v3, OAuth 2.0).
 *
 * What this file does
 * -------------------
 * 1. Builds the OAuth consent URL we redirect the host to.
 * 2. Exchanges the authorization code for access + refresh tokens.
 * 3. Refreshes access tokens on demand (transparent to callers).
 * 4. Looks up the connected channel's id + name + avatar.
 * 5. Creates a resumable upload session for a video — the browser
 *    PUTs the bytes to the resulting upload URL.
 *
 * What this file deliberately does NOT do
 * ---------------------------------------
 * - Stream the video bytes through the Worker. Workers have request
 *   body and CPU budgets that make multi-GB uploads brittle. Instead
 *   we follow the same pattern as R2: server creates a session, gives
 *   the URL to the browser, browser PUTs the blob directly. YouTube's
 *   resumable upload URLs are session-scoped (no Authorization header
 *   needed on the PUT), which is exactly what we want.
 *
 * Configuration
 * -------------
 * Set these as Cloudflare Worker secrets:
 *   GOOGLE_CLIENT_ID
 *   GOOGLE_CLIENT_SECRET
 *   GOOGLE_OAUTH_REDIRECT_URI   — must match the URI registered in
 *                                  Google Cloud Console exactly. For
 *                                  prod that's:
 *                                  https://live.isunday.me/api/integrations/youtube/callback
 *
 * Scopes we request
 * -----------------
 *   youtube.upload   — upload videos
 *   youtube.readonly — read channel info (name, id) for display
 */

import type { SupabaseClient } from "@supabase/supabase-js";

// ─── env access (matches createAdminClient pattern) ───────────────────

interface YoutubeBindings {
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  GOOGLE_OAUTH_REDIRECT_URI?: string;
}

function readBinding(name: keyof YoutubeBindings): string | undefined {
  const fromProc = (process.env as Record<string, string | undefined>)[
    name as string
  ];
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

export interface YoutubeConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export function getYoutubeConfig(): YoutubeConfig {
  const clientId = readBinding("GOOGLE_CLIENT_ID");
  const clientSecret = readBinding("GOOGLE_CLIENT_SECRET");
  const redirectUri = readBinding("GOOGLE_OAUTH_REDIRECT_URI");
  const missing: string[] = [];
  if (!clientId) missing.push("GOOGLE_CLIENT_ID");
  if (!clientSecret) missing.push("GOOGLE_CLIENT_SECRET");
  if (!redirectUri) missing.push("GOOGLE_OAUTH_REDIRECT_URI");
  if (missing.length) {
    throw new Error(
      `YouTube integration is not configured. Missing Cloudflare Worker secrets: ${missing.join(", ")}.`,
    );
  }
  return {
    clientId: clientId!,
    clientSecret: clientSecret!,
    redirectUri: redirectUri!,
  };
}

export function isYoutubeConfigured(): boolean {
  try {
    getYoutubeConfig();
    return true;
  } catch {
    return false;
  }
}

// ─── OAuth ────────────────────────────────────────────────────────────

const SCOPES = [
  "https://www.googleapis.com/auth/youtube.upload",
  "https://www.googleapis.com/auth/youtube.readonly",
];

/**
 * Build the URL that starts Google's OAuth consent flow. `state` is
 * an opaque value our callback will verify against a cookie to defeat
 * CSRF. `prompt=consent` forces Google to re-show the consent screen
 * even on subsequent connects, which is the only way to be sure they
 * mint a new refresh_token (Google omits it on silent renewals).
 */
export function buildAuthUrl(state: string): string {
  const cfg = getYoutubeConfig();
  const params = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: cfg.redirectUri,
    response_type: "code",
    scope: SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope: string;
  token_type: "Bearer";
  id_token?: string;
}

/**
 * Exchange an authorization code for tokens. Called from the OAuth
 * callback route exactly once per code. Throws on any non-2xx so the
 * callback can render a clear error page.
 */
export async function exchangeCodeForTokens(
  code: string,
): Promise<TokenResponse> {
  const cfg = getYoutubeConfig();
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      redirect_uri: cfg.redirectUri,
      grant_type: "authorization_code",
    }),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Google token exchange failed (${res.status}): ${text}`);
  }
  return JSON.parse(text) as TokenResponse;
}

/**
 * Refresh an access token using the stored refresh_token. Google does
 * not return a new refresh_token in the response — keep using the
 * original. Throws if Google rejects the refresh (most commonly
 * because the host revoked our access in their Google account).
 */
export async function refreshAccessToken(refreshToken: string): Promise<{
  access_token: string;
  expires_in: number;
}> {
  const cfg = getYoutubeConfig();
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Google token refresh failed (${res.status}): ${text}`);
  }
  return JSON.parse(text) as { access_token: string; expires_in: number };
}

// ─── Channel lookup ──────────────────────────────────────────────────

export interface ChannelSummary {
  id: string;
  title: string;
  thumbnailUrl: string | null;
}

export async function getOwnChannel(
  accessToken: string,
): Promise<ChannelSummary | null> {
  const res = await fetch(
    "https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true",
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`YouTube channel lookup failed (${res.status}): ${text}`);
  }
  const json = (await res.json()) as {
    items?: Array<{
      id: string;
      snippet: {
        title: string;
        thumbnails?: { default?: { url?: string }; medium?: { url?: string } };
      };
    }>;
  };
  const ch = json.items?.[0];
  if (!ch) return null;
  return {
    id: ch.id,
    title: ch.snippet.title,
    thumbnailUrl:
      ch.snippet.thumbnails?.medium?.url ??
      ch.snippet.thumbnails?.default?.url ??
      null,
  };
}

// ─── Token resolution from the host_integrations row ─────────────────

interface IntegrationRow {
  id: string;
  host_id: string;
  access_token: string;
  refresh_token: string | null;
  token_expires_at: string | null;
}

/**
 * Fetch the host's youtube row and return a *valid* (refreshed if
 * needed) access token. Persists the refreshed token before returning
 * so the next call doesn't refresh again.
 */
export async function getValidAccessToken(
  admin: SupabaseClient,
  hostId: string,
): Promise<{ accessToken: string; integration: IntegrationRow } | null> {
  const { data, error } = await admin
    .from("host_integrations")
    .select("id, host_id, access_token, refresh_token, token_expires_at")
    .eq("host_id", hostId)
    .eq("provider", "youtube")
    .maybeSingle();
  if (error) {
    throw new Error(`Integration lookup failed: ${error.message}`);
  }
  if (!data) return null;
  const integration = data as IntegrationRow;

  // Refresh 60s early to absorb clock skew.
  const expiresAt = integration.token_expires_at
    ? new Date(integration.token_expires_at).getTime()
    : 0;
  const needsRefresh = !expiresAt || expiresAt - Date.now() < 60_000;

  if (!needsRefresh) {
    return { accessToken: integration.access_token, integration };
  }

  if (!integration.refresh_token) {
    // We cached the access token but never got a refresh_token. That
    // happens if the user revoked us and re-connected without consent
    // prompt, or if Google omitted it on the second exchange. Treat
    // this as "needs reconnect."
    throw new Error(
      "YouTube access expired and no refresh token is stored. Reconnect required.",
    );
  }

  const refreshed = await refreshAccessToken(integration.refresh_token);
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
    integration: {
      ...integration,
      access_token: refreshed.access_token,
      token_expires_at: newExpiry.toISOString(),
    },
  };
}

// ─── Resumable upload ────────────────────────────────────────────────

export interface ResumableUploadInit {
  uploadUrl: string;
  contentLength: number;
  contentType: string;
}

/**
 * Initiate a YouTube resumable upload session. Returns the upload URL
 * the browser should PUT the bytes to. The session URL is single-use
 * and authenticates the upload itself — no Authorization header is
 * needed on the PUT, which is the whole point (browser never sees
 * our access token).
 *
 * Privacy status notes
 *   privacyStatus 'private' is the safest default; the host can flip
 *   it to public from YouTube's UI later. Some hosts will want
 *   'unlisted' for friends-only sharing — exposed as a parameter.
 */
export async function initResumableUpload(args: {
  accessToken: string;
  title: string;
  description?: string;
  privacyStatus?: "private" | "unlisted" | "public";
  categoryId?: string;
  tags?: string[];
  contentType: string;
  contentLength: number;
}): Promise<ResumableUploadInit> {
  const metadata = {
    snippet: {
      title: args.title.slice(0, 100),
      description: args.description?.slice(0, 5000) ?? "",
      tags: args.tags ?? [],
      categoryId: args.categoryId ?? "22", // 22 = People & Blogs (a safe default)
    },
    status: {
      privacyStatus: args.privacyStatus ?? "private",
      selfDeclaredMadeForKids: false,
    },
  };

  const res = await fetch(
    "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${args.accessToken}`,
        "Content-Type": "application/json; charset=UTF-8",
        "X-Upload-Content-Length": String(args.contentLength),
        "X-Upload-Content-Type": args.contentType,
      },
      body: JSON.stringify(metadata),
    },
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `YouTube resumable upload init failed (${res.status}): ${text}`,
    );
  }

  const uploadUrl = res.headers.get("Location");
  if (!uploadUrl) {
    throw new Error(
      "YouTube did not return an upload URL — check that the youtube.upload scope is granted.",
    );
  }

  return {
    uploadUrl,
    contentLength: args.contentLength,
    contentType: args.contentType,
  };
}
