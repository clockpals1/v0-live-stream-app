"use client";

import { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Radio, Loader2 } from "lucide-react";

export default function LoginPage() {
  // useSearchParams forces dynamic rendering; the Suspense boundary is
  // the canonical Next.js fix so the static shell can prerender.
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const searchParams = useSearchParams();

  // Where to send the user after sign-in. Defaults to the host
  // dashboard but a deep-link bounce (e.g. clicking Like on a public
  // replay) sets ?next=/r/abc so we route back. Restrict to relative
  // paths (must start with a single "/") to avoid open-redirect into
  // a phishing domain.
  const rawNext = searchParams?.get("next") ?? null;
  const safeNext =
    rawNext && rawNext.startsWith("/") && !rawNext.startsWith("//")
      ? rawNext
      : "/host/dashboard";

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      const msg = error.message ?? "";
      const isRateLimit =
        msg.toLowerCase().includes("rate limit") ||
        msg.toLowerCase().includes("too many") ||
        error.status === 429;
      setError(
        isRateLimit
          ? "Too many sign-in attempts. Please wait a few minutes before trying again."
          : msg,
      );
      setLoading(false);
      return;
    }

    router.push(safeNext);
    router.refresh();
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="flex items-center justify-center gap-2 mb-4">
            <div className="w-10 h-10 bg-primary rounded-xl flex items-center justify-center">
              <Radio className="w-5 h-5 text-primary-foreground" />
            </div>
            <span className="text-xl font-bold text-foreground">Isunday Stream Live</span>
          </div>
          <CardTitle className="text-2xl">Host Login</CardTitle>
          <CardDescription>
            Sign in to your host account to start streaming
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleLogin} className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                placeholder="Your password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            {error && (
              <p className="text-sm text-destructive">{error}</p>
            )}
            <Button type="submit" disabled={loading} className="w-full">
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Signing in...
                </>
              ) : (
                "Sign In"
              )}
            </Button>
            <div className="flex flex-col gap-2 text-center text-sm">
              <Link href="/auth/forgot-password" className="text-primary hover:underline">
                Forgot password?
              </Link>
              <p className="text-muted-foreground">
                Don&apos;t have an account?{" "}
                <Link href="/auth/signup" className="text-primary hover:underline">
                  Sign up
                </Link>
              </p>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
