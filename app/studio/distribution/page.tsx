import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getEffectivePlan } from "@/lib/billing/entitlements";
import { isYoutubeConfigured } from "@/lib/integrations/youtube";
import { listReplaysForHost } from "@/lib/studio/replay/queries";
import { DistributionHubView } from "@/components/studio/distribution/hub-view";

/**
 * Distribution Hub — Phase 3 surface.
 *
 * SSR: loads archives, YouTube connection status, and effective plan
 * then passes them to the client DistributionHubView.
 */
export const dynamic = "force-dynamic";

export default async function DistributionPage() {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  const user = userData?.user;
  if (!user) redirect("/auth/login");

  const admin = createAdminClient();

  const { data: host } = await supabase
    .from("hosts")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();
  const hostId = (host as { id: string } | null)?.id ?? "";

  const effective = await getEffectivePlan(supabase, user.id);
  const canYoutube = effective.isPlatformAdmin || (effective.plan?.features?.distribution_youtube === true);
  const canDownload = effective.isPlatformAdmin || (effective.plan?.features?.cloud_archive_download === true);

  const archives = hostId ? await listReplaysForHost(supabase, hostId) : [];

  const youtubeServerConfigured = isYoutubeConfigured();

  let youtubeConnected: {
    providerAccountId: string | null;
    providerAccountName: string | null;
    providerAccountAvatarUrl: string | null;
    connectedAt: string;
  } | null = null;

  if (hostId) {
    const { data: row } = await admin
      .from("host_integrations")
      .select("provider_account_id, provider_account_name, provider_account_avatar_url, connected_at")
      .eq("host_id", hostId)
      .eq("provider", "youtube")
      .maybeSingle();
    if (row) {
      youtubeConnected = {
        providerAccountId: row.provider_account_id,
        providerAccountName: row.provider_account_name,
        providerAccountAvatarUrl: row.provider_account_avatar_url,
        connectedAt: row.connected_at,
      };
    }
  }

  return (
    <main className="mx-auto max-w-5xl px-5 py-10 sm:px-8">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">Distribution Hub</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          One place to manage where your recordings go after a stream ends.
        </p>
      </header>

      <DistributionHubView
        archives={archives}
        youtubeConnected={youtubeConnected}
        youtubeServerConfigured={youtubeServerConfigured}
        canYoutube={canYoutube}
        canDownload={canDownload}
      />
    </main>
  );
}
