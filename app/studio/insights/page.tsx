import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getEffectivePlan } from "@/lib/billing/entitlements";
import { featureEnabled } from "@/lib/billing/plans";
import { InsightsView } from "@/components/studio/insights/insights-view";

/**
 * Studio Insights — Phase 5 analytics surface.
 *
 * SSR resolves the host's effective plan and whether they have the
 * `live_analytics` feature. The InsightsView client component handles
 * the data fetch + recharts rendering so the SSR tree stays minimal.
 *
 * Gate: live_analytics feature key (admin bypass always passes).
 */
export const dynamic = "force-dynamic";

export default async function InsightsPage() {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData?.user) redirect("/auth/login");

  const eff = await getEffectivePlan(supabase, userData.user.id);

  const isEntitled =
    eff.isPlatformAdmin || featureEnabled(eff.plan, "live_analytics");

  return (
    <main className="mx-auto max-w-5xl px-5 py-10 sm:px-8">
      <header className="mb-8 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Insights</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Viewer count, peak concurrents, chat activity, replay watch time,
            subscriber conversions, and stream retention.
          </p>
        </div>
        {eff.plan && (
          <div className="shrink-0 rounded-full border border-primary/20 bg-primary/5 px-2.5 py-0.5 text-[11px] font-medium text-primary">
            {eff.isPlatformAdmin ? "Admin" : eff.plan.name}
          </div>
        )}
      </header>

      <InsightsView
        planSlug={eff.plan?.slug ?? "free"}
        isEntitled={isEntitled}
        isPlatformAdmin={eff.isPlatformAdmin}
      />
    </main>
  );
}
