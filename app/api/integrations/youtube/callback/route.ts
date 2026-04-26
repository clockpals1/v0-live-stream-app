import { NextRequest, NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  exchangeCodeForTokens,
  getOwnChannel,
} from "@/lib/integrations/youtube";

/**
 * GET /api/integrations/youtube/callback
 *
 * Google redirects the user here after consent. We:
 *   1. Verify the state cookie matches the state param (CSRF).
 *   2. Exchange the code for tokens.
 *   3. Look up the channel id + name + avatar.
 *   4. Upsert host_integrations(host_id, 'youtube').
 *   5. Redirect back to /host/dashboard?youtube=connected (or =error).
 *
 * On any error we redirect back to the dashboard with ?youtube=error
 * and a query-string `reason` so the host gets a friendly toast.
 */

const APP_URL = (process.env.APP_URL ?? "https://live.isunday.me").replace(
  /\/$/,
  "",
);

function redirectToDashboard(
  status: "connected" | "error" | "cancelled",
  reason?: string,
) {
  const url = new URL(`${APP_URL}/host/dashboard`);
  url.searchParams.set("youtube", status);
  if (reason) url.searchParams.set("reason", reason.slice(0, 200));
  const res = NextResponse.redirect(url.toString());
  // Always clear the state cookie regardless of outcome.
  res.cookies.set("yt_oauth_state", "", {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/api/integrations/youtube",
    maxAge: 0,
  });
  return res;
}

export async function GET(req: NextRequest) {
  const search = req.nextUrl.searchParams;

  // Google sends ?error=access_denied if the user clicked Cancel.
  if (search.get("error")) {
    return redirectToDashboard("cancelled", search.get("error") ?? undefined);
  }

  const code = search.get("code");
  const state = search.get("state");
  if (!code || !state) {
    return redirectToDashboard("error", "Missing code or state.");
  }

  // CSRF verify.
  const cookieState = req.cookies.get("yt_oauth_state")?.value;
  if (!cookieState || cookieState !== state) {
    return redirectToDashboard("error", "Invalid CSRF state.");
  }

  // Auth: the user finishing the OAuth flow must still be signed in.
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return redirectToDashboard("error", "Not signed in.");
  }

  const admin = createAdminClient();
  const { data: host } = await admin
    .from("hosts")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!host) {
    return redirectToDashboard("error", "No host profile.");
  }

  // ─── token exchange ──────────────────────────────────────────────
  let tokens;
  try {
    tokens = await exchangeCodeForTokens(code);
  } catch (e) {
    console.error("[youtube/callback] code exchange failed:", e);
    return redirectToDashboard(
      "error",
      e instanceof Error ? e.message : "Token exchange failed.",
    );
  }

  // ─── channel lookup (best-effort; failure is non-fatal) ──────────
  let channel = null;
  try {
    channel = await getOwnChannel(tokens.access_token);
  } catch (e) {
    console.warn("[youtube/callback] channel lookup failed:", e);
    // Continue without channel info — we'll still save the tokens.
  }

  // ─── upsert ──────────────────────────────────────────────────────
  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000);
  const scopes = tokens.scope.split(" ").filter(Boolean);

  const { error: upsertErr } = await admin.from("host_integrations").upsert(
    {
      host_id: host.id,
      provider: "youtube",
      provider_account_id: channel?.id ?? null,
      provider_account_name: channel?.title ?? null,
      provider_account_avatar_url: channel?.thumbnailUrl ?? null,
      access_token: tokens.access_token,
      // refresh_token is omitted on subsequent re-auths if Google
      // already gave us one previously. We use prompt=consent to force
      // it, but defensively keep an existing one if Google still skips.
      ...(tokens.refresh_token
        ? { refresh_token: tokens.refresh_token }
        : {}),
      token_expires_at: expiresAt.toISOString(),
      scopes,
      metadata: {},
      connected_at: new Date().toISOString(),
      last_refreshed_at: new Date().toISOString(),
    },
    { onConflict: "host_id,provider" },
  );
  if (upsertErr) {
    console.error("[youtube/callback] upsert failed:", upsertErr.message);
    return redirectToDashboard("error", upsertErr.message);
  }

  return redirectToDashboard("connected");
}
