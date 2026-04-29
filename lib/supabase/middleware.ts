import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { sharedCookieDomain } from "./cookie-options";

/**
 * Determine the "surface" the request is targeting based on the host
 * header. We support two product surfaces on the same Next.js app:
 *
 *   - "live"   → live.isunday.me (default; matches localhost, *.workers.dev)
 *   - "studio" → studio.isunday.me (creator/business surface)
 *
 * Surface detection lets one middleware rewrite the URL into the right
 * route group, share auth cookies across both subdomains, and enforce
 * surface-specific access (live.* shouldn't expose /studio/*, etc.).
 */
function detectSurface(host: string | null): "live" | "studio" | "ai" {
  if (!host) return "live";
  // Strip port if present.
  const h = host.split(":")[0]?.toLowerCase() ?? "";
  if (h === "studio.isunday.me" || h.startsWith("studio.")) return "studio";
  if (h === "ai.isunday.me" || h.startsWith("ai.")) return "ai";
  return "live";
}

export async function updateSession(request: NextRequest) {
  const surface = detectSurface(request.headers.get("host"));
  const cookieDomain = sharedCookieDomain(request);

  let supabaseResponse = NextResponse.next({
    request,
  });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          supabaseResponse = NextResponse.next({
            request,
          });
          cookiesToSet.forEach(({ name, value, options }) => {
            // Override cookie domain so the auth session is visible on
            // both live.isunday.me and studio.isunday.me. In dev /
            // workers.dev the helper returns undefined and we fall
            // through to default host-scoped cookies.
            const merged = cookieDomain
              ? { ...options, domain: cookieDomain }
              : options;
            supabaseResponse.cookies.set(name, value, merged);
          });
        },
      },
    },
  );

  const path = request.nextUrl.pathname;

  // Auth pages are always public — skip the Supabase network call so we
  // don't hammer the token endpoint with refresh attempts from pages that
  // don't need an authenticated session.
  const isAuthPath = path.startsWith("/auth");

  let user = null;
  if (!isAuthPath) {
    const { data } = await supabase.auth.getUser();
    user = data.user;

    // If getUser() returned no user but the browser sent stale sb-* auth
    // cookies (e.g. an expired / revoked refresh token), delete them from
    // the response now.  Without this the browser re-sends the same broken
    // tokens on every subsequent request, triggering repeated
    // POST /auth/v1/token?grant_type=refresh_token → 400 loops.
    if (!user) {
      const stale = request.cookies.getAll().filter((c) => c.name.startsWith("sb-"));
      if (stale.length > 0) {
        stale.forEach((c) => supabaseResponse.cookies.delete(c.name));
      }
    }
  }

  // ─── Surface-aware rewrites ───────────────────────────────────────────
  // ─── AI surface rewrites ─────────────────────────────────────────────
  if (surface === "ai") {
    if (path.startsWith("/host")) {
      const url = request.nextUrl.clone();
      url.host = "live.isunday.me";
      return NextResponse.redirect(url);
    }
    // ai.isunday.me/studio/* → cross-surface redirect to studio subdomain
    if (path.startsWith("/studio")) {
      const url = request.nextUrl.clone();
      url.host = "studio.isunday.me";
      url.pathname = path.replace(/^\/studio/, "") || "/";
      return NextResponse.redirect(url);
    }
    const isShared =
      path.startsWith("/auth") ||
      path.startsWith("/api") ||
      path.startsWith("/admin") ||
      path.startsWith("/_next") ||
      path === "/favicon.ico";
    if (!isShared && !path.startsWith("/ai")) {
      const url = request.nextUrl.clone();
      url.pathname = `/ai${path === "/" ? "" : path}`;
      return NextResponse.rewrite(url);
    }
  } else if (surface === "studio") {
    // studio.isunday.me/host/*  is forbidden — the host dashboard belongs
    // to the live surface. Redirect there cleanly.
    if (path.startsWith("/host")) {
      const url = request.nextUrl.clone();
      url.host = "live.isunday.me";
      return NextResponse.redirect(url);
    }
    // studio.isunday.me/ai/* → cross-surface redirect to AI subdomain
    if (path.startsWith("/ai")) {
      const url = request.nextUrl.clone();
      url.host = "ai.isunday.me";
      url.pathname = path.replace(/^\/ai/, "") || "/";
      return NextResponse.redirect(url);
    }
    // Skip rewrites for shared paths (auth, api, admin, _next assets,
    // and /r — public replay pages must resolve identically on both
    // subdomains so share links work everywhere).
    const isShared =
      path.startsWith("/auth") ||
      path.startsWith("/api") ||
      path.startsWith("/admin") ||
      path.startsWith("/_next") ||
      path.startsWith("/r/") ||
      path === "/favicon.ico";
    if (!isShared && !path.startsWith("/studio")) {
      // studio.isunday.me/foo  →  internal /studio/foo
      const url = request.nextUrl.clone();
      url.pathname = `/studio${path === "/" ? "" : path}`;
      // We DO need to keep the query string. nextUrl.clone() already
      // carries it; just rewriting the pathname is enough.
      return NextResponse.rewrite(url);
    }
  } else {
    // live.isunday.me/studio/* → redirect to studio subdomain
    if (path.startsWith("/studio")) {
      const url = request.nextUrl.clone();
      url.host = "studio.isunday.me";
      url.pathname = path.replace(/^\/studio/, "") || "/";
      return NextResponse.redirect(url);
    }
    // live.isunday.me/ai/* → redirect to ai subdomain
    if (path.startsWith("/ai")) {
      const url = request.nextUrl.clone();
      url.host = "ai.isunday.me";
      url.pathname = path.replace(/^\/ai/, "") || "/";
      return NextResponse.redirect(url);
    }
  }

  // ─── Auth gates ───────────────────────────────────────────────────────
  // Both surfaces require auth on /host (live) and /studio (studio).
  // /studio is gated here AFTER the rewrite so the path matches what we
  // actually serve (/studio/replay, /studio/audience, …).
  if (path.startsWith("/host") && !user) {
    const url = request.nextUrl.clone();
    const returnTo = request.nextUrl.pathname + request.nextUrl.search;
    url.pathname = "/auth/login";
    url.searchParams.set("next", returnTo);
    return NextResponse.redirect(url);
  }
  // /ai/* gate — same pattern; richer role/plan checks in the layout.
  if (path.startsWith("/ai") && !user) {
    const url = request.nextUrl.clone();
    const returnTo = request.nextUrl.pathname + request.nextUrl.search;
    url.pathname = "/auth/login";
    url.searchParams.set("next", returnTo);
    return NextResponse.redirect(url);
  }
  // Note: /studio gate runs in the layout (server component) for richer
  // role/plan checks. Middleware just gets the session in shape.

  return supabaseResponse;
}
