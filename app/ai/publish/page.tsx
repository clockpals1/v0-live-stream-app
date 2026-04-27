import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getEffectivePlan } from "@/lib/billing/entitlements";
import { featureEnabled } from "@/lib/billing/plans";
import { ensureHostRow } from "@/lib/host/bootstrap";
import { isYoutubeConfigured } from "@/lib/integrations/youtube";
import { isInstagramConfigured } from "@/lib/integrations/instagram";
import { isTiktokConfigured } from "@/lib/integrations/tiktok";
import { isTwitterConfigured } from "@/lib/integrations/twitter";
import { Button } from "@/components/ui/button";
import { PublishingHubView } from "@/components/ai/publish/hub-view";
import type { QueueItem } from "@/components/ai/publish/hub-view";
import type { PlatformConnection } from "@/components/ai/publish/connections-tab";
import { Send, Lock, ArrowRight } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function PublishPage() {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData?.user) redirect("/auth/login");

  const host = await ensureHostRow(supabase, userData.user);
  const effective = await getEffectivePlan(supabase, userData.user.id);
  const isEntitled =
    effective.isPlatformAdmin || featureEnabled(effective.plan, "ai_publishing");

  if (!isEntitled) {
    return <UpgradeGate planName={effective.plan?.name ?? "Free"} />;
  }

  const canYoutube =
    effective.isPlatformAdmin ||
    (effective.plan?.features?.distribution_youtube === true);

  const youtubeServerConfigured = isYoutubeConfigured();
  const instagramConfigured     = isInstagramConfigured();
  const tiktokConfigured        = isTiktokConfigured();
  const twitterConfigured       = isTwitterConfigured();

  // ─── Platform connections (single query) ──────────────────────────
  const admin = createAdminClient();
  let youtube: PlatformConnection | null = null;
  let instagram: PlatformConnection | null = null;
  let tiktok: PlatformConnection | null = null;
  let twitter: PlatformConnection | null = null;

  if (host) {
    const { data: integrations } = await admin
      .from("host_integrations")
      .select("provider, provider_account_id, provider_account_name, provider_account_avatar_url, connected_at, token_expires_at")
      .eq("host_id", host.id)
      .in("provider", ["youtube", "instagram", "tiktok", "twitter"]);

    for (const row of integrations ?? []) {
      const conn: PlatformConnection = {
        providerAccountId: row.provider_account_id,
        providerAccountName: row.provider_account_name,
        providerAccountAvatarUrl: row.provider_account_avatar_url,
        connectedAt: row.connected_at,
        tokenExpiresAt: row.token_expires_at ?? null,
      };
      if (row.provider === "youtube")   youtube   = conn;
      if (row.provider === "instagram") instagram = conn;
      if (row.provider === "tiktok")    tiktok    = conn;
      if (row.provider === "twitter")   twitter   = conn;
    }
  }

  // ─── Publish queue ─────────────────────────────────────────────────
  let initialQueue: QueueItem[] = [];
  if (host) {
    const { data } = await supabase
      .from("publish_queue")
      .select(
        "id, title, body, platform, platform_meta, status, scheduled_for, published_at, " +
        "platform_post_id, platform_post_url, attempt_count, last_error, last_attempt_at, " +
        "ai_suggested_time, ai_suggestion_reason, asset_id, archive_id, created_at, updated_at"
      )
      .eq("host_id", host.id)
      .order("created_at", { ascending: false });
    initialQueue = (data ?? []) as unknown as QueueItem[];
  }

  return (
    <main className="mx-auto max-w-5xl px-5 py-10 sm:px-8 sm:py-12">
      <header className="mb-8">
        <div className="mb-2 inline-flex items-center gap-1.5 rounded-full border border-sky-200 bg-sky-50 px-2.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-sky-700 dark:border-sky-800 dark:bg-sky-950 dark:text-sky-300">
          <Send className="h-3 w-3" />
          Publishing Hub
        </div>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
          Distribute content across every platform
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Connect your social accounts and publish or schedule AI-generated content
          to YouTube, TikTok, Instagram, and more from one place.
        </p>
      </header>

      <PublishingHubView
        youtube={youtube}
        youtubeServerConfigured={youtubeServerConfigured}
        canYoutube={canYoutube}
        instagram={instagram}
        instagramConfigured={instagramConfigured}
        tiktok={tiktok}
        tiktokConfigured={tiktokConfigured}
        twitter={twitter}
        twitterConfigured={twitterConfigured}
        initialQueue={initialQueue}
      />
    </main>
  );
}

function UpgradeGate({ planName }: { planName: string }) {
  return (
    <main className="mx-auto max-w-5xl px-5 py-10 sm:px-8 sm:py-12">
      <header className="mb-8">
        <div className="mb-2 inline-flex items-center gap-1.5 rounded-full border border-sky-200 bg-sky-50 px-2.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-sky-700 dark:border-sky-800 dark:bg-sky-950 dark:text-sky-300">
          <Send className="h-3 w-3" />
          Publishing Hub
        </div>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
          Distribute content across every platform
        </h1>
      </header>
      <div className="flex flex-col items-center justify-center py-20 text-center gap-4">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
          <Lock className="h-6 w-6 text-primary" />
        </div>
        <h2 className="text-base font-semibold">Publishing Hub requires an upgrade</h2>
        <p className="text-sm text-muted-foreground max-w-sm">
          Your current plan (<strong>{planName}</strong>) doesn&apos;t include AI publishing.
          Upgrade to unlock cross-platform scheduling and social automation.
        </p>
        <Button asChild>
          <Link href="https://live.isunday.me/host/settings">
            View upgrade options <ArrowRight className="ml-1.5 h-4 w-4" />
          </Link>
        </Button>
      </div>
    </main>
  );
}
