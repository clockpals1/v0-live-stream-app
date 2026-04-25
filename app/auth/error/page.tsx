"use client";

import { Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Radio, AlertCircle } from "lucide-react";

/**
 * Generic auth-error landing page.
 *
 * Used when:
 *   - /auth/callback fails to exchange a PKCE code
 *   - /auth/post-auth fails to exchange or route
 *   - any auth flow needs to surface an unrecoverable error
 *
 * Reads ?reason= and renders a human message. Always offers recovery CTAs.
 */

const REASONS: Record<string, { title: string; body: string }> = {
  callback_failed: {
    title: "Sign-in link couldn't be verified",
    body: "We couldn't verify the link you clicked. It may have expired, already been used, or been opened on a different device than the one you requested it from.",
  },
  exchange_failed: {
    title: "Authentication failed",
    body: "Your sign-in token couldn't be exchanged. Please request a new link.",
  },
  default: {
    title: "Something went wrong",
    body: "We couldn't complete that authentication step. Please try again or request a new link.",
  },
};

function AuthErrorContent() {
  const searchParams = useSearchParams();
  const reason = searchParams.get("reason") ?? "default";
  const meta = REASONS[reason] ?? REASONS.default;

  return (
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
        <div className="flex justify-center mb-2">
          <div className="w-12 h-12 bg-destructive/15 rounded-full flex items-center justify-center">
            <AlertCircle className="w-6 h-6 text-destructive" />
          </div>
        </div>
        <CardTitle className="text-2xl">{meta.title}</CardTitle>
        <CardDescription>{meta.body}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <Button asChild className="w-full">
          <Link href="/auth/login">Sign In</Link>
        </Button>
        <Button asChild variant="outline" className="w-full">
          <Link href="/auth/forgot-password">Request new reset link</Link>
        </Button>
        <Button asChild variant="ghost" className="w-full">
          <Link href="/">Back to home</Link>
        </Button>
      </CardContent>
    </Card>
  );
}

export default function AuthErrorPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Suspense fallback={null}>
        <AuthErrorContent />
      </Suspense>
    </div>
  );
}
