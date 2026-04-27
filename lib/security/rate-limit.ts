/**
 * Application-layer rate limiter.
 *
 * SCOPE
 * -----
 * This is a SECOND-LAYER defense. The first and primary layer is a
 * Cloudflare WAF Rate Limiting Rule configured in the dashboard,
 * which runs at the edge before requests reach this Worker. See
 * docs/SETUP.md → "Rate limiting" for the recommended dashboard rules.
 *
 * This in-code limiter exists for two reasons the WAF rules don't
 * cover:
 *   1. **Per-user limits.** WAF can only key on IP / cf-connecting-ip;
 *      it doesn't see Supabase auth tokens. Quota limits like "5
 *      Insider Circle broadcasts per hour per host" need to key on
 *      the host id, which only this layer can do.
 *   2. **Structured 429 responses.** Browsers handle the WAF's
 *      generic block page poorly. Our 429s come back as JSON with
 *      `Retry-After` + `X-RateLimit-*` headers so client code can
 *      back off cleanly.
 *
 * IMPLEMENTATION
 * --------------
 * In-memory token buckets, scoped to the Worker isolate. Cloudflare
 * spawns multiple isolates per data center, so a determined attacker
 * could hit different ones to multiply the effective rate. That's
 * fine — this layer is for accidental misuse and credential stuffing,
 * not DDoS. The WAF rule handles the volumetric attack.
 *
 * The bucket map is a module-level Map; it's GC'd along with the
 * isolate. We periodically prune stale buckets so memory doesn't
 * grow on a long-lived isolate.
 */

interface Bucket {
  /** Number of tokens currently available. */
  tokens: number;
  /** Last time we refilled, ms since epoch. */
  refilledAt: number;
}

export interface RateLimitPolicy {
  /** Stable name; used to namespace bucket keys + populate headers. */
  name: string;
  /** Maximum tokens (requests) in the window. */
  limit: number;
  /** Window in seconds — tokens are refilled linearly across this. */
  windowSeconds: number;
}

export interface RateLimitDecision {
  allowed: boolean;
  /** How many tokens remain after this request was counted. */
  remaining: number;
  /** Unix timestamp (seconds) at which the bucket will be full again. */
  resetAt: number;
  /** Echoes the policy used. */
  policy: RateLimitPolicy;
}

const buckets = new Map<string, Bucket>();

// Best-effort GC. Touched on every check; if it sees an old bucket
// it lazily prunes it. Bounded to 50 keys/check so we never block on
// a giant cleanup.
function gc(now: number) {
  let scanned = 0;
  for (const [key, b] of buckets) {
    if (scanned++ >= 50) break;
    // If the bucket would have refilled to full by now, no caller
    // can possibly need its state — drop it.
    if (now - b.refilledAt > 24 * 60 * 60 * 1000) {
      buckets.delete(key);
    }
  }
}

/**
 * Take one token from `key`'s bucket under the given policy. The
 * bucket is created on first call. Returns whether the request is
 * allowed PLUS the headers needed for a 429 response.
 *
 * The key should namespace identity + scope, e.g.
 *   `auth:ip:1.2.3.4`        — by client IP
 *   `broadcast:host:abc-123` — by host id
 */
export function checkRateLimit(
  key: string,
  policy: RateLimitPolicy,
): RateLimitDecision {
  const now = Date.now();
  const refillPerMs = policy.limit / (policy.windowSeconds * 1000);

  const fullKey = `${policy.name}:${key}`;
  let bucket = buckets.get(fullKey);
  if (!bucket) {
    bucket = { tokens: policy.limit, refilledAt: now };
    buckets.set(fullKey, bucket);
  } else {
    // Refill based on elapsed time, capped at the policy's max.
    const elapsed = now - bucket.refilledAt;
    bucket.tokens = Math.min(
      policy.limit,
      bucket.tokens + elapsed * refillPerMs,
    );
    bucket.refilledAt = now;
  }

  // Lazy GC. Free.
  if (buckets.size > 1000) gc(now);

  let allowed: boolean;
  if (bucket.tokens >= 1) {
    bucket.tokens -= 1;
    allowed = true;
  } else {
    allowed = false;
  }

  // Time until at least 1 token is back, in ms.
  const msToOne = bucket.tokens >= 1 ? 0 : (1 - bucket.tokens) / refillPerMs;
  const resetAt = Math.ceil((now + msToOne) / 1000);

  return {
    allowed,
    remaining: Math.max(0, Math.floor(bucket.tokens)),
    resetAt,
    policy,
  };
}

/**
 * Standard rate-limit response headers (RFC-aligned where possible —
 * `RateLimit-*` per draft-ietf-httpapi-ratelimit-headers, plus the
 * widely-implemented `X-RateLimit-*` aliases for older clients).
 */
export function rateLimitHeaders(d: RateLimitDecision): Record<string, string> {
  const retryAfterSec = Math.max(0, d.resetAt - Math.ceil(Date.now() / 1000));
  return {
    "X-RateLimit-Limit": String(d.policy.limit),
    "X-RateLimit-Remaining": String(d.remaining),
    "X-RateLimit-Reset": String(d.resetAt),
    "X-RateLimit-Policy": `${d.policy.limit};w=${d.policy.windowSeconds}`,
    ...(d.allowed ? {} : { "Retry-After": String(retryAfterSec) }),
  };
}

/**
 * Best-effort client IP from Cloudflare's headers, falling back to
 * X-Forwarded-For and finally a synthetic "unknown" key (so a header
 * misconfiguration doesn't open a hole — every "unknown" caller will
 * share a single bucket and rate-limit each other).
 */
export function clientIpFromHeaders(headers: Headers): string {
  return (
    headers.get("cf-connecting-ip") ||
    headers.get("x-real-ip") ||
    headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "unknown"
  );
}

// ────────────────────────────────────────────────────────────────────
// Standard policies
//
// Tweak these by editing the constants here — all callers reference
// the same values, so changing the limit in ONE place updates every
// route that uses that policy.
// ────────────────────────────────────────────────────────────────────

/** Aggressive: signin, signup, password reset. Brute-force shield. */
export const POLICY_AUTH: RateLimitPolicy = {
  name: "auth",
  limit: 10,
  windowSeconds: 60,
};

/** Insider Circle broadcast — once a host hits 5/hour they're either
 *  testing or compromised. */
export const POLICY_BROADCAST: RateLimitPolicy = {
  name: "broadcast",
  limit: 5,
  windowSeconds: 60 * 60,
};

/** Per-user write limits on expensive flows (archive start, YouTube
 *  upload, Stripe checkout). Generous for normal use; catches loops. */
export const POLICY_HEAVY_WRITE: RateLimitPolicy = {
  name: "heavy",
  limit: 30,
  windowSeconds: 60,
};

/** Default for everything else — applied at the API edge as a generic
 *  guard against accidental client-side infinite loops. */
export const POLICY_DEFAULT: RateLimitPolicy = {
  name: "default",
  limit: 120,
  windowSeconds: 60,
};
