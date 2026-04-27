import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { buildTiktokAuthUrl, isTiktokConfigured } from "@/lib/integrations/tiktok";

export async function GET() {
  if (!isTiktokConfigured()) {
    return NextResponse.json(
      { error: "TikTok integration is not configured. Ask the admin to set TIKTOK_CLIENT_KEY, TIKTOK_CLIENT_SECRET, and TIKTOK_REDIRECT_URI." },
      { status: 503 },
    );
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const stateBytes = new Uint8Array(32);
  crypto.getRandomValues(stateBytes);
  const state = Array.from(stateBytes).map((b) => b.toString(16).padStart(2, "0")).join("");
  // TikTok requires both state and csrf_state; we use the same value for both
  const url = buildTiktokAuthUrl(state, state);
  const res = NextResponse.redirect(url);
  res.cookies.set("tt_oauth_state", state, {
    httpOnly: true, secure: true, sameSite: "lax",
    path: "/api/integrations/tiktok", maxAge: 600,
  });
  return res;
}
