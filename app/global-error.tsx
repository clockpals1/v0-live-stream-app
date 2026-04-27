"use client";

/**
 * Root-level client error boundary. Next.js renders this whenever
 * a server or client error escapes a per-segment error.tsx.
 *
 * We use it primarily to send the digest + stack to Sentry from the
 * client side. The real safety net is the API/server-side
 * `withErrorReporting` wrapper; this just catches the leftover.
 */

import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Best-effort report. We don't have a public Sentry DSN exposed
    // to the client (the server-side reporter handles the bulk of
    // events). If you want client-side Sentry, set
    // NEXT_PUBLIC_SENTRY_DSN and POST to it from here.
    const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
    if (dsn) {
      try {
        fetch("/api/observability/client-error", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: error.message,
            stack: error.stack,
            digest: error.digest,
            url: typeof window !== "undefined" ? window.location.href : null,
          }),
          keepalive: true,
        }).catch(() => undefined);
      } catch {
        /* no-op */
      }
    }
    console.error("[global-error]", error);
  }, [error]);

  return (
    <html>
      <body
        style={{
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "2rem",
          fontFamily: "system-ui, sans-serif",
          background: "#0a0a0a",
          color: "#fafafa",
        }}
      >
        <div style={{ maxWidth: 480, textAlign: "center" }}>
          <h1 style={{ fontSize: 22, marginBottom: 8 }}>Something broke.</h1>
          <p style={{ color: "#a1a1aa", marginBottom: 20, fontSize: 14 }}>
            We've logged the error. Please try again.
          </p>
          <button
            onClick={reset}
            style={{
              background: "#fafafa",
              color: "#0a0a0a",
              border: 0,
              padding: "10px 16px",
              borderRadius: 8,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Try again
          </button>
          {error.digest && (
            <div style={{ marginTop: 16, fontSize: 11, color: "#52525b" }}>
              ref: <code>{error.digest}</code>
            </div>
          )}
        </div>
      </body>
    </html>
  );
}
