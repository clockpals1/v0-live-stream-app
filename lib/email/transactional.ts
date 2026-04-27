/**
 * Transactional email — single-recipient sends with a shared template.
 *
 * Reuses the dual-backend (SMTP + Resend) transport in
 * `lib/insider/email.ts` so we don't duplicate the connection logic.
 * The Insider Circle code calls `sendBatch()` directly; this module is
 * the front door for everything else (welcome, payment failed, archive
 * ready, grant issued, etc.).
 *
 * Design rules:
 *   1. **Fire-and-forget at the call site.** All senders accept their
 *      payload and return Promise<{ ok: boolean }>. Callers should
 *      `void sendXxx(...)` so a transient SMTP failure never breaks
 *      the user-facing flow that triggered the email.
 *   2. **Never throw.** Any error is logged + reported to Sentry. The
 *      caller's request handler is not in the "email send" business.
 *   3. **One template shell, many bodies.** `renderShell()` handles
 *      the boilerplate (preheader, header, footer, mobile-first
 *      styles). Each transactional email is a small body fragment.
 */

import { sendBatch, isEmailConfigured } from "@/lib/insider/email";
import { reportError } from "@/lib/observability/sentry";

interface SendArgs {
  to: string;
  subject: string;
  /** Pre-rendered HTML body, ready to drop into the template shell. */
  bodyHtml: string;
  /** First line shown in the inbox preview. Keep < 90 chars. */
  preheader?: string;
}

export interface SendResult {
  ok: boolean;
  /** True if email is not configured at all (no error, just skipped). */
  skipped?: boolean;
  reason?: string;
}

const APP_NAME = "Live Stream";

function appUrl(): string {
  return (
    process.env.APP_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    "https://live.isunday.me"
  ).replace(/\/+$/, "");
}

/**
 * Wrap a body in the standard email shell. Mobile-first, system fonts,
 * no external CSS — every Gmail/Outlook client parses this fine.
 */
function renderShell(args: { subject: string; bodyHtml: string; preheader?: string }): string {
  const base = appUrl();
  const preheader = args.preheader ?? "";
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(args.subject)}</title>
</head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#18181b;">
<!-- Preheader (hidden, used for inbox preview) -->
<div style="display:none;max-height:0;overflow:hidden;font-size:1px;line-height:1px;color:#f4f4f5;opacity:0;">${escapeHtml(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f4f4f5;padding:24px 12px;">
  <tr>
    <td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e4e4e7;">
        <!-- Header -->
        <tr>
          <td style="padding:20px 24px;border-bottom:1px solid #e4e4e7;">
            <a href="${base}" style="color:#18181b;text-decoration:none;font-weight:600;font-size:16px;">${APP_NAME}</a>
          </td>
        </tr>
        <!-- Body -->
        <tr>
          <td style="padding:32px 24px;font-size:15px;line-height:1.6;color:#18181b;">
            ${args.bodyHtml}
          </td>
        </tr>
        <!-- Footer -->
        <tr>
          <td style="padding:20px 24px;border-top:1px solid #e4e4e7;font-size:12px;color:#71717a;">
            You received this because you have an account at <a href="${base}" style="color:#71717a;">${base.replace(/^https?:\/\//, "")}</a>.
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Core sender. All template helpers below funnel through this.
 */
async function sendOne(args: SendArgs, source: string): Promise<SendResult> {
  if (!isEmailConfigured()) {
    // Soft-skip in dev / unconfigured deploys. Useful so unit tests
    // don't have to mock SMTP. Logged once so it's visible.
    console.warn(`[email/${source}] skipped — backend not configured`);
    return { ok: false, skipped: true, reason: "Email backend not configured." };
  }

  const html = renderShell({
    subject: args.subject,
    bodyHtml: args.bodyHtml,
    preheader: args.preheader,
  });

  try {
    const result = await sendBatch([{ to: args.to, subject: args.subject, html }]);
    if (result.failed > 0) {
      const reason = result.errors[0]?.reason ?? "send failed";
      void reportError(new Error(reason), {
        source: `email/${source}`,
        tags: { to: args.to, subject: args.subject },
      });
      return { ok: false, reason };
    }
    return { ok: true };
  } catch (e) {
    void reportError(e, {
      source: `email/${source}`,
      tags: { to: args.to, subject: args.subject },
    });
    return {
      ok: false,
      reason: e instanceof Error ? e.message : "send failed",
    };
  }
}

// ────────────────────────────────────────────────────────────────────
// Templates
// ────────────────────────────────────────────────────────────────────

/**
 * Welcome — sent the first time a host completes signup.
 */
export function sendWelcome(args: {
  to: string;
  displayName: string;
}): Promise<SendResult> {
  const base = appUrl();
  const name = escapeHtml(args.displayName || "there");
  const body = `
    <h1 style="font-size:20px;font-weight:600;margin:0 0 12px;">Welcome, ${name}.</h1>
    <p style="margin:0 0 16px;color:#3f3f46;">
      Your ${APP_NAME} account is ready. Here's a 60-second tour to get you to your
      first live broadcast.
    </p>
    <ol style="padding-left:18px;margin:0 0 20px;color:#3f3f46;">
      <li style="margin-bottom:6px;">Open your dashboard and pick a stream title.</li>
      <li style="margin-bottom:6px;">Connect YouTube (optional) so post-stream uploads happen with one click.</li>
      <li style="margin-bottom:6px;">Hit <strong>Go live</strong> and share the room code with your audience.</li>
    </ol>
    <p style="margin:24px 0 0;">
      <a href="${base}/host/dashboard"
         style="display:inline-block;background:#18181b;color:#fafafa;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:600;">
        Go to dashboard
      </a>
    </p>
    <p style="margin:24px 0 0;font-size:13px;color:#71717a;">
      Questions? Just reply to this email and a real person will read it.
    </p>
  `;
  return sendOne(
    {
      to: args.to,
      subject: `Welcome to ${APP_NAME}`,
      bodyHtml: body,
      preheader: `Hi ${args.displayName}, here's how to get to your first stream in 60 seconds.`,
    },
    "welcome",
  );
}

/**
 * Payment failed — sent from the Stripe webhook on
 * `invoice.payment_failed` so the host knows BEFORE they get locked
 * out. Includes a direct link to the customer portal.
 */
export function sendPaymentFailed(args: {
  to: string;
  displayName: string;
  /** e.g. "$19.00 USD" */
  amountLabel: string;
  /** e.g. "Pro" */
  planName: string;
  /** ISO of next retry, if Stripe scheduled one. */
  nextRetryAt?: string | null;
}): Promise<SendResult> {
  const base = appUrl();
  const name = escapeHtml(args.displayName || "there");
  const amount = escapeHtml(args.amountLabel);
  const plan = escapeHtml(args.planName);
  const retryLine = args.nextRetryAt
    ? `<p style="margin:0 0 16px;color:#3f3f46;">Stripe will retry on <strong>${escapeHtml(
        new Date(args.nextRetryAt).toLocaleDateString(undefined, {
          weekday: "short",
          month: "short",
          day: "numeric",
        }),
      )}</strong>.</p>`
    : "";
  const body = `
    <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:14px 16px;margin:0 0 20px;color:#991b1b;font-size:13px;font-weight:600;">
      ⚠️ Payment failed
    </div>
    <h1 style="font-size:20px;font-weight:600;margin:0 0 12px;">Hi ${name},</h1>
    <p style="margin:0 0 16px;color:#3f3f46;">
      We tried to charge <strong>${amount}</strong> for your <strong>${plan}</strong> plan and
      the payment was declined.
    </p>
    ${retryLine}
    <p style="margin:0 0 20px;color:#3f3f46;">
      To keep your account active, update your card in the billing portal.
      Streams and uploads will keep working during the retry window — but if
      the retry fails too, your plan will downgrade automatically.
    </p>
    <p style="margin:24px 0 0;">
      <a href="${base}/host/settings"
         style="display:inline-block;background:#dc2626;color:#fafafa;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:600;">
        Update payment method
      </a>
    </p>
  `;
  return sendOne(
    {
      to: args.to,
      subject: `Payment failed — please update your card`,
      bodyHtml: body,
      preheader: `We couldn't charge ${args.amountLabel} for ${args.planName}. Update your card to keep access.`,
    },
    "payment-failed",
  );
}

/**
 * Archive ready — sent when a stream recording finishes uploading
 * to R2 and the row flips to status='ready'. Saves the host from
 * having to refresh the dashboard waiting on the upload.
 */
export function sendArchiveReady(args: {
  to: string;
  displayName: string;
  streamTitle: string;
  streamId: string;
  /** Bytes; rendered as MB/GB. */
  byteSize?: number | null;
}): Promise<SendResult> {
  const base = appUrl();
  const name = escapeHtml(args.displayName || "there");
  const title = escapeHtml(args.streamTitle || "Untitled stream");
  const sizeLabel = args.byteSize ? formatBytes(args.byteSize) : null;
  const body = `
    <h1 style="font-size:20px;font-weight:600;margin:0 0 12px;">Your recording is ready, ${name}.</h1>
    <p style="margin:0 0 16px;color:#3f3f46;">
      <strong>${title}</strong> finished uploading to your archive${
        sizeLabel ? ` (${escapeHtml(sizeLabel)})` : ""
      }.
    </p>
    <p style="margin:0 0 20px;color:#3f3f46;">
      You can preview, share, download, or push it to YouTube from the stream
      summary page.
    </p>
    <p style="margin:24px 0 0;">
      <a href="${base}/host/streams/${encodeURIComponent(args.streamId)}/summary"
         style="display:inline-block;background:#18181b;color:#fafafa;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:600;">
        Open recording
      </a>
    </p>
  `;
  return sendOne(
    {
      to: args.to,
      subject: `Recording ready — ${args.streamTitle || "your stream"}`,
      bodyHtml: body,
      preheader: `Your archive finished uploading${sizeLabel ? ` (${sizeLabel})` : ""}. Click to view.`,
    },
    "archive-ready",
  );
}

/**
 * Plan granted — sent when an admin manually upgrades a host via the
 * /admin/billing → Manual grants UI. Transparency builds trust: the
 * host should never wonder why their plan suddenly changed.
 */
export function sendPlanGranted(args: {
  to: string;
  displayName: string;
  planName: string;
  grantedByEmail: string | null;
  reason: string | null;
  expiresAt: string | null;
}): Promise<SendResult> {
  const base = appUrl();
  const name = escapeHtml(args.displayName || "there");
  const plan = escapeHtml(args.planName);
  const granter = args.grantedByEmail
    ? escapeHtml(args.grantedByEmail)
    : "an admin";
  const expiresLine = args.expiresAt
    ? `<p style="margin:0 0 16px;color:#3f3f46;">It's valid until <strong>${escapeHtml(
        new Date(args.expiresAt).toLocaleDateString(undefined, {
          year: "numeric",
          month: "short",
          day: "numeric",
        }),
      )}</strong>.</p>`
    : `<p style="margin:0 0 16px;color:#3f3f46;">There's no expiry — enjoy.</p>`;
  const reasonLine = args.reason
    ? `<p style="margin:0 0 16px;color:#71717a;font-style:italic;">"${escapeHtml(args.reason)}"</p>`
    : "";
  const body = `
    <div style="background:#f5f3ff;border:1px solid #ddd6fe;border-radius:8px;padding:14px 16px;margin:0 0 20px;color:#5b21b6;font-size:13px;font-weight:600;">
      🎁 You've been upgraded
    </div>
    <h1 style="font-size:20px;font-weight:600;margin:0 0 12px;">Hi ${name},</h1>
    <p style="margin:0 0 16px;color:#3f3f46;">
      ${granter} just granted you the <strong>${plan}</strong> plan at no charge.
    </p>
    ${expiresLine}
    ${reasonLine}
    <p style="margin:24px 0 0;">
      <a href="${base}/host/dashboard"
         style="display:inline-block;background:#7c3aed;color:#fafafa;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:600;">
        Open dashboard
      </a>
    </p>
  `;
  return sendOne(
    {
      to: args.to,
      subject: `You've been upgraded to ${args.planName}`,
      bodyHtml: body,
      preheader: `${granter} granted you the ${args.planName} plan.`,
    },
    "plan-granted",
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}
