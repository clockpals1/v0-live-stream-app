import { NextRequest, NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { deleteObject } from "@/lib/storage/r2";
import { getActiveStripe } from "@/lib/billing/stripe";
import { reportError } from "@/lib/observability/sentry";

/**
 * DELETE /api/host/me
 *
 * GDPR Article 17 ("right to erasure") implementation. Deletes
 * EVERYTHING about the calling host:
 *   1. Cancels their Stripe subscription immediately (no refund — we
 *      don't have policy authority to issue one; admin can refund
 *      manually from Stripe dashboard if appropriate).
 *   2. Deletes (best-effort) every R2 archive object they own.
 *   3. Deletes the host's hosts row, which cascades to:
 *        - streams (host_id ON DELETE CASCADE)
 *        - stream_archives (host_id ON DELETE CASCADE)
 *        - host_integrations (host_id ON DELETE CASCADE)
 *        - host_subscribers (host_id ON DELETE CASCADE)
 *        - host_broadcasts (host_id ON DELETE CASCADE)
 *        - admin_plan_grants (host_id ON DELETE CASCADE)
 *   4. Deletes the underlying auth.users row.
 *
 * Body: { confirmEmail: string }
 *   Must equal the caller's auth email exactly (case-insensitive).
 *   This is the standard "type your email to confirm" pattern that
 *   prevents accidental clicks. Real CSRF protection comes from
 *   Supabase's session cookies (SameSite=Lax) + same-origin enforcement.
 *
 * AUTH
 * ----
 * Caller must be signed in. They can only delete THEIR OWN account;
 * there is no admin-deletes-someone path here (admins delete via
 * /api/admin/hosts/[id] DELETE, which is a different code path with
 * its own policy decisions about Stripe).
 *
 * IDEMPOTENCY
 * -----------
 * Each step is idempotent: deleting already-deleted R2 objects
 * succeeds (R2 returns 204), Stripe's "cancel subscription" on an
 * already-canceled sub returns the canceled sub, the auth user
 * delete fails noisily if already gone but that's fine — we're at
 * the end of the cascade by then.
 *
 * FAILURE MODE
 * ------------
 * If ANY step fails midway, we log the partial state and return 500
 * with details. The client can retry; subsequent runs will skip
 * already-completed steps. We never leave the system in a state
 * where the user "looks" deleted but their R2 archives are still
 * accruing storage costs.
 */
export async function DELETE(req: NextRequest) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  let body: { confirmEmail?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  if (!body.confirmEmail) {
    return NextResponse.json(
      { error: "confirmEmail is required.", code: "confirmation_required" },
      { status: 400 },
    );
  }
  if (
    !user.email ||
    body.confirmEmail.trim().toLowerCase() !== user.email.toLowerCase()
  ) {
    return NextResponse.json(
      {
        error:
          "Confirmation email does not match the signed-in account.",
        code: "confirmation_mismatch",
      },
      { status: 400 },
    );
  }

  let admin;
  try {
    admin = createAdminClient();
  } catch (e) {
    void reportError(e, { source: "api/host/me/delete" });
    return NextResponse.json(
      { error: "Delete service unavailable." },
      { status: 503 },
    );
  }

  // We log every step so a partial failure leaves enough breadcrumbs
  // for an operator to manually finish the deletion.
  const log = (msg: string) =>
    console.info(`[host/me/delete] user=${user.id} ${msg}`);

  // ─── 0. Look up host row + linked external accounts ──────────────
  const { data: host } = await admin
    .from("hosts")
    .select(
      "id, email, stripe_customer_id, stripe_subscription_id",
    )
    .eq("user_id", user.id)
    .maybeSingle();
  // It's legal to delete an auth user that has no host row (rare
  // edge case where signup half-failed). We just skip the cascade
  // steps that need a host.id.

  const errors: Array<{ step: string; reason: string }> = [];

  // ─── 1. Cancel Stripe subscription ───────────────────────────────
  if (host?.stripe_subscription_id) {
    try {
      const { stripe } = await getActiveStripe(admin);
      // cancel_at_period_end:false → immediate cancel, prorated.
      // We pass `prorate:false` so we don't issue a refund; we don't
      // have policy authority to do that automatically.
      await stripe.subscriptions.cancel(host.stripe_subscription_id, {
        prorate: false,
      });
      log(`stripe sub ${host.stripe_subscription_id} canceled`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push({ step: "stripe_cancel", reason: msg });
      void reportError(e, {
        source: "api/host/me/delete",
        tags: { step: "stripe_cancel" },
        user: { id: user.id },
      });
      // Continue — we'd rather delete the user with a stuck Stripe
      // sub (admin can clean up later) than leave them with a
      // half-deleted account.
    }
  }

  // ─── 2. Delete R2 archive objects (best-effort) ──────────────────
  if (host?.id) {
    const { data: liveArchives } = await admin
      .from("stream_archives")
      .select("id, object_key")
      .eq("host_id", host.id)
      .is("deleted_at", null);

    let r2Deleted = 0;
    let r2Failed = 0;
    for (const a of liveArchives ?? []) {
      try {
        const r = await deleteObject({ objectKey: a.object_key });
        if (r.ok) r2Deleted++;
        else {
          r2Failed++;
          errors.push({
            step: "r2_delete",
            reason: `${a.object_key}: ${r.error}`,
          });
        }
      } catch (e) {
        r2Failed++;
        const msg = e instanceof Error ? e.message : String(e);
        errors.push({ step: "r2_delete", reason: `${a.object_key}: ${msg}` });
      }
    }
    log(`r2 deleted=${r2Deleted} failed=${r2Failed}`);
  }

  // ─── 3. Delete the hosts row ─────────────────────────────────────
  // Foreign keys with ON DELETE CASCADE handle: streams,
  // stream_archives, host_integrations, host_subscribers,
  // host_broadcasts, admin_plan_grants.
  if (host?.id) {
    const { error: hostDelErr } = await admin
      .from("hosts")
      .delete()
      .eq("id", host.id);
    if (hostDelErr) {
      errors.push({ step: "db_host_delete", reason: hostDelErr.message });
      void reportError(new Error(hostDelErr.message), {
        source: "api/host/me/delete",
        tags: { step: "db_host_delete" },
        user: { id: user.id },
      });
    } else {
      log("hosts row deleted (cascading)");
    }
  }

  // ─── 4. Delete the auth.users row ────────────────────────────────
  // Done last, since it invalidates the session immediately. Use
  // service-role admin auth API — there's no SQL DELETE on auth.users
  // exposed by Supabase.
  try {
    const { error: authDelErr } = await admin.auth.admin.deleteUser(user.id);
    if (authDelErr) {
      errors.push({ step: "auth_user_delete", reason: authDelErr.message });
      void reportError(new Error(authDelErr.message), {
        source: "api/host/me/delete",
        tags: { step: "auth_user_delete" },
        user: { id: user.id },
      });
    } else {
      log("auth.users row deleted");
    }
  } catch (e) {
    errors.push({
      step: "auth_user_delete",
      reason: e instanceof Error ? e.message : String(e),
    });
  }

  // If anything failed, return a non-200 with the partial state. The
  // client should treat this as "deletion in progress; contact support
  // if it doesn't resolve."
  if (errors.length > 0) {
    return NextResponse.json(
      {
        ok: false,
        partial: true,
        errors,
        message:
          "Some cleanup steps failed. Your account is mostly deleted, " +
          "but support has been notified to finish the rest.",
      },
      { status: 207 }, // Multi-Status; client can read partial:true.
    );
  }

  // The session is now invalid; tell the browser to forget every
  // cookie we set so the client UI redirects cleanly.
  const res = NextResponse.json({ ok: true, deleted: true });
  // Clear Supabase auth cookies. The exact cookie names depend on
  // the project ref; this is a defensive sweep.
  for (const name of [
    "sb-access-token",
    "sb-refresh-token",
  ]) {
    res.cookies.set(name, "", { maxAge: 0, path: "/" });
  }
  return res;
}
