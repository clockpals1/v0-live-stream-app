import sanitizeHtml from "sanitize-html";

/**
 * Sanitize host-supplied HTML for delivery to email inboxes.
 *
 * Constraints:
 *   - Strips <script>, <iframe>, event handlers (onclick=…), javascript: URIs.
 *   - Allows inline styles (`style="…"`) because email clients only honour
 *     inline CSS — `<style>` blocks and external sheets get stripped/ignored
 *     by Gmail, Outlook, etc. Inline style is the correct compatibility lane.
 *   - Coerces every <a> to target=_blank rel=noopener noreferrer.
 *   - Permits data: URIs only on <img> so hosts can paste base64-inlined
 *     screenshots without us hosting them, but blocks data: elsewhere.
 *
 * The sanitizer runs on the server right before send and again before
 * preview render. We never trust client-side sanitization alone.
 */
export function sanitizeEmailHtml(dirty: string): string {
  return sanitizeHtml(dirty, {
    allowedTags: [
      "p", "br", "span", "strong", "em", "u", "s", "b", "i", "a",
      "h1", "h2", "h3", "h4", "h5", "h6",
      "ul", "ol", "li",
      "blockquote", "pre", "code",
      "img", "figure", "figcaption",
      "table", "thead", "tbody", "tfoot", "tr", "td", "th",
      "hr", "div", "small",
    ],
    allowedAttributes: {
      a: ["href", "target", "rel", "style"],
      img: ["src", "alt", "title", "width", "height", "style"],
      table: ["style", "width", "cellpadding", "cellspacing", "border"],
      td: ["style", "colspan", "rowspan", "align", "valign", "width"],
      th: ["style", "colspan", "rowspan", "align", "valign", "width"],
      tr: ["style", "align", "valign"],
      "*": ["style"],
    },
    allowedSchemes: ["http", "https", "mailto"],
    allowedSchemesByTag: {
      img: ["http", "https", "data"],
      a: ["http", "https", "mailto"],
    },
    allowedSchemesAppliedToAttributes: ["href", "src"],
    allowProtocolRelative: false,
    transformTags: {
      a: (tagName, attribs) => ({
        tagName: "a",
        attribs: {
          ...attribs,
          target: "_blank",
          rel: "noopener noreferrer",
        },
      }),
    },
    // Strip everything not on the allowlist; do not preserve as text.
    disallowedTagsMode: "discard",
  });
}

/**
 * Wrap sanitized body content in a minimal email-client-safe shell with
 * the host's name in the header and a per-recipient unsubscribe footer.
 *
 * The shell uses table-based layout because Gmail/Outlook handle <table>
 * far more reliably than flexbox or grid.
 */
export function renderEmailShell(opts: {
  hostName: string;
  bodyHtml: string;
  unsubscribeUrl: string;
  recipientEmail: string;
}): string {
  const { hostName, bodyHtml, unsubscribeUrl, recipientEmail } = opts;
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>${escapeHtml(hostName)} \u00b7 Insider Circle</title>
  </head>
  <body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;color:#18181b;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f4f4f5;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 2px rgba(0,0,0,0.05);">
            <tr>
              <td style="padding:24px 32px;border-bottom:1px solid #e4e4e7;">
                <div style="font-size:11px;letter-spacing:0.12em;text-transform:uppercase;color:#71717a;font-weight:600;">Insider Circle</div>
                <div style="font-size:18px;font-weight:600;color:#18181b;margin-top:4px;">${escapeHtml(hostName)}</div>
              </td>
            </tr>
            <tr>
              <td style="padding:24px 32px;font-size:15px;line-height:1.6;color:#27272a;">
                ${bodyHtml}
              </td>
            </tr>
            <tr>
              <td style="padding:20px 32px 28px;border-top:1px solid #e4e4e7;font-size:12px;color:#71717a;line-height:1.5;">
                You are receiving this because you joined
                <strong style="color:#52525b;">${escapeHtml(hostName)}'s</strong>
                Insider Circle as <span style="color:#52525b;">${escapeHtml(recipientEmail)}</span>.
                <br />
                <a href="${unsubscribeUrl}" style="color:#71717a;text-decoration:underline;">Unsubscribe instantly</a>
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
 * Lightweight email-format validator. Strict enough to reject obvious
 * garbage but lenient enough not to false-reject quoted/plus-tagged
 * addresses. We do NOT bounce-check here; that's Resend's job.
 */
export function isValidEmail(email: string): boolean {
  if (typeof email !== "string") return false;
  const trimmed = email.trim();
  if (trimmed.length < 5 || trimmed.length > 254) return false;
  // RFC-ish: local@domain.tld with at least one dot in the domain
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);
}
