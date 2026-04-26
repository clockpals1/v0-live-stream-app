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
 * Configuration:
 *   Set these as Cloudflare Worker secrets (NOT in DB) so they live
 *   alongside SUPABASE_SERVICE_ROLE_KEY:
 *     R2_ACCOUNT_ID         — your Cloudflare account id
 *     R2_ACCESS_KEY_ID      — R2 token access key
 *     R2_SECRET_ACCESS_KEY  — R2 token secret
 *     R2_BUCKET             — the bucket name
 *     R2_PUBLIC_URL_BASE    — optional: public hostname for the bucket
 *                             (e.g. https://archives.isunday.me).
 *                             If unset, archives stay private and the
 *                             app will need to mint signed read URLs
 *                             on demand. For Phase 3 we use public URLs
 *                             so playback is a plain <video src=…>.
 *
 * Reads each binding from process.env first, then getCloudflareContext
 * — same dual-source pattern as createAdminClient (lib/supabase/admin.ts).
 */

import { S3Client } from "@aws-sdk/client-s3";
import { PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

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

let _cachedClient:
  | { endpoint: string; accessKeyId: string; client: S3Client }
  | null = null;

function getClient(cfg: R2Config): S3Client {
  if (
    _cachedClient &&
    _cachedClient.endpoint === cfg.endpoint &&
    _cachedClient.accessKeyId === cfg.accessKeyId
  ) {
    return _cachedClient.client;
  }
  const client = new S3Client({
    region: "auto",
    endpoint: cfg.endpoint,
    credentials: {
      accessKeyId: cfg.accessKeyId,
      secretAccessKey: cfg.secretAccessKey,
    },
    // Force path-style addressing (R2 doesn't support virtual hosts
    // for the regional endpoint).
    forcePathStyle: true,
  });
  _cachedClient = {
    endpoint: cfg.endpoint,
    accessKeyId: cfg.accessKeyId,
    client,
  };
  return client;
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
 *
 * The caller is responsible for choosing a unique objectKey. The
 * convention used by /api/streams/[id]/archive/start is:
 *   hosts/{host_id}/streams/{stream_id}/{archive_id}.{ext}
 */
export async function presignUpload(args: {
  objectKey: string;
  contentType: string;
  expiresInSeconds?: number;
}): Promise<PresignedUploadResult> {
  const cfg = getR2Config();
  const client = getClient(cfg);
  const expiresIn = args.expiresInSeconds ?? 3600;

  const command = new PutObjectCommand({
    Bucket: cfg.bucket,
    Key: args.objectKey,
    ContentType: args.contentType,
  });

  const uploadUrl = await getSignedUrl(client, command, {
    expiresIn,
    // signableHeaders: tell presigner that ONLY these headers are part
    // of the signature. The browser will add the matching values on
    // PUT and the URL will validate. Other request headers (e.g.
    // user-agent) won't break verification.
    signableHeaders: new Set(["host", "content-type"]),
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
 * R2_PUBLIC_URL_BASE is not configured. Phase 3 doesn't call this in
 * any UI yet — it's here for future playback/download flows.
 */
export async function presignDownload(args: {
  objectKey: string;
  expiresInSeconds?: number;
}): Promise<string> {
  const cfg = getR2Config();
  const client = getClient(cfg);
  const command = new GetObjectCommand({
    Bucket: cfg.bucket,
    Key: args.objectKey,
  });
  return getSignedUrl(client, command, {
    expiresIn: args.expiresInSeconds ?? 3600,
  });
}
