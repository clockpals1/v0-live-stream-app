import { NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { buildAuthUrl, isYoutubeConfigured } from "@/lib/integrations/youtube";

/**
 * GET /api/integrations/youtube/connect
 *
 * Starts the OAuth dance. Generates a CSRF state, stores it in an
 * HttpOnly cookie, and 302s the host to Google's consent screen.
 *
 * After the user grants access (or cancels), Google redirects them to
 * /api/integrations/youtube/callback which verifies the state cookie
 * and exchanges the code for tokens.
 */
export async function GET() {
  if (!isYoutubeConfigured()) {
    return NextResponse.json(
      {
        error:
          "YouTube integration is not configured on the server. Ask the admin to set GOOGLE_* secrets.",
      },
      { status: 503 },
    );
  }

  // Auth check — only signed-in users start the connect flow.
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  // CSRF state: 32 random bytes, hex-encoded. Stored both in the URL
  // (state param Google echoes back) and in an HttpOnly cookie. The
  // callback rejects any callback whose state param doesn't match the
  // cookie — defeats arbitrary code injection from drive-by links.
  const stateBytes = new Uint8Array(32);
  crypto.getRandomValues(stateBytes);
  const state = Array.from(stateBytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  const url = buildAuthUrl(state);
  const res = NextResponse.redirect(url);
  res.cookies.set("yt_oauth_state", state, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/api/integrations/youtube",
    maxAge: 600, // 10 minutes — generous for human consent flows.
  });
  return res;
}
