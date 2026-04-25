/**
 * Minimal SMTP client for Cloudflare Workers.
 *
 * Talks the SMTP submission protocol directly over a TCP socket using
 * Cloudflare's built-in `cloudflare:sockets` module. Targeted at the
 * Insider Circle broadcast endpoint, so it implements the smallest
 * subset that works against every common managed SMTP relay (SendGrid,
 * Brevo, Mailgun, Postmark, AWS SES, Gmail/Workspace, Zoho, isunday.me,
 * etc.):
 *
 *   - Implicit TLS on port 465 (startTLS=false)
 *   - STARTTLS on submission port 587/25 (startTLS=true)
 *   - AUTH PLAIN (default)
 *   - One MAIL FROM / RCPT TO / DATA per call
 *
 * ─── Why the dynamic import? ────────────────────────────────────────
 *
 * `cloudflare:sockets` is a virtual built-in module that only exists at
 * runtime inside a Workers/Pages environment. The bundle pipeline for
 * this project is Next.js (Turbopack) → OpenNext → esbuild, and the
 * static `import` form gets transformed into a Turbopack chunk like
 *   `__turbopack_require__("cloudflare:sockets")`
 * which OpenNext's downstream esbuild then cannot resolve, causing the
 * build to fail with "Could not resolve 'cloudflare:sockets'".
 *
 * The fix is to hide the module specifier from every static-analysis
 * pass by going through `new Function("return import(...)")`. At
 * runtime, the Workers runtime sees the bare specifier and resolves it
 * to the built-in module. At build time, every bundler sees only a
 * Function constructor with a string argument and leaves it alone.
 *
 * This is the same trick used by Next.js itself for some of its
 * dynamic Edge runtime imports.
 */

// ─── Local types matching the cloudflare:sockets surface we use ─────
//
// We keep these inline rather than `import type { Socket } from "cloudflare:sockets"`
// because some bundler configurations have been observed to retain even
// type-only imports of virtual modules in their output graph. Inline
// types are 100% bundler-invisible.

interface CfSocket {
  readonly readable: ReadableStream<Uint8Array>;
  readonly writable: WritableStream<Uint8Array>;
  close(): Promise<void>;
  startTls(): CfSocket;
}

interface CfSocketsModule {
  connect(
    address: { hostname: string; port: number },
    options?: { secureTransport?: "on" | "off" | "starttls"; allowHalfOpen?: boolean },
  ): CfSocket;
}

let cachedConnect: CfSocketsModule["connect"] | null = null;

async function getConnect(): Promise<CfSocketsModule["connect"]> {
  if (cachedConnect) return cachedConnect;
  // Function-constructor dynamic import: invisible to Turbopack, esbuild,
  // webpack, and every other static analyser. The specifier is never
  // a string literal in the source AST; it's a runtime argument.
  const importDynamic = new Function(
    "spec",
    "return import(spec)",
  ) as (spec: string) => Promise<CfSocketsModule>;
  const mod = await importDynamic("cloudflare:sockets");
  cachedConnect = mod.connect;
  return cachedConnect;
}

// ────────────────────────────────────────────────────────────────────

export interface SmtpConfig {
  host: string;
  port: number;
  username: string;
  password: string;
  /** When true, wrap the socket in TLS immediately (port 465). When
   *  false, start in plaintext and upgrade via STARTTLS (ports 587/25). */
  implicitTls: boolean;
}

export interface SmtpMessage {
  from: string;
  to: string;
  subject: string;
  html: string;
}

export class SmtpClient {
  private socket: CfSocket | null = null;
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private writer: WritableStreamDefaultWriter<Uint8Array> | null = null;
  private buffer = "";
  private decoder = new TextDecoder();
  private encoder = new TextEncoder();

  constructor(private config: SmtpConfig) {}

  async connect(): Promise<void> {
    const { host, port, implicitTls, username, password } = this.config;
    const connect = await getConnect();

    this.socket = connect(
      { hostname: host, port },
      implicitTls ? { secureTransport: "on" } : { secureTransport: "starttls" },
    );
    this.reader = this.socket.readable.getReader();
    this.writer = this.socket.writable.getWriter();

    // 220 banner
    await this.expect(220);
    await this.cmd(`EHLO ${this.safeHelo(host)}`);
    await this.expect(250);

    if (!implicitTls) {
      await this.cmd("STARTTLS");
      await this.expect(220);
      // Upgrade socket to TLS, then re-EHLO over the encrypted channel.
      this.releaseLocks();
      this.socket = this.socket.startTls();
      this.reader = this.socket.readable.getReader();
      this.writer = this.socket.writable.getWriter();
      await this.cmd(`EHLO ${this.safeHelo(host)}`);
      await this.expect(250);
    }

    // AUTH PLAIN: \0username\0password, base64
    const authPayload = `\u0000${username}\u0000${password}`;
    const authB64 = btoa(authPayload);
    await this.cmd(`AUTH PLAIN ${authB64}`);
    await this.expect(235);
  }

  async send(msg: SmtpMessage): Promise<void> {
    const fromAddr = extractEmail(msg.from);
    const toAddr = extractEmail(msg.to);

    await this.cmd(`MAIL FROM:<${fromAddr}>`);
    await this.expect(250);
    await this.cmd(`RCPT TO:<${toAddr}>`);
    await this.expect([250, 251]);
    await this.cmd("DATA");
    await this.expect(354);

    // Build RFC 5322 message. CRLF line endings; lines starting with "."
    // get dot-stuffed; terminator is a lone ".".
    const headers = [
      `From: ${msg.from}`,
      `To: ${msg.to}`,
      `Subject: ${encodeMimeHeader(msg.subject)}`,
      `MIME-Version: 1.0`,
      `Content-Type: text/html; charset=UTF-8`,
      `Content-Transfer-Encoding: 8bit`,
      `Date: ${new Date().toUTCString()}`,
      `Message-ID: <${crypto.randomUUID()}@${this.config.host}>`,
    ].join("\r\n");

    const body = msg.html
      .split(/\r?\n/)
      .map((line) => (line.startsWith(".") ? "." + line : line))
      .join("\r\n");

    await this.write(`${headers}\r\n\r\n${body}\r\n.\r\n`);
    await this.expect(250);
  }

  async quit(): Promise<void> {
    try {
      if (this.writer) {
        await this.cmd("QUIT");
        await this.expect(221).catch(() => undefined);
      }
    } finally {
      this.releaseLocks();
      try {
        await this.socket?.close();
      } catch {
        // ignore
      }
      this.socket = null;
    }
  }

  // ─── internals ──────────────────────────────────────────────────────

  private async cmd(line: string): Promise<void> {
    await this.write(`${line}\r\n`);
  }

  private async write(s: string): Promise<void> {
    if (!this.writer) throw new Error("SMTP writer not available");
    await this.writer.write(this.encoder.encode(s));
  }

  /**
   * Read SMTP server response and assert the leading status code matches
   * `codes` (a single number or an array of acceptable numbers). Handles
   * multi-line responses (the `xyz-` continuation form).
   */
  private async expect(codes: number | number[]): Promise<string> {
    const expected = Array.isArray(codes) ? codes : [codes];
    const lines: string[] = [];

    while (true) {
      const line = await this.readLine();
      lines.push(line);
      if (line.length < 4) {
        throw new Error(`Bad SMTP response: ${line}`);
      }
      // Multi-line continuations look like "250-...". Final line is "250 ...".
      if (line[3] === " ") break;
    }

    const status = parseInt(lines[lines.length - 1].slice(0, 3), 10);
    if (!expected.includes(status)) {
      throw new Error(
        `SMTP error: expected ${expected.join("/")}, got ${status} \u2014 ${lines.join(" | ")}`,
      );
    }
    return lines.join("\n");
  }

  private async readLine(): Promise<string> {
    if (!this.reader) throw new Error("SMTP reader not available");

    while (!this.buffer.includes("\r\n")) {
      const { value, done } = await this.reader.read();
      if (done) {
        if (this.buffer.length > 0) {
          const out = this.buffer;
          this.buffer = "";
          return out;
        }
        throw new Error("SMTP connection closed by server");
      }
      this.buffer += this.decoder.decode(value, { stream: true });
    }

    const idx = this.buffer.indexOf("\r\n");
    const line = this.buffer.slice(0, idx);
    this.buffer = this.buffer.slice(idx + 2);
    return line;
  }

  private releaseLocks(): void {
    try { this.reader?.releaseLock(); } catch { /* ignore */ }
    try { this.writer?.releaseLock(); } catch { /* ignore */ }
    this.reader = null;
    this.writer = null;
  }

  private safeHelo(host: string): string {
    // EHLO arg should be a domain or IP. Fall back to "client" for anything weird.
    return /^[a-zA-Z0-9.\-]+$/.test(host) ? host : "client";
  }
}

/** Extract bare email from "Name <email>" or "email" form. */
function extractEmail(addr: string): string {
  const m = addr.match(/<([^>]+)>/);
  return m ? m[1].trim() : addr.trim();
}

/**
 * Encode a header value as RFC 2047 if it contains any non-ASCII chars,
 * so subjects with emoji or accents survive in transit.
 */
function encodeMimeHeader(value: string): string {
  // eslint-disable-next-line no-control-regex
  if (/^[\x00-\x7F]*$/.test(value)) return value;
  // base64-encoded UTF-8 word
  const b64 = btoa(unescape(encodeURIComponent(value)));
  return `=?UTF-8?B?${b64}?=`;
}
