"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { exchangeCodeFromUrl } from "@/lib/auth/exchange-code";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Radio, Loader2, CheckCircle2, AlertCircle } from "lucide-react";

/**
 * Reset password page.
 *
 * FLOW
 * ----
 * 1. User clicks "Send Reset Link" on /auth/forgot-password.
 * 2. Supabase emails a link that ultimately lands here as
 *      /auth/reset-password?code=<pkce_code>
 * 3. On mount we exchange the code for a recovery session.
 * 4. Once the session is established, supabase.auth.updateUser({ password })
 *    works against the authenticated client.
 *
 * Each auth-email landing page exchanges its own code (rather than going
 * through /auth/callback) because Supabase's redirect_to allow list strips
 * any query-string mismatch. Path-only redirect_to URLs survive consistently.
 *
 * RESILIENCE
 * ----------
 * - No code in URL + no existing session → "link expired" state.
 * - Code in URL but exchange fails (used / expired / invalid) → same state.
 * - Code in URL and exchange succeeds OR session already present → form.
 */
export default function ResetPasswordPage() {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [sessionState, setSessionState] = useState<
    "checking" | "ready" | "missing"
  >("checking");
  const router = useRouter();

  // Exchange ?code= for a session if present, then verify a session exists.
  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();
    (async () => {
      const result = await exchangeCodeFromUrl(supabase);
      if (cancelled) return;
      if (result.status === "ok" || result.status === "already_authed") {
        setSessionState("ready");
        return;
      }
      // no_code / expired / error all map to the same UX:
      // "this reset link is no longer valid, request a new one".
      setSessionState("missing");
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (password !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }
    if (password.length < 6) {
      setError("Password must be at least 6 characters");
      return;
    }

    setLoading(true);

    const supabase = createClient();
    const { error: updateError } = await supabase.auth.updateUser({ password });

    if (updateError) {
      setError(updateError.message);
      setLoading(false);
      return;
    }

    setSubmitted(true);
    setLoading(false);

    // Give the user a moment to read the success state before redirecting.
    setTimeout(() => {
      router.push("/host/dashboard");
    }, 1800);
  };

  // ─── Success state ────────────────────────────────────────────────────────
  if (submitted) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <div className="flex items-center justify-center gap-2 mb-4">
              <div className="w-10 h-10 bg-emerald-500/15 rounded-xl flex items-center justify-center">
                <CheckCircle2 className="w-5 h-5 text-emerald-600" />
              </div>
            </div>
            <CardTitle className="text-2xl">Password Updated</CardTitle>
            <CardDescription>
              Your password was changed successfully. Redirecting you to the
              dashboard…
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant="outline" className="w-full">
              <Link href="/host/dashboard">Continue to dashboard</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ─── Stale-link / no-session state ────────────────────────────────────────
  if (sessionState === "missing") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <div className="flex items-center justify-center gap-2 mb-4">
              <div className="w-10 h-10 bg-amber-500/15 rounded-xl flex items-center justify-center">
                <AlertCircle className="w-5 h-5 text-amber-600" />
              </div>
            </div>
            <CardTitle className="text-2xl">Reset link expired</CardTitle>
            <CardDescription>
              This password reset link is no longer valid. It may have already
              been used, or it may have been opened on a different device than
              the one you requested it from. Request a new link to continue.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            <Button asChild className="w-full">
              <Link href="/auth/forgot-password">Request a new link</Link>
            </Button>
            <Button asChild variant="ghost" className="w-full">
              <Link href="/auth/login">Back to login</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ─── Loading state while we verify the session ────────────────────────────
  if (sessionState === "checking") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <div className="flex items-center gap-2 text-muted-foreground text-sm">
          <Loader2 className="w-4 h-4 animate-spin" />
          Verifying reset link…
        </div>
      </div>
    );
  }

  // ─── Form ─────────────────────────────────────────────────────────────────
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
          <CardTitle className="text-2xl">Set New Password</CardTitle>
          <CardDescription>Enter your new password below</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleReset} className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="password">New Password</Label>
              <Input
                id="password"
                type="password"
                placeholder="Min 6 characters"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                minLength={6}
                required
                autoFocus
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="confirmPassword">Confirm Password</Label>
              <Input
                id="confirmPassword"
                type="password"
                placeholder="Confirm your password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                minLength={6}
                required
              />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" disabled={loading} className="w-full">
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Updating…
                </>
              ) : (
                "Update Password"
              )}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
