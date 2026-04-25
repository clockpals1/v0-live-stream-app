"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { exchangeCodeFromUrl } from "@/lib/auth/exchange-code";
import { Loader2 } from "lucide-react";

/**
 * Smart post-auth router.
 *
 * REASON THIS EXISTS
 * ------------------
 * Supabase's email-link flow uses `redirect_to` to choose where the user
 * lands after the token is verified. If the redirect_to URL is not on the
 * project's "Redirect URLs" allow list (very common when query strings are
 * involved), Supabase silently falls back to the bare Site URL, sending
 * the user to "https://live.isunday.me/?code=..." with NO path hint.
 *
 * Without this router the user would land on the marketing homepage with a
 * dangling ?code= and have no way to complete password reset or know their
 * signup was confirmed.
 *
 * BEHAVIOR
 * --------
 * 1. Read ?code= from the URL.
 * 2. Exchange it for a session.
 * 3. Inspect the resulting user to guess intent:
 *      - email_confirmed_at within the last 5 min → signup just confirmed
 *        → redirect to /auth/confirmed (clean success state)
 *      - email_confirmed_at older OR last_sign_in_at present
 *        → recovery flow → redirect to /auth/reset-password (ask for new pw)
 * 4. On exchange failure → /auth/auth-error?reason=exchange_failed
 *
 * The forgot-password and signup pages now use path-only redirect_to URLs
 * (/auth/reset-password and /auth/confirmed), so this router is mainly a
 * safety net for the bare-domain fallback. It also handles legacy emails
 * already in inboxes from before this fix.
 */
export default function PostAuthPage() {
  const router = useRouter();
  const [stage, setStage] = useState<"exchanging" | "routing">("exchanging");

  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();
    // Snapshot the ?type= BEFORE exchange — exchangeCodeFromUrl strips
    // verification params from the URL on success.
    const urlType =
      typeof window !== "undefined"
        ? new URLSearchParams(window.location.search).get("type")
        : null;
    (async () => {
      const result = await exchangeCodeFromUrl(supabase);
      if (cancelled) return;

      if (result.status === "expired") {
        router.replace("/auth/error?reason=callback_failed");
        return;
      }
      if (result.status === "error") {
        router.replace("/auth/error?reason=exchange_failed");
        return;
      }
      if (result.status === "no_code") {
        // No code, no session — bounce to login.
        router.replace("/auth/login");
        return;
      }

      setStage("routing");

      // Prefer the explicit ?type= param (snapshotted before exchange) —
      // it's an unambiguous signal of intent for token_hash emails.
      if (urlType === "signup" || urlType === "invite" || urlType === "email_change") {
        router.replace("/auth/confirmed");
        return;
      }
      if (urlType === "recovery") {
        router.replace("/auth/reset-password");
        return;
      }

      // Fallback heuristic for PKCE / legacy emails without a type hint:
      // a freshly-confirmed email_confirmed_at means signup just happened.
      const { data } = await supabase.auth.getUser();
      const user = data.user;
      if (!user) {
        router.replace("/auth/login");
        return;
      }

      const confirmedAt = user.email_confirmed_at
        ? new Date(user.email_confirmed_at).getTime()
        : 0;
      const now = Date.now();
      const FIVE_MIN = 5 * 60 * 1000;
      const justConfirmed = confirmedAt > 0 && now - confirmedAt < FIVE_MIN;

      if (justConfirmed) {
        router.replace("/auth/confirmed");
      } else {
        router.replace("/auth/reset-password");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [router]);

  const label =
    stage === "exchanging" ? "Verifying your link…" : "Taking you to the right place…";

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="flex items-center gap-2 text-muted-foreground text-sm">
        <Loader2 className="w-4 h-4 animate-spin" />
        {label}
      </div>
    </div>
  );
}
