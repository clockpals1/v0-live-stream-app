import { createBrowserClient } from "@supabase/ssr";
import type { AuthChangeEvent } from "@supabase/supabase-js";

/**
 * Compute the cookie domain attribute Supabase auth cookies should
 * use in the browser, mirroring the server-side
 * `sharedCookieDomain` helper.
 *
 * WHY THIS EXISTS — the studio/live disconnect bug
 * ------------------------------------------------
 * The browser client is what `signInWithPassword` / `signUp` /
 * `signOut` use. Without a `domain` cookie option, every auth cookie
 * those calls write is host-scoped to whichever subdomain the user
 * happened to be on.
 *
 * That meant: sign in on live.isunday.me → cookie set on
 * `live.isunday.me` only → studio.isunday.me sees no session →
 * apparent "logged out" the moment the user crosses subdomains.
 *
 * Setting `domain=.isunday.me` here makes every browser-written auth
 * cookie visible on every isunday.me subdomain. Combined with the
 * matching server-side logic this gives us true SSO across surfaces.
 */
function browserCookieDomain(): string | undefined {
  if (typeof window === "undefined") return undefined;
  const host = window.location.hostname.toLowerCase();
  if (host === "isunday.me" || host.endsWith(".isunday.me")) {
    return ".isunday.me";
  }
  // Localhost, *.workers.dev previews, custom test hosts → leave the
  // cookie host-scoped. Browsers reject `domain=` attributes that
  // don't match the registrable suffix of the current host, so we
  // can't unconditionally set this.
  return undefined;
}

let client: ReturnType<typeof createBrowserClient> | null = null;

export function createClient() {
  if (client) return client;

  const domain = browserCookieDomain();

  client = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    domain
      ? {
          cookieOptions: {
            domain,
            path: "/",
            sameSite: "lax",
            secure: true,
          },
        }
      : undefined,
  );

  // When the SDK signs out (including after a failed refresh-token exchange),
  // purge every sb-* / supabase-* entry from localStorage so the
  // auto-refresh interval does not keep hammering POST /auth/v1/token
  // with the now-invalid refresh token, which triggers 429 storms.
  client.auth.onAuthStateChange((event: AuthChangeEvent) => {
    if (event !== "SIGNED_OUT") return;
    if (typeof window === "undefined") return;
    const stale: string[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      if (k && (k.startsWith("sb-") || k.includes("supabase"))) stale.push(k);
    }
    stale.forEach((k) => window.localStorage.removeItem(k));
  });

  return client;
}
