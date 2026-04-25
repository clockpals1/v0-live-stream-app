"use client";

/**
 * Shared client helper for verifying Supabase auth-email links.
 *
 * Supports BOTH email-link flows:
 *
 * 1. token_hash + type  (RECOMMENDED for email confirmation & password reset)
 *    URL shape:  /auth/confirmed?token_hash=...&type=signup
 *                /auth/reset-password?token_hash=...&type=recovery
 *    Verified via supabase.auth.verifyOtp(). Server-side verification, NO
 *    client-stored secret required. Works cross-device — user can sign up
 *    on a laptop and click the email on their phone.
 *
 * 2. code  (PKCE — used by interactive OAuth / magic-link sign-in)
 *    URL shape:  /auth/...?code=...
 *    Verified via supabase.auth.exchangeCodeForSession(). REQUIRES a code
 *    verifier stored in the same browser's localStorage from the original
 *    auth request. Fails ("invalid_grant") if the user opens the link on a
 *    different device or after clearing storage. Kept as a fallback for
 *    legacy emails or clients that we don't control.
 *
 * The handler tries flow 1 first, then flow 2.
 *
 * To enable flow 1 globally for signup/recovery, the project's Supabase
 * email templates must be updated to use {{ .TokenHash }} URLs (see the
 * README / commit notes). Until then, flow 2 will keep working for
 * users who click the email in the same browser they signed up from.
 *
 * RETURN SHAPE
 * ------------
 * Discriminated union — never throws. Callers pattern-match on `status`.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

/** Supabase OTP types we care about for email links. */
type OtpType = "signup" | "recovery" | "invite" | "email_change" | "magiclink" | "email";

export type ExchangeResult =
  | { status: "ok" }
  | { status: "no_code" } // no token_hash and no code in URL
  | { status: "already_authed" } // session already exists; nothing to do
  | { status: "expired" } // invalid / expired / used / device-bound failure
  | { status: "error"; message: string };

const ALLOWED_OTP_TYPES: ReadonlySet<string> = new Set([
  "signup",
  "recovery",
  "invite",
  "email_change",
  "magiclink",
  "email",
]);

const isExpiredLikeMessage = (msg: string): boolean => {
  const m = msg.toLowerCase();
  return (
    m.includes("expired") ||
    m.includes("invalid") ||
    m.includes("not found") ||
    m.includes("already been used") ||
    m.includes("no rows") ||
    m.includes("flow_state_not_found") ||
    m.includes("code verifier")
  );
};

/**
 * Verify whatever auth-link parameters are present in the current URL.
 *
 * - If no params and the user already has a session → `already_authed`.
 * - If no params and no session → `no_code`.
 * - On success, strips the verification params from the visible URL so a
 *   refresh doesn't try to re-verify an already-consumed token.
 * - Common Supabase error phrasings (expired / invalid / used / missing
 *   verifier) all map to `expired` so callers render one clean UI.
 */
export async function exchangeCodeFromUrl(
  supabase: SupabaseClient,
): Promise<ExchangeResult> {
  if (typeof window === "undefined") return { status: "no_code" };

  const url = new URL(window.location.href);
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type");
  const code = url.searchParams.get("code");

  // ── Flow 1: token_hash + type (cross-device) ────────────────────────────
  if (tokenHash && type && ALLOWED_OTP_TYPES.has(type)) {
    const { error } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type: type as OtpType,
    });
    if (error) {
      if (isExpiredLikeMessage(error.message || "")) {
        return { status: "expired" };
      }
      return { status: "error", message: error.message };
    }
    cleanUrl(url);
    return { status: "ok" };
  }

  // ── Flow 2: PKCE code (same-browser only) ───────────────────────────────
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      if (isExpiredLikeMessage(error.message || "")) {
        return { status: "expired" };
      }
      return { status: "error", message: error.message };
    }
    cleanUrl(url);
    return { status: "ok" };
  }

  // ── No verification params: distinguish already-authed vs nothing ───────
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return { status: "no_code" };
  return { status: "already_authed" };
}

/** Remove all auth params from the visible URL after a successful verify. */
function cleanUrl(url: URL): void {
  url.searchParams.delete("code");
  url.searchParams.delete("token_hash");
  url.searchParams.delete("type");
  window.history.replaceState({}, "", url.pathname + url.search + url.hash);
}
