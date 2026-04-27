import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { buildInstagramAuthUrl, isInstagramConfigured } from "@/lib/integrations/instagram";

export async function GET() {
  if (!isInstagramConfigured()) {
    return NextResponse.json(
      { error: "Instagram integration is not configured. Ask the admin to set META_APP_ID, META_APP_SECRET, and INSTAGRAM_REDIRECT_URI." },
      { status: 503 },
    );
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const stateBytes = new Uint8Array(32);
  crypto.getRandomValues(stateBytes);
  const state = Array.from(stateBytes).map((b) => b.toString(16).padStart(2, "0")).join("");

  const url = buildInstagramAuthUrl(state);
  const res = NextResponse.redirect(url);
  res.cookies.set("ig_oauth_state", state, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/api/integrations/instagram",
    maxAge: 600,
  });
  return res;
}
