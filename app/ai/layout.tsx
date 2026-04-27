import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getEffectivePlan } from "@/lib/billing/entitlements";
import { featureEnabled } from "@/lib/billing/plans";
import { AI_NAV } from "@/lib/ai/nav";
import { AiSidebar, type AiSidebarItem } from "@/components/ai/sidebar";
import { ensureHostRow } from "@/lib/host/bootstrap";
import { isNextControlFlowSignal } from "@/lib/next/control-flow";

/**
 * AI Automation Hub layout — auth + plan gate + sidebar shell.
 *
 * Follows the exact same three-step pattern as app/studio/layout.tsx:
 *   1. Require authenticated user → redirect to /auth/login if missing.
 *   2. Load host row + effective plan (admin > grant > stripe > free).
 *   3. Annotate AI nav items with gated state → render sidebar.
 *
 * Plan gating here is cosmetic — sidebar shows locked state.
 * Each page enforces its own gate (returns an upgrade prompt if not entitled).
 */
export default async function AiLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  try {
    return await renderAiLayout({ children });
  } catch (err) {
    if (isNextControlFlowSignal(err)) throw err;
    const e = err as Error;
    console.error(
      "[ai/layout] uncaught render error:",
      JSON.stringify({ name: e?.name, message: e?.message }),
    );
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-6">
        <div className="max-w-md text-center">
          <h1 className="text-lg font-semibold">AI Hub is having trouble</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {e?.message || "Unknown error"}
          </p>
          <Link
            href="https://live.isunday.me/host/dashboard"
            className="mt-4 inline-block rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground"
          >
            Back to live dashboard
          </Link>
        </div>
      </div>
    );
  }
}

async function renderAiLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();

  const { data: userData, error: authErr } = await supabase.auth.getUser();
  if (authErr) console.error("[ai/layout] auth.getUser error:", authErr);

  if (!userData?.user) redirect("/auth/login");

  const host = await ensureHostRow(supabase, userData.user);
  if (!host) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-6">
        <div className="max-w-sm text-center">
          <h1 className="text-lg font-semibold">AI Hub isn't ready yet</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Open the live dashboard once to finish setting up your account,
            then come back here.
          </p>
          <Link
            href="https://live.isunday.me/host/dashboard"
            className="mt-4 inline-block rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground"
          >
            Go to live dashboard
          </Link>
        </div>
      </div>
    );
  }

  const effective = await getEffectivePlan(supabase, userData.user.id);
  const plan = effective.plan;
  const planLabel = effective.isPlatformAdmin ? "Admin" : (plan?.name ?? "Free");

  const items: ReadonlyArray<AiSidebarItem> = AI_NAV.map((item) => ({
    ...item,
    gated: !!item.gateKey && !featureEnabled(plan, item.gateKey),
  }));

  return (
    <div className="flex min-h-screen bg-background">
      <AiSidebar
        items={items}
        hostName={host.display_name || host.email}
        planLabel={planLabel}
      />
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  );
}
