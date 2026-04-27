import { NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { reportError } from "@/lib/observability/sentry";

/**
 * POST /api/host/me/export
 *
 * GDPR Article 20 ("right to data portability") implementation.
 * Returns a JSON dump of every piece of personal data the platform
 * holds about the calling host, in a structured machine-readable
 * format.
 *
 * What's INCLUDED
 * ---------------
 *   - hosts row (display_name, email, plan, all subscription fields).
 *   - streams the host owns (titles, dates, room codes, recording URLs).
 *   - stream_archives metadata (NOT the bytes — the file URLs are
 *     included so the user can download separately).
 *   - host_integrations (REDACTED — we never put the encrypted access
 *     tokens in the export; we say which provider is connected and
 *     what the channel id/name is).
 *   - host_subscribers (their Insider Circle audience — emails of
 *     people who subscribed TO them; this IS personal data of the
 *     subscribers, but Article 20 covers data the host controls).
 *   - host_broadcasts (subjects, body, sent_count, failed_count).
 *   - admin_plan_grants targeting them, with the granting admin email
 *     so they understand any manual upgrade.
 *
 * What's EXCLUDED
 * ---------------
 *   - Other hosts' streams / subscribers (not their data).
 *   - Encrypted OAuth tokens (security risk to expose, also derivable
 *     by re-connecting).
 *   - Stripe customer object (Stripe has its own data export at
 *     stripe.com/settings/data — pointed at in the export's `_links`).
 *   - Any internal logs / Sentry events / server analytics.
 *
 * Response is a single JSON document with a top-level `_meta` object
 * for provenance and a `Content-Disposition: attachment` header so
 * the browser saves it as a file.
 *
 * Use POST (not GET) so the request can't be triggered by a stray
 * link or img-src and so credential-bearing requests don't show up
 * in browser history / referrer headers.
 */
export async function POST() {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  let admin;
  try {
    admin = createAdminClient();
  } catch (e) {
    void reportError(e, { source: "api/host/me/export" });
    return NextResponse.json(
      { error: "Export service unavailable." },
      { status: 503 },
    );
  }

  try {
    // ─── host row ────────────────────────────────────────────────
    const { data: host } = await admin
      .from("hosts")
      .select("*")
      .eq("user_id", user.id)
      .maybeSingle();
    if (!host) {
      return NextResponse.json({ error: "No host profile." }, { status: 404 });
    }

    // ─── streams the host owns ───────────────────────────────────
    const { data: streams } = await admin
      .from("streams")
      .select("*")
      .eq("host_id", host.id)
      .order("created_at", { ascending: false });

    // ─── archives ─────────────────────────────────────────────────
    const { data: archives } = await admin
      .from("stream_archives")
      .select("*")
      .eq("host_id", host.id)
      .order("created_at", { ascending: false });

    // ─── integrations (REDACT secrets) ───────────────────────────
    const { data: integrationsRaw } = await admin
      .from("host_integrations")
      .select(
        "provider, provider_account_id, provider_account_name, scope, expires_at, created_at, updated_at",
      )
      .eq("host_id", host.id);
    // Belt-and-braces: even if someone adds an access_token column to
    // the select above by mistake, strip it before serialising.
    const integrations = (integrationsRaw ?? []).map((i) => {
      const { ...safe } = i as Record<string, unknown>;
      delete safe.access_token;
      delete safe.refresh_token;
      delete safe.access_token_encrypted;
      delete safe.refresh_token_encrypted;
      return safe;
    });

    // ─── insider circle subscribers ──────────────────────────────
    const { data: subscribers } = await admin
      .from("host_subscribers")
      .select(
        "email, display_name, subscribed_at, unsubscribed_at, status, source",
      )
      .eq("host_id", host.id);

    // ─── broadcasts they sent ────────────────────────────────────
    const { data: broadcasts } = await admin
      .from("host_broadcasts")
      .select(
        "subject, html_body, recipient_count, sent_count, failed_count, status, created_at, completed_at",
      )
      .eq("host_id", host.id)
      .order("created_at", { ascending: false });

    // ─── admin grants targeting them ─────────────────────────────
    const { data: grants } = await admin
      .from("admin_plan_grants")
      .select(
        "plan_slug, granted_by_email, reason, effective_at, expires_at, revoked_at, revoked_by_email, revoke_reason, created_at",
      )
      .eq("host_id", host.id)
      .order("created_at", { ascending: false });

    // ─── compose ─────────────────────────────────────────────────
    const document = {
      _meta: {
        format: "live-stream-app/host-export",
        version: 1,
        generated_at: new Date().toISOString(),
        user_id: user.id,
        host_id: host.id,
        notes:
          "OAuth tokens (YouTube, etc.) are intentionally redacted. " +
          "Stripe data export available separately at https://dashboard.stripe.com/settings/data.",
      },
      _links: {
        stripe_data: "https://dashboard.stripe.com/settings/data",
        privacy_policy:
          (process.env.APP_URL ||
            process.env.NEXT_PUBLIC_APP_URL ||
            "https://live.isunday.me") + "/privacy",
      },
      auth_user: {
        id: user.id,
        email: user.email,
        created_at: user.created_at,
        last_sign_in_at: user.last_sign_in_at,
      },
      host,
      streams: streams ?? [],
      archives: archives ?? [],
      integrations,
      insider_circle: {
        subscribers: subscribers ?? [],
        broadcasts: broadcasts ?? [],
      },
      admin_grants: grants ?? [],
    };

    const body = JSON.stringify(document, null, 2);
    const filename = `live-stream-export-${host.id}-${new Date()
      .toISOString()
      .slice(0, 10)}.json`;

    console.info(
      `[host/me/export] exported ${body.length} bytes for host ${host.id}`,
    );

    return new NextResponse(body, {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        // Hint to caches NOT to keep this around.
        "Cache-Control": "no-store, max-age=0",
      },
    });
  } catch (e) {
    void reportError(e, { source: "api/host/me/export", user: { id: user.id } });
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Export failed." },
      { status: 500 },
    );
  }
}
