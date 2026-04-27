import { NextRequest, NextResponse } from "next/server";
import { reportError } from "@/lib/observability/sentry";

/**
 * POST /api/observability/client-error
 *
 * Receives uncaught client-side errors from app/global-error.tsx and
 * forwards them to Sentry server-side. Doing the forward server-side
 * keeps the Sentry DSN out of the client bundle.
 */
export async function POST(req: NextRequest) {
  let body: {
    message?: string;
    stack?: string;
    digest?: string;
    url?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  // Reconstruct an Error-like object so the Sentry envelope has a
  // stack trace.
  const err = Object.assign(new Error(body.message || "Client error"), {
    stack: body.stack,
  });

  await reportError(err, {
    source: "client",
    tags: { digest: body.digest ?? null, url: body.url ?? null },
    level: "error",
  });

  return NextResponse.json({ ok: true });
}
