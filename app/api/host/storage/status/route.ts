import { NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { isR2Configured } from "@/lib/storage/r2";
import { getPlanForUser, featureEnabled } from "@/lib/billing/plans";

/**
 * GET /api/host/storage/status
 *
 * Tells the client whether cloud archive is reachable for THIS host.
 * Combines two facts:
 *   serverConfigured  — Cloudflare Worker has the R2 secrets bound
 *   planAllows        — caller's plan has cloud_archive feature on
 *
 * Response is cheap and idempotent so the post-stream dialog can call
 * it on mount without worrying about hammering the backend.
 */
export async function GET() {
  try {
    const supabase = await createServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Not signed in." }, { status: 401 });
    }

    const serverConfigured = isR2Configured();

    // Plan check uses RLS-scoped client; an anon user can't reach here
    // because of the auth check above.
    const plan = await getPlanForUser(supabase, user.id);
    const planAllows = featureEnabled(plan, "cloud_archive");

    return NextResponse.json({
      provider: "r2",
      serverConfigured,
      planAllows,
      available: serverConfigured && planAllows,
      planSlug: plan?.slug ?? null,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to check storage.";
    console.error("[host/storage/status] failed:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
