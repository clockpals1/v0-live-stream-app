import type { NextRequest } from "next/server";

/**
 * Return the cookie `domain` attribute the auth session cookies should
 * use, or `undefined` if cookies should remain host-scoped.
 *
 * WHY THIS EXISTS
 * ---------------
 * The platform now runs on TWO subdomains of the same parent:
 *   - live.isunday.me   (live streaming surface)
 *   - studio.isunday.me (creator workspace)
 *
 * If the Supabase auth cookie is host-scoped (the default), a host who
 * signs in on live.isunday.me would be considered logged out the moment
 * they navigate to studio.isunday.me. Setting `domain=.isunday.me` on
 * the auth cookies makes the session visible on every isunday.me
 * subdomain — single sign-on, no duplicate logins.
 *
 * SCOPE
 * -----
 * We ONLY widen the domain for production hosts ending in `.isunday.me`.
 * For:
 *   - localhost / 127.0.0.1 / *.local       → return undefined
 *   - *.workers.dev preview deployments     → return undefined
 *   - any other host (custom test domain)   → return undefined
 * In each of those cases, host-scoped cookies are correct and a
 * `domain=.isunday.me` cookie would either be silently rejected
 * (localhost) or leak across unrelated previews.
 *
 * SECURITY NOTE
 * -------------
 * Widening cookie scope is a power-user move. A subdomain takeover on
 * any *.isunday.me host could read the session. We accept that risk
 * because (a) all isunday.me subdomains are first-party and managed by
 * us, and (b) the cookie is httpOnly + Secure + SameSite=Lax, which
 * already prevents JS exfiltration and cross-site CSRF.
 */
export function sharedCookieDomain(request: NextRequest): string | undefined {
  const host = request.headers.get("host")?.split(":")[0]?.toLowerCase() ?? "";
  if (!host) return undefined;
  if (host === "isunday.me" || host.endsWith(".isunday.me")) {
    return ".isunday.me";
  }
  return undefined;
}
