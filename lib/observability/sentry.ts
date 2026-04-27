/**
 * Minimal, dependency-free Sentry reporter.
 *
 * Why we don't use @sentry/nextjs / @sentry/cloudflare
 * ---------------------------------------------------
 * The official Sentry SDKs are great but they:
 *   1. Add ~150-300 KB to the Worker bundle (we just spent a whole
 *      afternoon shrinking the bundle to fit Cloudflare's 10 MB limit).
 *   2. Hook into Next.js's compiler in ways that frequently break with
 *      OpenNext / Workers (instrumentation files, edge-runtime import
 *      handling, etc.).
 *   3. Auto-instrument things we don't need (browser performance,
 *      profiling, replays).
 *
 * What we actually need is "POST a JSON envelope to Sentry's intake
 * endpoint when an error happens". That's ~50 lines.
 *
 * Configuration
 * -------------
 * Set the Worker secret SENTRY_DSN to enable. Format is the standard
 * Sentry DSN: https://<publicKey>@<host>/<projectId>
 *
 * If SENTRY_DSN is not set, all reportError() calls become no-ops, so
 * it's safe to leave the calls in even when Sentry isn't configured
 * (e.g. in local dev).
 *
 * Optional secrets:
 *   SENTRY_ENVIRONMENT   — "production" / "staging" / etc. Defaults to
 *                          process.env.NODE_ENV.
 *   SENTRY_RELEASE       — typically the deploy SHA. Set in CI.
 */

interface ParsedDsn {
  host: string;
  projectId: string;
  publicKey: string;
}

function parseDsn(dsn: string): ParsedDsn | null {
  // DSN format: https://<publicKey>@<host>[:<port>][/<path>]/<projectId>
  try {
    const u = new URL(dsn);
    const publicKey = u.username;
    if (!publicKey) return null;
    const projectId = u.pathname.replace(/^\/+/, "").split("/").pop();
    if (!projectId) return null;
    return { host: u.host, projectId, publicKey };
  } catch {
    return null;
  }
}

function dsn(): ParsedDsn | null {
  const raw = process.env.SENTRY_DSN;
  if (!raw) return null;
  return parseDsn(raw);
}

export function isObservabilityEnabled(): boolean {
  return !!dsn();
}

export interface ReportContext {
  /** Where in the app the error happened, e.g. "api/billing/webhook". */
  source: string;
  /** Optional tags for filtering (route, host_id, plan_slug, …). */
  tags?: Record<string, string | number | boolean | null | undefined>;
  /** Optional structured payload, included verbatim in `extra`. */
  extra?: Record<string, unknown>;
  /** Authenticated user, if any. */
  user?: { id?: string; email?: string };
  /** Override severity. Default 'error'. */
  level?: "fatal" | "error" | "warning" | "info";
}

/**
 * Best-effort: serialise an Error into Sentry's "exception" interface.
 * If the input isn't an Error we still capture it as a structured
 * message so nothing is silently dropped.
 */
function serialiseError(err: unknown): {
  message: string;
  exception?: object;
} {
  if (err instanceof Error) {
    const frames = (err.stack ?? "")
      .split("\n")
      .slice(1) // drop the "Error: msg" first line
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => ({ filename: line }));
    return {
      message: err.message || err.name,
      exception: {
        values: [
          {
            type: err.name || "Error",
            value: err.message,
            stacktrace: { frames: frames.reverse() },
          },
        ],
      },
    };
  }
  if (typeof err === "string") return { message: err };
  try {
    return { message: JSON.stringify(err) };
  } catch {
    return { message: "Unserialisable error" };
  }
}

/**
 * Fire-and-forget error report. Catches its own errors so a Sentry
 * outage can never cascade into a user-facing failure.
 */
export async function reportError(
  err: unknown,
  ctx: ReportContext,
): Promise<void> {
  const parsed = dsn();
  if (!parsed) {
    // No DSN configured — fall back to console so the error is at
    // least visible in `wrangler tail`.
    console.error(`[${ctx.source}]`, err);
    return;
  }

  const ser = serialiseError(err);
  const event = {
    event_id: crypto.randomUUID().replace(/-/g, ""),
    timestamp: Date.now() / 1000,
    platform: "javascript",
    level: ctx.level ?? "error",
    logger: ctx.source,
    environment:
      process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV ?? "production",
    release: process.env.SENTRY_RELEASE ?? undefined,
    server_name: "cloudflare-worker",
    message: ser.message,
    exception: ser.exception,
    tags: { source: ctx.source, ...(ctx.tags ?? {}) },
    extra: ctx.extra,
    user: ctx.user,
  };

  // Sentry's "envelope" intake format is two NDJSON lines:
  //   header line   { event_id, sent_at }
  //   item header   { type: "event", content_type: "application/json" }
  //   item payload  <event JSON>
  const envelope =
    JSON.stringify({ event_id: event.event_id, sent_at: new Date().toISOString() }) +
    "\n" +
    JSON.stringify({ type: "event", content_type: "application/json" }) +
    "\n" +
    JSON.stringify(event);

  const url =
    `https://${parsed.host}/api/${parsed.projectId}/envelope/` +
    `?sentry_key=${parsed.publicKey}&sentry_version=7`;

  try {
    // 5s timeout so a slow Sentry POST can't stall a request handler.
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 5000);
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-sentry-envelope" },
      body: envelope,
      signal: ctrl.signal,
    });
    clearTimeout(t);
  } catch {
    // Swallow. Always.
  }

  // Always also log so wrangler tail captures it.
  console.error(`[${ctx.source}]`, err);
}

/**
 * Wrap an async handler so any thrown error is reported with a fixed
 * source label, then re-thrown so existing error responses still work.
 *
 *     export const POST = withErrorReporting("api/billing/webhook", async (req) => {
 *       …handler…
 *     });
 */
export function withErrorReporting<
  TArgs extends unknown[],
  TResult,
>(source: string, handler: (...args: TArgs) => Promise<TResult>) {
  return async (...args: TArgs): Promise<TResult> => {
    try {
      return await handler(...args);
    } catch (err) {
      // Don't await — reportError handles its own errors.
      void reportError(err, { source });
      throw err;
    }
  };
}
