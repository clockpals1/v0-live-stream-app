import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getEffectivePlan } from "@/lib/billing/entitlements";
import { featureEnabled } from "@/lib/billing/plans";
import { isNextControlFlowSignal } from "@/lib/next/control-flow";
import { GeneratorForm } from "@/components/ai/studio/generator-form";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import {
  Sparkles,
  FileText,
  Clock,
  ArrowRight,
  Zap,
  Lock,
  Send,
  TrendingUp,
  Clapperboard,
  Hash,
  ListOrdered,
  Lightbulb,
  Star,
  CircleDollarSign,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";

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
  };

  const { data: recentAssets } = await admin
    .from("ai_generated_assets")
    .select("id, asset_type, title, content, platform, created_at, is_starred")
    .eq("host_id", host.id)
    .is("archived_at", null)
    .order("created_at", { ascending: false })
    .limit(6)
    .returns<AssetRow[]>();

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
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {recentAssets.map((asset) => (
              <AssetCard key={asset.id} asset={asset} />
            ))}
          </div>
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

function AssetCard({ asset }: { asset: { id: string; asset_type: string; title: string | null; content: string; platform: string | null; created_at: string; is_starred: boolean } }) {
  const preview = asset.content.slice(0, 120).replace(/\n/g, " ");
  const ago = formatDistanceToNow(new Date(asset.created_at), { addSuffix: true });

  const typeLabels: Record<string, string> = {
    script:             "Stream Script",
    caption:            "Caption Pack",
    hashtags:           "Hashtag Pack",
    title:              "Title Variants",
    content_ideas:      "Content Ideas",
    campaign_copy:      "Campaign / Ad",
    short_video_script: "Short Video Script",
    summary:            "Summary",
  };

  const typeIcons: Record<string, React.ComponentType<{ className?: string }>> = {
    script:             FileText,
    caption:            FileText,
    hashtags:           Hash,
    title:              ListOrdered,
    content_ideas:      Lightbulb,
    campaign_copy:      TrendingUp,
    short_video_script: Clapperboard,
    summary:            Sparkles,
  };

  const TypeIcon = typeIcons[asset.asset_type] ?? FileText;

  return (
    <Card className="group relative hover:border-primary/40 transition-colors">
      <CardContent className="p-4">
        <div className="mb-2 flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <TypeIcon className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
              {typeLabels[asset.asset_type] ?? asset.asset_type}
            </span>
          </div>
          {asset.platform && (
            <Badge variant="outline" className="h-4 px-1.5 text-[10px] font-normal capitalize">
              {asset.platform}
            </Badge>
          )}
        </div>
        {asset.title && (
          <p className="mb-1 text-sm font-medium leading-snug line-clamp-1">{asset.title}</p>
        )}
        <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">{preview}…</p>
        <div className="mt-2 flex items-center justify-between">
          <p className="text-[11px] text-muted-foreground">{ago}</p>
          {asset.is_starred && <Star className="h-3 w-3 fill-amber-400 text-amber-400" />}
        </div>
      </CardContent>
    </Card>
  );
}

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
