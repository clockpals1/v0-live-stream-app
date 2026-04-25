"use client";

/**
 * Shared client helper to exchange a Supabase PKCE `?code=` parameter for a
 * session. Used by every dedicated auth-email landing page (reset-password,
 * confirmed, post-auth) so each handles its own code without depending on the
 * /auth/callback route handler.
 *
 * WHY EACH PAGE EXCHANGES ITS OWN CODE
 * ------------------------------------
 * Supabase's "Redirect URLs" allow list is strict — if the redirect_to we
 * send (including any query string) does not match an entry exactly, Supabase
 * silently strips it and uses the bare Site URL instead. That is what caused
 * email links to land at "https://live.isunday.me/?code=..." with no path.
 *
 * The robust fix: send users to a path-only redirect_to (e.g.
 * "/auth/reset-password" or "/auth/confirmed"), and let that page perform
 * the PKCE exchange itself. No /auth/callback hop required.
 *
 * RETURN SHAPE
 * ------------
 * Discriminated union — never throws. Callers pattern-match on `status`.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export type ExchangeResult =
  | { status: "ok" }
  | { status: "no_code" } // no ?code= in URL
  | { status: "already_authed" } // session already exists; nothing to do
  | { status: "expired" } // common Supabase error: invalid / expired / used
  | { status: "error"; message: string };

/**
 * Exchange the `code` query param in the current URL for a session.
 *
 * - If there is no `?code=` and the user already has a session, returns
 *   `already_authed`. If neither, returns `no_code`.
 * - If exchange succeeds, removes `?code=` from the visible URL via
 *   history.replaceState so refreshing the page doesn't try to re-exchange
 *   an already-used code.
 * - Maps the most common Supabase recovery error messages to `expired`
 *   so callers can render a clean "link expired" UI without parsing strings.
 */
export async function exchangeCodeFromUrl(
  supabase: SupabaseClient,
): Promise<ExchangeResult> {
  if (typeof window === "undefined") return { status: "no_code" };

  const url = new URL(window.location.href);
  const code = url.searchParams.get("code");

  if (!code) {
    // Either user already exchanged on a previous mount, or they navigated
    // here directly. Distinguish via getUser().
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) return { status: "no_code" };
    return { status: "already_authed" };
  }

  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    const msg = (error.message || "").toLowerCase();
    // Supabase returns various phrasings for expired/used codes. Treat them
    // uniformly so callers can render one nice UI.
    if (
      msg.includes("expired") ||
      msg.includes("invalid") ||
      msg.includes("not found") ||
      msg.includes("already been used") ||
      msg.includes("no rows")
    ) {
      return { status: "expired" };
    }
    return { status: "error", message: error.message };
  }

  // Strip ?code= from the visible URL so a refresh doesn't try again.
  url.searchParams.delete("code");
  url.searchParams.delete("type");
  window.history.replaceState({}, "", url.pathname + url.search + url.hash);

  return { status: "ok" };
}
