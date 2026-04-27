import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/require-admin";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendPlanGranted } from "@/lib/email/transactional";
import {
  checkRateLimit,
  rateLimitHeaders,
  clientIpFromHeaders,
  POLICY_HEAVY_WRITE,
} from "@/lib/security/rate-limit";

/**
 * GET  /api/admin/billing/grants?hostId=…
 *   Returns grants for a single host (active first, then revoked) so
 *   the admin UI can show full history. Without ?hostId we return the
 *   N most-recent grants across the whole system, useful for an
 *   audit log.
 *
 * POST /api/admin/billing/grants
 *   Body: {
 *     hostId: string,        // hosts.id
 *     planSlug: string,      // billing_plans.slug; must be active
 *     effectiveAt?: string,  // ISO; defaults to now()
 *     expiresAt?: string,    // ISO; null = never expires
 *     reason?: string        // free-form note, max 500 chars
 *   }
 *   Issues a manual upgrade. Always uses the service-role client so
 *   it's the ONLY write path — RLS on the table denies all client
 *   writes.
 *
 * All routes are gated by requireAdmin() which enforces the role
 * check on the host row tied to the calling auth.uid(). A forged
 * request with a stolen access token still has to belong to a user
 * whose hosts.role = 'admin' (or is_admin=true).
 */

export async function GET(req: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const url = new URL(req.url);
  const hostId = url.searchParams.get("hostId");
  const limitRaw = Number(url.searchParams.get("limit") ?? "50");
  const limit = Math.min(Math.max(1, Number.isFinite(limitRaw) ? limitRaw : 50), 200);

  const admin = createAdminClient();
  let q = admin
    .from("admin_plan_grants")
    .select(
      "id, host_id, plan_slug, granted_by, granted_by_email, reason, effective_at, expires_at, revoked_at, revoked_by, revoked_by_email, revoke_reason, created_at",
    )
    .order("created_at", { ascending: false })
    .limit(limit);
  if (hostId) q = q.eq("host_id", hostId);
  const { data, error } = await q;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ grants: data ?? [] });
}

export async function POST(req: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  // Defense in depth: even with a valid admin token, cap grant
  // creation per actor + IP. A compromised admin session could
  // otherwise mass-grant before anyone notices.
  const rl = checkRateLimit(
    `admin:${auth.userId}:${clientIpFromHeaders(req.headers)}`,
    POLICY_HEAVY_WRITE,
  );
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Too many grants in a short window. Slow down.", code: "rate_limited" },
      { status: 429, headers: rateLimitHeaders(rl) },
    );
  }

  let body: {
    hostId?: string;
    planSlug?: string;
    effectiveAt?: string;
    expiresAt?: string | null;
    reason?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const hostId = body.hostId?.trim();
  const planSlug = body.planSlug?.trim();
  if (!hostId) {
    return NextResponse.json({ error: "hostId is required." }, { status: 400 });
  }
  if (!planSlug) {
    return NextResponse.json({ error: "planSlug is required." }, { status: 400 });
  }
  if (body.reason && body.reason.length > 500) {
    return NextResponse.json(
      { error: "Reason must be 500 characters or fewer." },
      { status: 400 },
    );
  }

  // Date parsing — let the DB CHECK constraint catch ordering issues
  // beyond this basic validation, since timezone wrangling there is
  // safer than re-implementing it here.
  const effectiveAt = body.effectiveAt ? new Date(body.effectiveAt) : new Date();
  if (Number.isNaN(effectiveAt.getTime())) {
    return NextResponse.json(
      { error: "effectiveAt is not a valid date." },
      { status: 400 },
    );
  }
  const expiresAt = body.expiresAt ? new Date(body.expiresAt) : null;
  if (expiresAt && Number.isNaN(expiresAt.getTime())) {
    return NextResponse.json(
      { error: "expiresAt is not a valid date." },
      { status: 400 },
    );
  }
  if (expiresAt && expiresAt <= effectiveAt) {
    return NextResponse.json(
      { error: "expiresAt must be after effectiveAt." },
      { status: 400 },
    );
  }

  const admin = createAdminClient();

  // Validate the host exists.
  const { data: host, error: hostErr } = await admin
    .from("hosts")
    .select("id, email, display_name")
    .eq("id", hostId)
    .maybeSingle();
  if (hostErr || !host) {
    return NextResponse.json({ error: "Host not found." }, { status: 404 });
  }

  // Validate the plan exists + is active. Granting an inactive plan
  // would leave the host with mystery features, so refuse.
  const { data: plan, error: planErr } = await admin
    .from("billing_plans")
    .select("id, slug, is_active, name")
    .eq("slug", planSlug)
    .maybeSingle();
  if (planErr || !plan) {
    return NextResponse.json({ error: "Plan not found." }, { status: 404 });
  }
  if (!plan.is_active) {
    return NextResponse.json(
      { error: "Cannot grant an inactive plan." },
      { status: 400 },
    );
  }

  // Insert the grant. We DON'T touch hosts.plan_slug — the entitlement
  // layer prefers active grants, so flipping plan_slug would cause
  // double-counting if the grant is later revoked.
  const { data: created, error: insertErr } = await admin
    .from("admin_plan_grants")
    .insert({
      host_id: hostId,
      plan_slug: planSlug,
      granted_by: auth.userId,
      granted_by_email: auth.email || null,
      reason: body.reason?.trim() || null,
      effective_at: effectiveAt.toISOString(),
      expires_at: expiresAt?.toISOString() ?? null,
    })
    .select("*")
    .single();
  if (insertErr) {
    return NextResponse.json({ error: insertErr.message }, { status: 500 });
  }

  // Server-side log row — also helpful for grepping deploy logs to
  // confirm a manual override was applied (admin actions are rare so
  // the noise is negligible).
  console.info(
    `[admin-grant] ${auth.email || auth.userId} granted ${planSlug} to host ${hostId}`,
  );

  // Notify the host that they've been upgraded. Fire-and-forget so an
  // email outage doesn't block the admin's grant action.
  if (host.email) {
    void sendPlanGranted({
      to: host.email,
      displayName: host.display_name ?? host.email,
      planName: plan.name,
      grantedByEmail: auth.email || null,
      reason: body.reason?.trim() || null,
      expiresAt: expiresAt?.toISOString() ?? null,
    });
  }

  return NextResponse.json({
    grant: created,
    host: { id: host.id, email: host.email, displayName: host.display_name },
    plan: { slug: plan.slug, name: plan.name },
  });
}
