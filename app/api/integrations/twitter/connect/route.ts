import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { buildTwitterAuthUrl, generatePKCE, isTwitterConfigured } from "@/lib/integrations/twitter";

export async function GET() {
  if (!isTwitterConfigured()) {
    return NextResponse.json(
      { error: "Twitter integration is not configured. Ask the admin to set TWITTER_CLIENT_ID, TWITTER_CLIENT_SECRET, and TWITTER_REDIRECT_URI." },
      { status: 503 },
    );
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const stateBytes = new Uint8Array(32);
  crypto.getRandomValues(stateBytes);
  const state = Array.from(stateBytes).map((b) => b.toString(16).padStart(2, "0")).join("");

  const { codeVerifier, codeChallenge } = await generatePKCE();
  const url = buildTwitterAuthUrl(state, codeChallenge);

  const res = NextResponse.redirect(url);
  res.cookies.set("tw_oauth_state", state, {
    httpOnly: true, secure: true, sameSite: "lax",
    path: "/api/integrations/twitter", maxAge: 600,
  });
  // code_verifier must survive the round-trip to callback
  res.cookies.set("tw_code_verifier", codeVerifier, {
    httpOnly: true, secure: true, sameSite: "lax",
    path: "/api/integrations/twitter", maxAge: 600,
  });
  return res;
}
