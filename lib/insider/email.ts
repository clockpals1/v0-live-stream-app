/**
 * Insider Circle email transport.
 *
 * Supports two backends, picked by environment variables. SMTP is checked
 * first because most production deployments already have an SMTP relay
 * paid for (the same one Supabase Auth uses). Resend is the fallback.
 *
 *   ┌─────────────────────────────┬─────────────────────────────────────┐
 *   │ Required env vars           │ Backend used                        │
 *   ├─────────────────────────────┼─────────────────────────────────────┤
 *   │ SMTP_HOST + SMTP_PORT +     │ Direct SMTP via worker-mailer       │
 *   │ SMTP_USER + SMTP_PASS +     │ (uses Cloudflare's connect() API,   │
 *   │ SMTP_FROM                   │ runs on Workers and Node alike)     │
 *   ├─────────────────────────────┼─────────────────────────────────────┤
 *   │ RESEND_API_KEY +            │ Resend HTTPS REST API               │
 *   │ RESEND_FROM                 │                                     │
 *   └─────────────────────────────┴─────────────────────────────────────┘
 *
 * Both paths surface per-recipient errors so the broadcast endpoint can
 * record partial-success state in `host_broadcasts.failed_count`.
 *
 * NOTE on Supabase SMTP: the SMTP credentials you configure inside
 * Supabase Auth are NOT reachable from application code — Supabase only
 * uses them for transactional auth emails (signup confirmations, magic
 * links, password resets). To reuse the same SMTP for app-sent emails
 * you must copy the same HOST/PORT/USER/PASS/FROM into the Cloudflare
 * Pages env vars under SMTP_*.
 */

const RESEND_BATCH_LIMIT = 100;

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

export type EmailBackend = "smtp" | "resend" | null;

export class EmailNotConfiguredError extends Error {
  constructor() {
    super(
      "Email sending is not configured. Set either SMTP_* env vars " +
        "(SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM) or " +
        "Resend env vars (RESEND_API_KEY, RESEND_FROM), then redeploy.",
    );
    this.name = "EmailNotConfiguredError";
  }
}

/**
 * Returns which backend will be used, or null if neither is fully
 * configured. Used by the broadcast endpoint to short-circuit with a
 * clear setup-required message before doing any DB work.
 */
export function detectBackend(): EmailBackend {
  if (
    process.env.SMTP_HOST &&
    process.env.SMTP_PORT &&
    process.env.SMTP_USER &&
    process.env.SMTP_PASS &&
    process.env.SMTP_FROM
  ) {
    return "smtp";
  }
  if (process.env.RESEND_API_KEY && process.env.RESEND_FROM) {
    return "resend";
  }
  return null;
}

export function isEmailConfigured(): boolean {
  return detectBackend() !== null;
}

/**
 * Send a fan-out batch. Routes to whichever backend is configured.
 */
export async function sendBatch(items: BatchPayloadItem[]): Promise<SendResult> {
  const backend = detectBackend();
  if (!backend) throw new EmailNotConfiguredError();

  if (backend === "smtp") return sendBatchSmtp(items);
  return sendBatchResend(items);
}

// ────────────────────────────────────────────────────────────────────────
// SMTP backend (preferred — reuses the user's existing relay)
// ────────────────────────────────────────────────────────────────────────

async function sendBatchSmtp(items: BatchPayloadItem[]): Promise<SendResult> {
  // Lazy import: keeps the package out of the bundle for Resend-only users
  // and avoids any module-level side effects on cold starts.
  const { WorkerMailer } = await import("worker-mailer");

  const host = process.env.SMTP_HOST!;
  const port = Number(process.env.SMTP_PORT!);
  const username = process.env.SMTP_USER!;
  const password = process.env.SMTP_PASS!;
  const from = process.env.SMTP_FROM!;
  // Most managed SMTP relays (SendGrid 587, Brevo 587, Mailgun 587, AWS SES 587)
  // accept STARTTLS on submission ports. Implicit TLS is on 465.
  // We auto-pick from port unless SMTP_SECURE is set explicitly.
  const explicit = process.env.SMTP_SECURE?.toLowerCase();
  const secure: boolean =
    explicit === "true"
      ? true
      : explicit === "false"
        ? false
        : port === 465; // implicit TLS for 465, STARTTLS for everything else
  const credentials =
    (process.env.SMTP_AUTH?.toLowerCase() as "plain" | "login" | undefined) ||
    "plain";

  let sent = 0;
  let failed = 0;
  const errors: Array<{ email: string; reason: string }> = [];

  // Open a single connection and send sequentially. SMTP submission
  // services typically rate-limit per-connection but allow many messages
  // per session, so this is the most efficient pattern.
  let mailer: InstanceType<typeof WorkerMailer> | null = null;
  try {
    mailer = await WorkerMailer.connect({
      host,
      port,
      secure,
      credentials: { username, password, authType: credentials },
    });

    for (const it of items) {
      try {
        await mailer.send({
          from,
          to: it.to,
          subject: it.subject,
          html: it.html,
        });
        sent++;
      } catch (err: unknown) {
        failed++;
        errors.push({
          email: it.to,
          reason: err instanceof Error ? err.message : "SMTP send failed",
        });
      }
    }
  } catch (err: unknown) {
    // Couldn't even open the connection — every recipient fails the same way.
    const reason =
      err instanceof Error
        ? `SMTP connect failed: ${err.message}`
        : "SMTP connect failed";
    for (const it of items.slice(sent)) {
      failed++;
      errors.push({ email: it.to, reason });
    }
  } finally {
    try {
      await mailer?.close();
    } catch {
      // ignore close errors
    }
  }

  return { sent, failed, errors };
}

// ────────────────────────────────────────────────────────────────────────
// Resend backend (fallback)
// ────────────────────────────────────────────────────────────────────────

async function sendBatchResend(items: BatchPayloadItem[]): Promise<SendResult> {
  const apiKey = process.env.RESEND_API_KEY!;
  const from = process.env.RESEND_FROM!;

  let sent = 0;
  let failed = 0;
  const errors: Array<{ email: string; reason: string }> = [];

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
        for (const it of chunk) {
          failed++;
          errors.push({
            email: it.to,
            reason: `HTTP ${res.status}: ${text.slice(0, 200)}`,
          });
        }
        continue;
      }

      const json = (await res.json().catch(() => null)) as
        | { data?: Array<{ id?: string; error?: { message?: string } }> }
        | null;

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
      const reason = err instanceof Error ? err.message : "Network error";
      for (const it of chunk) {
        failed++;
        errors.push({ email: it.to, reason });
      }
    }
  }

  return { sent, failed, errors };
}

// ────────────────────────────────────────────────────────────────────────
// Shared helpers
// ────────────────────────────────────────────────────────────────────────

export function unsubscribeUrl(token: string): string {
  const base =
    process.env.APP_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    "https://live.isunday.me";
  return `${base.replace(/\/+$/, "")}/api/insider/unsubscribe?token=${encodeURIComponent(
    token,
  )}`;
}
