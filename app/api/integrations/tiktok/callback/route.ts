import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { exchangeTiktokCode, getTiktokUser } from "@/lib/integrations/tiktok";

const APP_URL = (process.env.APP_URL ?? "https://live.isunday.me").replace(/\/$/, "");

function redirectToPublish(status: "connected" | "error" | "cancelled", reason?: string) {
  const url = new URL(`${APP_URL}/ai/publish`);
  url.searchParams.set("tiktok", status);
  if (reason) url.searchParams.set("reason", reason.slice(0, 200));
  const res = NextResponse.redirect(url.toString());
  res.cookies.set("tt_oauth_state", "", {
    httpOnly: true, secure: true, sameSite: "lax",
    path: "/api/integrations/tiktok", maxAge: 0,
  });
  return res;
}

export async function GET(req: NextRequest) {
  const search = req.nextUrl.searchParams;
  if (search.get("error")) {
    return redirectToPublish("cancelled", search.get("error_description") ?? search.get("error") ?? undefined);
  }

  const code = search.get("code");
  const state = search.get("state");
  if (!code || !state) return redirectToPublish("error", "Missing code or state.");

  const cookieState = req.cookies.get("tt_oauth_state")?.value;
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

  let tokens;
  try {
    tokens = await exchangeTiktokCode(code);
  } catch (e) {
    return redirectToPublish("error", e instanceof Error ? e.message : "Token exchange failed.");
  }

  let tiktokUser = null;
  try {
    tiktokUser = await getTiktokUser(tokens.access_token);
  } catch (e) {
    console.warn("[tiktok/callback] user lookup failed (non-fatal):", e);
  }

  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000);

  const { error: upsertErr } = await admin.from("host_integrations").upsert(
    {
      host_id: host.id,
      provider: "tiktok",
      provider_account_id: tiktokUser?.openId ?? tokens.open_id ?? null,
      provider_account_name: tiktokUser?.displayName ?? null,
      provider_account_avatar_url: tiktokUser?.avatarUrl ?? null,
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      token_expires_at: expiresAt.toISOString(),
      scopes: tokens.scope.split(",").filter(Boolean),
      metadata: {},
      connected_at: new Date().toISOString(),
      last_refreshed_at: new Date().toISOString(),
    },
    { onConflict: "host_id,provider" },
  );
  if (upsertErr) return redirectToPublish("error", upsertErr.message);

  return redirectToPublish("connected");
}
