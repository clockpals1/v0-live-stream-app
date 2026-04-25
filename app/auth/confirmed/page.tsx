"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { exchangeCodeFromUrl } from "@/lib/auth/exchange-code";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Radio, Loader2, CheckCircle2, AlertCircle } from "lucide-react";

/**
 * Email confirmation landing page.
 *
 * Reached when a user clicks the "Confirm your email" link sent after
 * /auth/signup. The link arrives as /auth/confirmed?code=<pkce_code>.
 *
 * Possible outcomes:
 *  - ok                 → "Email confirmed" success state, CTA to dashboard
 *  - already_authed     → same success state (user is signed in)
 *  - expired            → "Link expired or already used" with CTA to login
 *  - no_code            → user opened the page directly; show login CTA
 *  - error              → unexpected error; show message + login CTA
 *
 * Public route. No middleware-level auth required.
 */
export default function ConfirmedPage() {
  const [state, setState] = useState<
    "checking" | "ok" | "expired" | "no_code" | "error"
  >("checking");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();
    (async () => {
      const result = await exchangeCodeFromUrl(supabase);
      if (cancelled) return;
      if (result.status === "ok" || result.status === "already_authed") {
        setState("ok");
      } else if (result.status === "expired") {
        setState("expired");
      } else if (result.status === "no_code") {
        setState("no_code");
      } else {
        setErrorMessage(result.message);
        setState("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="flex items-center justify-center gap-2 mb-4">
            <div className="w-10 h-10 bg-primary rounded-xl flex items-center justify-center">
              <Radio className="w-5 h-5 text-primary-foreground" />
            </div>
            <span className="text-xl font-bold text-foreground">
              Isunday Stream Live
            </span>
          </div>
          {state === "checking" && (
            <>
              <CardTitle className="text-2xl">
                Confirming your email…
              </CardTitle>
              <CardDescription>
                <span className="inline-flex items-center gap-2 text-muted-foreground">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Verifying your link
                </span>
              </CardDescription>
            </>
          )}
          {state === "ok" && (
            <>
              <div className="flex justify-center mb-2">
                <div className="w-12 h-12 bg-emerald-500/15 rounded-full flex items-center justify-center">
                  <CheckCircle2 className="w-6 h-6 text-emerald-600" />
                </div>
              </div>
              <CardTitle className="text-2xl">Email Confirmed</CardTitle>
              <CardDescription>
                Your account is ready. You&apos;re now signed in and can start
                hosting streams.
              </CardDescription>
            </>
          )}
          {state === "expired" && (
            <>
              <div className="flex justify-center mb-2">
                <div className="w-12 h-12 bg-amber-500/15 rounded-full flex items-center justify-center">
                  <AlertCircle className="w-6 h-6 text-amber-600" />
                </div>
              </div>
              <CardTitle className="text-2xl">Link expired</CardTitle>
              <CardDescription>
                This confirmation link is no longer valid. It may have already
                been used, or it may have expired. If your email is already
                confirmed, you can sign in directly.
              </CardDescription>
            </>
          )}
          {state === "no_code" && (
            <>
              <div className="flex justify-center mb-2">
                <div className="w-12 h-12 bg-muted rounded-full flex items-center justify-center">
                  <AlertCircle className="w-6 h-6 text-muted-foreground" />
                </div>
              </div>
              <CardTitle className="text-2xl">Nothing to confirm</CardTitle>
              <CardDescription>
                There&apos;s no confirmation token on this page. If you got
                here by clicking an email link, the link may have already been
                used. Try signing in.
              </CardDescription>
            </>
          )}
          {state === "error" && (
            <>
              <div className="flex justify-center mb-2">
                <div className="w-12 h-12 bg-destructive/15 rounded-full flex items-center justify-center">
                  <AlertCircle className="w-6 h-6 text-destructive" />
                </div>
              </div>
              <CardTitle className="text-2xl">
                We couldn&apos;t confirm your email
              </CardTitle>
              <CardDescription>
                {errorMessage ?? "An unexpected error occurred."}
              </CardDescription>
            </>
          )}
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {state === "ok" && (
            <Button asChild className="w-full">
              <Link href="/host/dashboard">Go to Dashboard</Link>
            </Button>
          )}
          {(state === "expired" || state === "no_code" || state === "error") && (
            <>
              <Button asChild className="w-full">
                <Link href="/auth/login">Sign In</Link>
              </Button>
              <Button asChild variant="ghost" className="w-full">
                <Link href="/auth/signup">Create a new account</Link>
              </Button>
            </>
          )}
          {state === "checking" && null}
        </CardContent>
      </Card>
    </div>
  );
}
