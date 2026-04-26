import { NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { isYoutubeConfigured } from "@/lib/integrations/youtube";
import { getEffectivePlan } from "@/lib/billing/entitlements";

/**
 * GET /api/host/integrations/youtube/status
 *
 * Combined check for the post-stream dialog and settings card:
 *   serverConfigured  — Worker has GOOGLE_* secrets
 *   planAllows        — caller's plan has youtube_upload feature
 *   connected         — caller's host_integrations row exists for youtube
 *
 * Returns redacted account info (id, name, avatar) if connected — never
 * the tokens. The RLS policy on host_integrations allows the caller to
 * read their own row, so we use the user-scoped client here, not admin.
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

    const serverConfigured = isYoutubeConfigured();
    const eff = await getEffectivePlan(supabase, user.id);
    const planAllows = eff.isPlatformAdmin
      || (eff.plan?.features?.youtube_upload === true);

    // Look up the host id, then the integration row.
    const { data: host } = await supabase
      .from("hosts")
      .select("id")
      .eq("user_id", user.id)
      .maybeSingle();
    let connected = null as null | {
      providerAccountId: string | null;
      providerAccountName: string | null;
      providerAccountAvatarUrl: string | null;
      connectedAt: string;
      scopes: string[];
    };
    if (host) {
      const { data: row } = await supabase
        .from("host_integrations")
        .select(
          "provider_account_id, provider_account_name, provider_account_avatar_url, connected_at, scopes",
        )
        .eq("host_id", host.id)
        .eq("provider", "youtube")
        .maybeSingle();
      if (row) {
        connected = {
          providerAccountId: row.provider_account_id,
          providerAccountName: row.provider_account_name,
          providerAccountAvatarUrl: row.provider_account_avatar_url,
          connectedAt: row.connected_at,
          scopes: row.scopes ?? [],
        };
      }
    }

    return NextResponse.json({
      provider: "youtube",
      serverConfigured,
      planAllows,
      available: serverConfigured && planAllows,
      connected,
      planSlug: eff.plan?.slug ?? null,
      planSource: eff.source,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to load status.";
    console.error("[host/integrations/youtube/status] failed:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
