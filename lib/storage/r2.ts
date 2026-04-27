/**
 * Storage — Cloudflare R2 (S3-compatible).
 *
 * Why presigned URLs (and not Worker-proxied uploads):
 *   Cloudflare Workers cap incoming request bodies at 100MB by default
 *   (paid plans up to 500MB). A typical 1-hour 720p WebM is several
 *   GB. Routing the upload through the Worker is therefore not viable.
 *   Instead we mint a presigned PUT URL on the server and let the
 *   browser PUT the blob directly to R2 — no proxy, no size cap.
 *
 * Why a hand-rolled SigV4 presigner instead of @aws-sdk/client-s3:
 *   The aws-sdk packages add ~3-4 MB to the Worker bundle, which
 *   pushed total worker size past Cloudflare's 10 MB compressed
 *   deploy limit and broke deploys at Phase 3. SigV4 query-string
 *   presigning for a single PUT/GET is only ~80 lines using the
 *   Web Crypto API that's already available in the Workers runtime.
 *   No regional endpoints, no service discovery, no XML parsing —
 *   we never need any of that for a presign.
 *
 * Configuration:
 *   Set these as Cloudflare Worker secrets (NOT in DB) so they live
 *   alongside SUPABASE_SERVICE_ROLE_KEY:
 *     R2_ACCOUNT_ID         — your Cloudflare account id
 *     R2_ACCESS_KEY_ID      — R2 token access key
 *     R2_SECRET_ACCESS_KEY  — R2 token secret
 *     R2_BUCKET             — the bucket name
 *     R2_PUBLIC_URL_BASE    — optional: public hostname for the bucket
 *                             (e.g. https://archives.isunday.me).
 *
 * Reads each binding from process.env first, then getCloudflareContext
 * — same dual-source pattern as createAdminClient (lib/supabase/admin.ts).
 */

interface R2Bindings {
  R2_ACCOUNT_ID?: string;
  R2_ACCESS_KEY_ID?: string;
  R2_SECRET_ACCESS_KEY?: string;
  R2_BUCKET?: string;
  R2_PUBLIC_URL_BASE?: string;
}

function readBinding(name: keyof R2Bindings): string | undefined {
  const fromProc = (process.env as Record<string, string | undefined>)[
    name as string
  ];
  if (fromProc) return fromProc;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require("@opennextjs/cloudflare") as {
      getCloudflareContext?: () => { env: Record<string, unknown> };
    };
    const v = mod.getCloudflareContext?.().env?.[name];
    return typeof v === "string" ? v : undefined;
  } catch {
    return undefined;
  }
}

export interface R2Config {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  /** Optional. If unset, archives are accessed via signed URLs. */
  publicUrlBase: string | null;
  /** Computed: https://{accountId}.r2.cloudflarestorage.com */
  endpoint: string;
}

/**
 * Resolve and validate the R2 configuration. Throws with a clear
 * error message naming any missing var, so /api/host/storage/status
 * can echo it back to the host as a setup hint.
 */
export function getR2Config(): R2Config {
  const accountId = readBinding("R2_ACCOUNT_ID");
  const accessKeyId = readBinding("R2_ACCESS_KEY_ID");
  const secretAccessKey = readBinding("R2_SECRET_ACCESS_KEY");
  const bucket = readBinding("R2_BUCKET");
  const publicUrlBase = readBinding("R2_PUBLIC_URL_BASE") ?? null;

  const missing: string[] = [];
  if (!accountId) missing.push("R2_ACCOUNT_ID");
  if (!accessKeyId) missing.push("R2_ACCESS_KEY_ID");
  if (!secretAccessKey) missing.push("R2_SECRET_ACCESS_KEY");
  if (!bucket) missing.push("R2_BUCKET");
  if (missing.length) {
    throw new Error(
      `Cloud archive is not configured. Missing Cloudflare Worker secrets: ${missing.join(", ")}. ` +
        `Run: npx wrangler secret put <NAME>`,
    );
  }

  return {
    accountId: accountId!,
    accessKeyId: accessKeyId!,
    secretAccessKey: secretAccessKey!,
    bucket: bucket!,
    publicUrlBase: publicUrlBase
      ? publicUrlBase.replace(/\/$/, "")
      : null,
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
  };
}

/**
 * Lightweight feature check that doesn't throw. Used by client-side
 * "is cloud archive available?" probes.
 */
export function isR2Configured(): boolean {
  try {
    getR2Config();
    return true;
  } catch {
    return false;
  }
}

export interface PresignedUploadResult {
  uploadUrl: string;
  /** PUT-time headers the client must send for the signature to verify. */
  headers: Record<string, string>;
  /** How long the URL is valid, in seconds. */
  expiresIn: number;
  /** The public URL the object will be served at (or null if private bucket). */
  publicUrl: string | null;
  /** Echo back so the caller can persist consistently. */
  bucket: string;
  objectKey: string;
}

/**
 * Mint a presigned PUT URL for a browser-direct upload. The URL is
 * valid for 1 hour by default — long enough for slow uplinks on big
 * recordings, short enough that a leaked URL has limited blast radius.
 */
export async function presignUpload(args: {
  objectKey: string;
  contentType: string;
  expiresInSeconds?: number;
}): Promise<PresignedUploadResult> {
  const cfg = getR2Config();
  const expiresIn = args.expiresInSeconds ?? 3600;

  const uploadUrl = await presignS3({
    method: "PUT",
    cfg,
    objectKey: args.objectKey,
    expiresIn,
    // Signing Content-Type means the browser MUST send the same value
    // on the PUT or R2 will return 403. Mirrors the old SDK behaviour.
    signedHeaders: { "content-type": args.contentType },
  });

  return {
    uploadUrl,
    headers: { "Content-Type": args.contentType },
    expiresIn,
    publicUrl: cfg.publicUrlBase
      ? `${cfg.publicUrlBase}/${encodeURI(args.objectKey)}`
      : null,
    bucket: cfg.bucket,
    objectKey: args.objectKey,
  };
}

/**
 * Mint a short-lived signed GET URL for a private bucket. Used when
 * R2_PUBLIC_URL_BASE is not configured.
 */
export async function presignDownload(args: {
  objectKey: string;
  expiresInSeconds?: number;
}): Promise<string> {
  const cfg = getR2Config();
  return presignS3({
    method: "GET",
    cfg,
    objectKey: args.objectKey,
    expiresIn: args.expiresInSeconds ?? 3600,
  });
}

/**
 * Hard-delete an object from R2.
 *
 * Used by:
 *   - the host-initiated DELETE archive endpoint
 *   - the nightly retention cron that sweeps expired archives
 *
 * S3 (and R2) returns 204 No Content for both "deleted" and "didn't
 * exist" — the API is idempotent. We return ok:true in both cases.
 *
 * Implementation note: `presignS3` mints a query-string-signed URL
 * which works for DELETE the same as GET/PUT. We then issue the
 * request server-side. Doing it via presigned URL keeps all SigV4
 * logic in one place; we never need a separate signed-header path.
 */
export async function deleteObject(args: {
  objectKey: string;
}): Promise<{ ok: boolean; status: number; error?: string }> {
  const cfg = getR2Config();
  const url = await presignS3({
    method: "DELETE",
    cfg,
    objectKey: args.objectKey,
    expiresIn: 60, // short — we're calling immediately
  });
  try {
    const res = await fetch(url, { method: "DELETE" });
    if (res.status === 204 || res.status === 200 || res.status === 404) {
      return { ok: true, status: res.status };
    }
    const body = await res.text().catch(() => "");
    return {
      ok: false,
      status: res.status,
      error: `R2 delete failed: HTTP ${res.status} ${body.slice(0, 200)}`,
    };
  } catch (e) {
    return {
      ok: false,
      status: 0,
      error: e instanceof Error ? e.message : "Network error during R2 delete",
    };
  }
}

// ────────────────────────────────────────────────────────────────────
// SigV4 query-string presigner (zero-dep, Web Crypto only)
//
// Reference: https://docs.aws.amazon.com/AmazonS3/latest/API/sigv4-query-string-auth.html
// R2 implements SigV4 verbatim against the cloudflarestorage.com host.
//
// Payload hash is the literal string "UNSIGNED-PAYLOAD" — required for
// query-string presigned PUTs since the body isn't known at sign time.
// ────────────────────────────────────────────────────────────────────

interface PresignArgs {
  method: "PUT" | "GET" | "DELETE";
  cfg: R2Config;
  objectKey: string;
  expiresIn: number;
  /** Lowercase header name → value. Will be added to SignedHeaders. */
  signedHeaders?: Record<string, string>;
}

async function presignS3(args: PresignArgs): Promise<string> {
  const { method, cfg, objectKey, expiresIn, signedHeaders = {} } = args;

  // Path-style addressing: /{bucket}/{key}. Each segment of the key
  // path must be URL-encoded *except* for forward slashes between
  // segments. Using encodeURIComponent and then restoring "/" gives
  // S3-compatible canonicalisation.
  const encodedKey = objectKey
    .split("/")
    .map(encodeURIComponent)
    .join("/");
  const canonicalUri = `/${cfg.bucket}/${encodedKey}`;

  const host = new URL(cfg.endpoint).host;

  // ── ISO 8601 basic format, UTC ────────────────────────────────────
  // Example: 20260426T231500Z
  const now = new Date();
  const amzDate = toAmzDate(now);
  const dateStamp = amzDate.slice(0, 8);
  const credentialScope = `${dateStamp}/auto/s3/aws4_request`;

  // ── Canonical headers (always include host) ───────────────────────
  const headers: Record<string, string> = {
    host,
    ...Object.fromEntries(
      Object.entries(signedHeaders).map(([k, v]) => [k.toLowerCase(), v]),
    ),
  };
  const sortedHeaderNames = Object.keys(headers).sort();
  const canonicalHeaders =
    sortedHeaderNames
      .map((n) => `${n}:${headers[n].trim().replace(/\s+/g, " ")}`)
      .join("\n") + "\n";
  const signedHeaderList = sortedHeaderNames.join(";");

  // ── Canonical query string ────────────────────────────────────────
  // Order matters; S3 wants strict alpha-sorted keys with rfc3986 enc.
  const queryParams: Record<string, string> = {
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": `${cfg.accessKeyId}/${credentialScope}`,
    "X-Amz-Date": amzDate,
    "X-Amz-Expires": String(expiresIn),
    "X-Amz-SignedHeaders": signedHeaderList,
  };
  const canonicalQuery = Object.keys(queryParams)
    .sort()
    .map(
      (k) => `${rfc3986(k)}=${rfc3986(queryParams[k])}`,
    )
    .join("&");

  // ── Canonical request ─────────────────────────────────────────────
  const canonicalRequest = [
    method,
    canonicalUri,
    canonicalQuery,
    canonicalHeaders,
    signedHeaderList,
    "UNSIGNED-PAYLOAD",
  ].join("\n");

  // ── String to sign ────────────────────────────────────────────────
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    await sha256Hex(canonicalRequest),
  ].join("\n");

  // ── Derive signing key (per AWS spec) ─────────────────────────────
  const kDate = await hmac(
    new TextEncoder().encode("AWS4" + cfg.secretAccessKey),
    dateStamp,
  );
  const kRegion = await hmac(kDate, "auto");
  const kService = await hmac(kRegion, "s3");
  const kSigning = await hmac(kService, "aws4_request");
  const signature = bufToHex(await hmac(kSigning, stringToSign));

  return `${cfg.endpoint}${canonicalUri}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}

function toAmzDate(d: Date): string {
  return d.toISOString().replace(/[:-]|\.\d{3}/g, "");
}

/**
 * RFC3986-compliant URI encoding. Different from encodeURIComponent:
 * we additionally encode "!", "*", "'", "(", ")" — those are reserved
 * by RFC3986 but left alone by encodeURIComponent. S3 requires the
 * stricter form.
 */
function rfc3986(s: string): string {
  return encodeURIComponent(s).replace(
    /[!*'()]/g,
    (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase(),
  );
}

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(s),
  );
  return bufToHex(new Uint8Array(buf));
}

async function hmac(
  key: ArrayBuffer | Uint8Array,
  data: string,
): Promise<Uint8Array> {
  // crypto.subtle.importKey wants a BufferSource backed by ArrayBuffer
  // (not SharedArrayBuffer). Copying into a fresh Uint8Array guarantees
  // that, and silences the structural-typing complaint from TS strict mode.
  const src = key instanceof Uint8Array ? key : new Uint8Array(key);
  const keyBuf = new Uint8Array(src);
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyBuf.buffer as ArrayBuffer,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    cryptoKey,
    new TextEncoder().encode(data),
  );
  return new Uint8Array(sig);
}

function bufToHex(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    const h = bytes[i].toString(16);
    out += h.length === 1 ? "0" + h : h;
  }
  return out;
}
