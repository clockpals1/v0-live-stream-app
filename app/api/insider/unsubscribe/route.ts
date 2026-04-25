import { createAdminClient } from "@/lib/supabase/admin";

/**
 * GET /api/insider/unsubscribe?token=<unsubscribe_token>
 *
 * Public endpoint linked from every Insider Circle email footer. We use
 * GET (not POST) because email clients can only render plain hyperlinks.
 * One-click unsubscribe is the standard for compliance.
 *
 * Returns a small inline HTML confirmation page rather than redirecting,
 * so the viewer doesn't need an account or an open browser tab on the
 * app's domain to complete the action.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const token = (url.searchParams.get("token") || "").trim();

  if (!token || token.length < 16 || token.length > 64) {
    return htmlResponse(400, page({
      title: "Invalid unsubscribe link",
      message:
        "This unsubscribe link is not valid. If you keep receiving messages " +
        "you don't want, please reply to one of them and we'll remove you.",
      tone: "error",
    }));
  }

  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return htmlResponse(500, page({
      title: "Couldn't process this request",
      message: "Our server isn't available right now. Please try again later.",
      tone: "error",
    }));
  }

  // Look up the subscriber by token and grab the host name for the message.
  const { data: sub } = await admin
    .from("host_subscribers")
    .select("id, email, is_active, host:hosts(display_name, email)")
    .eq("unsubscribe_token", token)
    .maybeSingle();

  if (!sub) {
    return htmlResponse(404, page({
      title: "Unsubscribe link not found",
      message:
        "This link has expired or has already been used. You can ignore future " +
        "messages or reply to ask the sender to remove you.",
      tone: "error",
    }));
  }

  const hostName =
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (sub as any).host?.display_name || (sub as any).host?.email || "this host";

  if (!sub.is_active) {
    return htmlResponse(200, page({
      title: "You're already unsubscribed",
      message: `${escapeHtml(sub.email)} is no longer subscribed to ${escapeHtml(hostName)}'s Insider Circle.`,
      tone: "success",
    }));
  }

  const { error } = await admin
    .from("host_subscribers")
    .update({ is_active: false, unsubscribed_at: new Date().toISOString() })
    .eq("id", sub.id);

  if (error) {
    console.error("[insider/unsubscribe] update failed:", error);
    return htmlResponse(500, page({
      title: "Couldn't unsubscribe",
      message: "Something went wrong on our end. Please try the link again in a minute.",
      tone: "error",
    }));
  }

  return htmlResponse(200, page({
    title: "You've been unsubscribed",
    message: `${escapeHtml(sub.email)} will no longer receive Insider Circle messages from ${escapeHtml(hostName)}. Sorry to see you go.`,
    tone: "success",
  }));
}

function htmlResponse(status: number, body: string): Response {
  return new Response(body, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function page(opts: { title: string; message: string; tone: "success" | "error" }): string {
  const accent = opts.tone === "success" ? "#16a34a" : "#dc2626";
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>${escapeHtml(opts.title)}</title>
    <style>
      body{margin:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#18181b;}
      .wrap{min-height:100vh;display:flex;align-items:center;justify-content:center;padding:32px 16px;}
      .card{background:#fff;max-width:480px;width:100%;border-radius:12px;box-shadow:0 1px 4px rgba(0,0,0,.06);padding:32px;text-align:center;}
      .badge{display:inline-block;padding:6px 12px;border-radius:999px;background:${accent}18;color:${accent};font-size:11px;letter-spacing:.12em;text-transform:uppercase;font-weight:600;margin-bottom:16px;}
      h1{font-size:20px;margin:0 0 12px;color:#18181b;}
      p{font-size:15px;line-height:1.55;color:#52525b;margin:0;}
      .foot{margin-top:24px;font-size:11px;color:#a1a1aa;letter-spacing:.08em;text-transform:uppercase;}
    </style>
  </head>
  <body>
    <div class="wrap">
      <div class="card">
        <div class="badge">Insider Circle</div>
        <h1>${escapeHtml(opts.title)}</h1>
        <p>${opts.message}</p>
        <div class="foot">Isunday Stream Live</div>
      </div>
    </div>
  </body>
</html>`;
}
