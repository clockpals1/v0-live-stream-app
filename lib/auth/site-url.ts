/**
 * Single source of truth for the canonical site URL used in auth flows.
 *
 * WHY THIS EXISTS
 * ---------------
 * Supabase auth flows (resetPasswordForEmail, signUp with email confirmation,
 * OAuth, magic links, etc.) need a `redirectTo` URL. If we use
 * `window.location.origin` directly, the value is whatever host the user
 * happens to be visiting from at the moment they click the button — which
 * in dev is `http://localhost:3000`, and in any preview/staging deploy is
 * the preview URL. Both are valid runtime origins, but they end up baked
 * into the email link Supabase sends. That is how reset emails ended up
 * pointing at localhost.
 *
 * USAGE
 * -----
 *   import { siteUrl, authRedirect } from "@/lib/auth/site-url";
 *
 *   await supabase.auth.resetPasswordForEmail(email, {
 *     redirectTo: authRedirect("/auth/callback?next=/auth/reset-password"),
 *   });
 *
 * RESOLUTION ORDER
 * ----------------
 * 1. NEXT_PUBLIC_APP_URL (canonical, set in .env.production)
 * 2. NEXT_PUBLIC_SITE_URL (alternate name for the same purpose, if anyone
 *    sets it on Cloudflare)
 * 3. Browser: window.location.origin (dev only; SSR returns "")
 *
 * Trailing slashes are stripped so callers can always concatenate paths
 * starting with "/".
 *
 * NOTE
 * ----
 * `redirectTo` only controls where Supabase REDIRECTS to AFTER verifying
 * a token. The link inside the email body is built from the project's
 * Supabase Auth "Site URL" setting in the Supabase Dashboard. Both must
 * agree. See the README for the dashboard-side setup steps.
 */

const stripTrailingSlash = (s: string): string => s.replace(/\/+$/g, "");

/**
 * Returns the canonical absolute origin for this deployment, e.g.
 * `https://live.isunday.me`. Never has a trailing slash.
 *
 * Safe to call in both server and client components. On the server during
 * SSR the env vars are read; on the client they are inlined at build time
 * (NEXT_PUBLIC_*).
 */
export function siteUrl(): string {
  const fromEnv =
    process.env.NEXT_PUBLIC_APP_URL ?? process.env.NEXT_PUBLIC_SITE_URL ?? "";
  if (fromEnv) return stripTrailingSlash(fromEnv);
  if (typeof window !== "undefined" && window.location?.origin) {
    return stripTrailingSlash(window.location.origin);
  }
  return "";
}

/**
 * Build an absolute auth-redirect URL. `path` must start with "/".
 * If the resolved site URL is empty (SSR with no env var set, which should
 * never happen in practice), returns the path unchanged so the browser
 * resolves it relative to the current origin — never undefined / null.
 */
export function authRedirect(path: string): string {
  const base = siteUrl();
  if (!base) return path;
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}
