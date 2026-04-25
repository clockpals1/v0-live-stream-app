/**
 * Resend wrapper for Insider Circle broadcasts.
 *
 * Why the lazy import: the Resend package pulls in node:stream; importing
 * it at module top would crash the Cloudflare worker bundle on routes
 * that never send mail. We construct the client only inside sendBatch().
 *
 * Edge-runtime safe: the underlying SDK calls fetch() against the public
 * Resend REST API — no Node-only APIs are used.
 */

const RESEND_BATCH_LIMIT = 100; // Resend's documented batch ceiling

export interface BatchPayloadItem {
  to: string;
  subject: string;
  html: string;
}

export interface SendResult {
  sent: number;
  failed: number;
  errors: Array<{ email: string; reason: string }>;
}

export class EmailNotConfiguredError extends Error {
  constructor() {
    super(
      "Email sending is not configured. Set RESEND_API_KEY and RESEND_FROM " +
        "in your environment, then redeploy.",
    );
    this.name = "EmailNotConfiguredError";
  }
}

export function isEmailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY && process.env.RESEND_FROM);
}

/**
 * Send a fan-out batch via Resend's /emails/batch endpoint. Handles
 * Resend's per-request 100-message ceiling by chunking. Errors per
 * message are surfaced individually so the caller can record partial
 * success rather than aborting the whole broadcast.
 */
export async function sendBatch(items: BatchPayloadItem[]): Promise<SendResult> {
  if (!isEmailConfigured()) throw new EmailNotConfiguredError();

  const apiKey = process.env.RESEND_API_KEY!;
  const from = process.env.RESEND_FROM!;

  let sent = 0;
  let failed = 0;
  const errors: Array<{ email: string; reason: string }> = [];

  // Chunk by Resend batch limit
  for (let i = 0; i < items.length; i += RESEND_BATCH_LIMIT) {
    const chunk = items.slice(i, i + RESEND_BATCH_LIMIT);
    const body = chunk.map((it) => ({
      from,
      to: [it.to],
      subject: it.subject,
      html: it.html,
    }));

    try {
      const res = await fetch("https://api.resend.com/emails/batch", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        // Whole chunk failed — count each address as failed with the
        // top-level error so the host gets useful diagnostic info.
        for (const it of chunk) {
          failed++;
          errors.push({ email: it.to, reason: `HTTP ${res.status}: ${text.slice(0, 200)}` });
        }
        continue;
      }

      const json = (await res.json().catch(() => null)) as
        | { data?: Array<{ id?: string; error?: { message?: string } }> }
        | null;

      // Resend batch returns one entry per submitted message, in order.
      const data = json?.data ?? [];
      for (let j = 0; j < chunk.length; j++) {
        const entry = data[j];
        if (entry?.id) {
          sent++;
        } else {
          failed++;
          errors.push({
            email: chunk[j].to,
            reason: entry?.error?.message ?? "Unknown Resend response",
          });
        }
      }
    } catch (err: unknown) {
      // Whole-chunk network failure
      const reason = err instanceof Error ? err.message : "Network error";
      for (const it of chunk) {
        failed++;
        errors.push({ email: it.to, reason });
      }
    }
  }

  return { sent, failed, errors };
}

/**
 * Build the public unsubscribe URL for a subscriber token. Reads the
 * deployment's app origin from APP_URL (preferred) or NEXT_PUBLIC_APP_URL
 * (fallback). Both should be set at build/deploy time.
 */
export function unsubscribeUrl(token: string): string {
  const base =
    process.env.APP_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    "https://live.isunday.me";
  return `${base.replace(/\/+$/, "")}/api/insider/unsubscribe?token=${encodeURIComponent(token)}`;
}
