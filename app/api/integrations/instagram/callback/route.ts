import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  exchangeCodeForShortLivedToken,
  exchangeForLongLivedToken,
  getConnectedInstagramAccount,
} from "@/lib/integrations/instagram";

const APP_URL = (process.env.APP_URL ?? "https://live.isunday.me").replace(/\/$/, "");

function redirectToPublish(status: "connected" | "error" | "cancelled", reason?: string) {
  const url = new URL(`${APP_URL}/ai/publish`);
  url.searchParams.set("instagram", status);
  if (reason) url.searchParams.set("reason", reason.slice(0, 200));
  const res = NextResponse.redirect(url.toString());
  res.cookies.set("ig_oauth_state", "", {
    httpOnly: true, secure: true, sameSite: "lax",
    path: "/api/integrations/instagram", maxAge: 0,
  });
  return res;
}

export async function GET(req: NextRequest) {
  const search = req.nextUrl.searchParams;
  if (search.get("error")) {
    return redirectToPublish("cancelled", search.get("error") ?? undefined);
  }

  const code = search.get("code");
  const state = search.get("state");
  if (!code || !state) return redirectToPublish("error", "Missing code or state.");

  const cookieState = req.cookies.get("ig_oauth_state")?.value;
  if (!cookieState || cookieState !== state) {
    return redirectToPublish("error", "Invalid CSRF state.");
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return redirectToPublish("error", "Not signed in.");

  const admin = createAdminClient();
  const { data: host } = await admin
    .from("hosts").select("id").eq("user_id", user.id).maybeSingle();
  if (!host) return redirectToPublish("error", "No host profile.");

  let shortToken;
  try {
    shortToken = await exchangeCodeForShortLivedToken(code);
  } catch (e) {
    return redirectToPublish("error", e instanceof Error ? e.message : "Token exchange failed.");
  }

  let longToken;
  try {
    longToken = await exchangeForLongLivedToken(shortToken.access_token);
  } catch (e) {
    return redirectToPublish("error", e instanceof Error ? e.message : "Long-lived token exchange failed.");
  }

  let account = null;
  try {
    account = await getConnectedInstagramAccount(longToken.access_token);
  } catch (e) {
    console.warn("[instagram/callback] account lookup failed (non-fatal):", e);
  }

  const expiresAt = new Date(Date.now() + longToken.expires_in * 1000);

  const { error: upsertErr } = await admin.from("host_integrations").upsert(
    {
      host_id: host.id,
      provider: "instagram",
      provider_account_id: account?.id ?? null,
      provider_account_name: account?.name ?? null,
      provider_account_avatar_url: account?.profilePictureUrl ?? null,
      access_token: longToken.access_token,
      refresh_token: null,
      token_expires_at: expiresAt.toISOString(),
      scopes: ["instagram_basic", "instagram_content_publish", "pages_show_list", "pages_read_engagement"],
      metadata: {},
      connected_at: new Date().toISOString(),
      last_refreshed_at: new Date().toISOString(),
    },
    { onConflict: "host_id,provider" },
  );
  if (upsertErr) return redirectToPublish("error", upsertErr.message);

  return redirectToPublish("connected");
}
