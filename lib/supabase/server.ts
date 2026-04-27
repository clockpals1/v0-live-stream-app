import { createServerClient } from "@supabase/ssr";
import { cookies, headers } from "next/headers";

/**
 * Compute the cookie domain to attach to Supabase auth cookies in
 * server-side code paths (server actions, route handlers).
 *
 * Mirror of `sharedCookieDomain` in ./cookie-options.ts but fed from
 * next/headers' `headers()` because we don't have a NextRequest here.
 */
function serverSharedCookieDomain(host: string | null): string | undefined {
  const h = host?.split(":")[0]?.toLowerCase() ?? "";
  if (!h) return undefined;
  if (h === "isunday.me" || h.endsWith(".isunday.me")) return ".isunday.me";
  return undefined;
}

export async function createClient() {
  const cookieStore = await cookies();
  const headerStore = await headers();
  const cookieDomain = serverSharedCookieDomain(headerStore.get("host"));

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => {
              const merged = cookieDomain
                ? { ...options, domain: cookieDomain }
                : options;
              cookieStore.set(name, value, merged);
            });
          } catch {
            // The `setAll` method was called from a Server Component.
            // This can be ignored if you have middleware refreshing user sessions.
          }
        },
      },
    }
  );
}
