import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getEffectivePlan } from "@/lib/billing/entitlements";
import { featureEnabled } from "@/lib/billing/plans";
import { listReplaysForHost } from "@/lib/studio/replay/queries";
import { ReplayLibraryView } from "@/components/studio/replay/library-view";
import { Card, CardContent } from "@/components/ui/card";
import { Lock } from "lucide-react";

/**
 * /studio/replay — the host's Replay Library landing.
 *
 * Server component: loads the joined archive+publication list, gates
 * on the `replay_publishing` feature flag, then hands off to a client
 * component that owns the list interactions (publish toggle, expand,
 * inline edit). Phase 2 will add likes/comments/public pages.
 */
export default async function ReplayLibraryPage() {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  const user = userData?.user;
  if (!user) redirect("/auth/login");

  const { data: host } = await supabase
    .from("hosts")
    .select("id, display_name")
    .eq("user_id", user.id)
    .maybeSingle();
  // Layout already auto-creates and blocks rendering when this is null,
  // so reaching here without a host means an exotic race. Fall back
  // gracefully rather than cross-origin redirecting (which crashes on
  // OpenNext + Cloudflare Workers in some Next 16 server-component
  // paths). The empty list state below covers it cleanly.
  const hostId = (host as { id: string } | null)?.id ?? "";

  const effective = await getEffectivePlan(supabase, user.id);
  const canPublish = featureEnabled(effective.plan, "replay_publishing");

  const replays = hostId ? await listReplaysForHost(supabase, hostId) : [];

  return (
    <main className="mx-auto max-w-5xl px-5 py-10 sm:px-8">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">
          Replay Library
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Every recording you've made. Publish a replay to give it a public
          page, a title, and a thumbnail.
        </p>
      </header>

      {!canPublish && (
        <Card className="mb-6 border-amber-500/30 bg-amber-500/5">
          <CardContent className="flex items-start gap-3 p-4">
            <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-amber-500/15 text-amber-700 dark:text-amber-300">
              <Lock className="h-3.5 w-3.5" />
            </div>
            <div>
              <h3 className="text-sm font-medium">
                Replay publishing isn't on your plan yet
              </h3>
              <p className="mt-0.5 text-xs text-muted-foreground">
                You can still see your archives below. Upgrade to publish
                them as social replays with thumbnails, descriptions, and
                shareable links.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      <ReplayLibraryView
        replays={replays}
        canPublish={canPublish}
        hostId={hostId}
      />
    </main>
  );
}
