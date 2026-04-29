import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getEffectivePlan } from "@/lib/billing/entitlements";
import { featureEnabled } from "@/lib/billing/plans";
import { isNextControlFlowSignal } from "@/lib/next/control-flow";
import { GeneratorForm } from "@/components/ai/studio/generator-form";
import { AssetCardClient } from "@/components/ai/studio/asset-card-client";
import { RecentGenerations } from "@/components/ai/studio/recent-generations";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import {
  Sparkles,
  Clock,
  ArrowRight,
  Zap,
  Lock,
  Send,
  CircleDollarSign,
} from "lucide-react";

export const dynamic = "force-dynamic";

/**
 * AI Studio — the main generation workspace on ai.isunday.me.
 *
 * Server component: resolves host, plan entitlement, and recent assets.
 * The GeneratorForm is a client component that handles the actual generation
 * UX via POST /api/ai/generate.
 */
export default async function AiStudioPage() {
  try {
    return await renderPage();
  } catch (err) {
    if (isNextControlFlowSignal(err)) throw err;
    const e = err as Error;
    console.error("[ai/page] error:", e?.message);
    return (
      <main className="mx-auto max-w-5xl px-5 py-14">
        <p className="text-sm text-muted-foreground">{e?.message || "Failed to load."}</p>
      </main>
    );
  }
}

async function renderPage() {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData?.user) redirect("/auth/login");

  const admin = createAdminClient();
  const { data: host } = await admin
    .from("hosts")
    .select("id, display_name")
    .eq("user_id", userData.user.id)
    .maybeSingle();
  if (!host) redirect("/auth/login");

  const effective = await getEffectivePlan(supabase, userData.user.id);
  const isEntitled =
    effective.isPlatformAdmin || featureEnabled(effective.plan, "ai_content_generation");

  // Recent assets (last 6, non-archived)
  type AssetRow = {
    id: string;
    asset_type: string;
    title: string | null;
    content: string;
    platform: string | null;
    created_at: string;
    is_starred: boolean;
    video_project_id: string | null;
    video_project_status: string | null;
  };

  // Step 1: simple asset fetch — always works
  const { data: rawAssets } = await admin
    .from("ai_generated_assets")
    .select("id, asset_type, title, content, platform, created_at, is_starred")
    .eq("host_id", host.id)
    .is("archived_at", null)
    .order("created_at", { ascending: false })
    .limit(12);

  // Step 2: try to enrich short_video rows with video_project data.
  // Gracefully skipped if the video_projects table doesn't exist yet.
  const videoProjectMap: Record<string, { id: string; status: string }> = {};
  const shortVideoIds = (rawAssets ?? [])
    .filter((a) => a.asset_type === "short_video")
    .map((a) => a.id);

  if (shortVideoIds.length > 0) {
    try {
      const { data: vps } = await admin
        .from("video_projects")
        .select("id, status, asset_id")
        .in("asset_id", shortVideoIds);
      for (const vp of vps ?? []) {
        if (vp.asset_id) {
          videoProjectMap[vp.asset_id as string] = {
            id: vp.id as string,
            status: vp.status as string,
          };
        }
      }
    } catch {
      // video_projects table not yet created — skip enrichment
    }
  }

  const recentAssets: AssetRow[] = (rawAssets ?? []).map((a) => ({
    ...a,
    video_project_id: videoProjectMap[a.id]?.id ?? null,
    video_project_status: videoProjectMap[a.id]?.status ?? null,
  }));

  // Monthly usage count
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);
  const { count: monthlyCount } = await admin
    .from("ai_tasks")
    .select("id", { count: "exact", head: true })
    .eq("host_id", host.id)
    .eq("status", "done")
    .gte("created_at", startOfMonth.toISOString());

  const firstName = host.display_name?.split(" ")[0] || "creator";

  if (!isEntitled) {
    return <UpgradeGate planName={effective.plan?.name ?? "Free"} />;
  }

  return (
    <main className="mx-auto max-w-5xl px-5 py-10 sm:px-8 sm:py-12">
      {/* ─── header ───────────────────────────────────────────────────── */}
      <div className="mb-8 flex items-start justify-between gap-6">
        <div>
          <div className="mb-2 inline-flex items-center gap-1.5 rounded-full border border-violet-200 bg-violet-50 px-2.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-violet-700 dark:border-violet-800 dark:bg-violet-950 dark:text-violet-300">
            <Sparkles className="h-3 w-3" />
            AI Creation Studio
          </div>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            Create content that converts.
          </h1>
          <p className="mt-2 text-sm text-muted-foreground max-w-lg">
            Short video scripts, ad copy, affiliate campaigns, stream content, and social packs — built for real publishing.
          </p>
        </div>
        <div className="shrink-0 rounded-xl border border-border bg-muted/30 px-4 py-3 text-center">
          <div className="text-2xl font-semibold tabular-nums">{monthlyCount ?? 0}</div>
          <div className="text-[11px] text-muted-foreground">generated this month</div>
        </div>
      </div>

      {/* ─── generator ────────────────────────────────────────────────── */}
      <GeneratorForm hostId={host.id} />

      {/* ─── recent assets ────────────────────────────────────────────── */}
      {recentAssets && recentAssets.length > 0 && (
        <section className="mt-12">
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-muted-foreground" />
              <h2 className="text-sm font-semibold">Recent generations</h2>
            </div>
          </div>
            <RecentGenerations assets={recentAssets} />
        </section>
      )}

      {/* ─── next steps ───────────────────────────────────────────────── */}
      <section className="mt-12">
        <h2 className="mb-4 text-sm font-semibold text-muted-foreground uppercase tracking-wider">
          More in the AI Hub
        </h2>
        <div className="grid gap-3 sm:grid-cols-3">
          <HubLink
            href="/ai/automate"
            icon={Zap}
            label="Automation"
            blurb="Daily content ideas and weekly summaries on autopilot."
            tone="violet"
          />
          <HubLink
            href="/ai/publish"
            icon={Send}
            label="Publishing Hub"
            blurb="Schedule and post your generated content across platforms."
            tone="sky"
          />
          <HubLink
            href="/ai/monetize"
            icon={CircleDollarSign}
            label="Monetization Hub"
            blurb="Affiliate campaigns, brand deal copy, and revenue-focused packs."
            tone="amber"
          />
        </div>
      </section>
    </main>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function HubLink({
  href,
  icon: Icon,
  label,
  blurb,
  tone,
}: {
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  blurb: string;
  tone: "violet" | "sky" | "amber";
}) {
  const tones = {
    violet: "from-violet-500/10 to-purple-500/5 ring-violet-500/20",
    sky: "from-sky-500/10 to-cyan-500/5 ring-sky-500/20",
    amber: "from-amber-500/10 to-orange-500/5 ring-amber-500/20",
  };
  return (
    <Link
      href={href}
      className={cn(
        "group flex flex-col gap-3 rounded-xl bg-gradient-to-br p-4 ring-1 transition-shadow hover:shadow-md",
        tones[tone],
      )}
    >
      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-background/80 backdrop-blur">
        <Icon className="h-4 w-4 text-primary" />
      </div>
      <div>
        <div className="text-sm font-semibold">{label}</div>
        <div className="mt-0.5 text-xs text-muted-foreground">{blurb}</div>
      </div>
    </Link>
  );
}

function cn(...classes: (string | boolean | undefined)[]) {
  return classes.filter(Boolean).join(" ");
}

function UpgradeGate({ planName }: { planName: string }) {
  return (
    <main className="flex min-h-screen items-center justify-center px-5">
      <div className="max-w-sm text-center">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
          <Lock className="h-6 w-6 text-primary" />
        </div>
        <h1 className="text-xl font-semibold">AI Studio requires an upgrade</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Your current plan (<strong>{planName}</strong>) doesn't include AI content generation.
          Upgrade to unlock scripts, captions, hashtags, campaign copy, and automation.
        </p>
        <Button asChild className="mt-6">
          <Link href="https://live.isunday.me/host/settings">
            View upgrade options
            <ArrowRight className="ml-1.5 h-4 w-4" />
          </Link>
        </Button>
      </div>
    </main>
  );
}
