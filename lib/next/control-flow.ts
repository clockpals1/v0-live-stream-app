/**
 * Helper for distinguishing Next.js internal control-flow signals
 * from real errors inside try/catch blocks.
 *
 * Why this exists
 * ---------------
 * Next.js implements `redirect()`, `notFound()`, dynamic-server-usage
 * detection, and a few other features by THROWING typed signal
 * objects up the render stack. If a server component wraps its body
 * in try/catch (which we do for resilience and structured logging),
 * those signals get swallowed — and the build either generates
 * confusing static-prerender errors or the runtime returns 200
 * instead of 307.
 *
 * The contract
 * ------------
 * Re-throw if `err` has any of:
 *   - a string `digest` starting with NEXT_
 *   - the digest exactly equal to "DYNAMIC_SERVER_USAGE"
 *   - the constructor name "DynamicServerError"
 * That covers redirect, not-found, dynamic usage, and the new
 * "bailoutToCSR" signal Next 16 introduced. Anything else is a real
 * error the caller should log + handle.
 */
export function isNextControlFlowSignal(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { digest?: unknown; name?: unknown };
  if (typeof e.digest === "string") {
    if (e.digest.startsWith("NEXT_")) return true;
    if (e.digest === "DYNAMIC_SERVER_USAGE") return true;
    if (e.digest.startsWith("BAILOUT_TO_CLIENT_SIDE_RENDERING")) return true;
  }
  if (typeof e.name === "string") {
    if (e.name === "DynamicServerError") return true;
    if (e.name === "BailoutToCSRError") return true;
  }
  return false;
}
