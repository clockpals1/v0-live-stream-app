import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { exchangeTwitterCode, getTwitterUser } from "@/lib/integrations/twitter";

const APP_URL = (process.env.APP_URL ?? "https://live.isunday.me").replace(/\/$/, "");

function clearCookies(res: NextResponse) {
  res.cookies.set("tw_oauth_state", "", { httpOnly: true, secure: true, sameSite: "lax", path: "/api/integrations/twitter", maxAge: 0 });
  res.cookies.set("tw_code_verifier", "", { httpOnly: true, secure: true, sameSite: "lax", path: "/api/integrations/twitter", maxAge: 0 });
  return res;
}

function redirectToPublish(status: "connected" | "error" | "cancelled", reason?: string) {
  const url = new URL(`${APP_URL}/ai/publish`);
  url.searchParams.set("twitter", status);
  if (reason) url.searchParams.set("reason", reason.slice(0, 200));
  return clearCookies(NextResponse.redirect(url.toString()));
}

export async function GET(req: NextRequest) {
  const search = req.nextUrl.searchParams;
  if (search.get("error")) {
    return redirectToPublish("cancelled", search.get("error_description") ?? search.get("error") ?? undefined);
  }

  const code = search.get("code");
  const state = search.get("state");
  if (!code || !state) return redirectToPublish("error", "Missing code or state.");

  const cookieState = req.cookies.get("tw_oauth_state")?.value;
  const codeVerifier = req.cookies.get("tw_code_verifier")?.value;
  if (!cookieState || cookieState !== state) return redirectToPublish("error", "Invalid CSRF state.");
  if (!codeVerifier) return redirectToPublish("error", "Missing PKCE code verifier.");

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return redirectToPublish("error", "Not signed in.");

  const admin = createAdminClient();
  const { data: host } = await admin
    .from("hosts").select("id").eq("user_id", user.id).maybeSingle();
  if (!host) return redirectToPublish("error", "No host profile.");

  let tokens;
  try {
    tokens = await exchangeTwitterCode(code, codeVerifier);
  } catch (e) {
    return redirectToPublish("error", e instanceof Error ? e.message : "Token exchange failed.");
  }

  let twitterUser = null;
  try {
    twitterUser = await getTwitterUser(tokens.access_token);
  } catch (e) {
    console.warn("[twitter/callback] user lookup failed (non-fatal):", e);
  }

  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000);
  const scopes = tokens.scope.split(" ").filter(Boolean);

  const { error: upsertErr } = await admin.from("host_integrations").upsert(
    {
      host_id: host.id,
      provider: "twitter",
      provider_account_id: twitterUser?.id ?? null,
      provider_account_name: twitterUser ? `${twitterUser.name} (@${twitterUser.username})` : null,
      provider_account_avatar_url: twitterUser?.profileImageUrl ?? null,
      access_token: tokens.access_token,
      ...(tokens.refresh_token ? { refresh_token: tokens.refresh_token } : {}),
      token_expires_at: expiresAt.toISOString(),
      scopes,
      metadata: {},
      connected_at: new Date().toISOString(),
      last_refreshed_at: new Date().toISOString(),
    },
    { onConflict: "host_id,provider" },
  );
  if (upsertErr) return redirectToPublish("error", upsertErr.message);

  return redirectToPublish("connected");
}
