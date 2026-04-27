import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getEffectivePlan } from "@/lib/billing/entitlements";
import { featureEnabled } from "@/lib/billing/plans";
import { STUDIO_NAV } from "@/lib/studio/nav";
import { StudioSidebar, type StudioSidebarItem } from "@/components/studio/sidebar";

/**
 * Studio layout — auth + plan gate + sidebar shell.
 *
 * Every /studio/* page renders inside this layout. We do three things:
 *
 *   1. Require an authenticated user. Anyone unauth lands on /auth/login.
 *   2. Look up the host row + their effective plan. The studio is host-
 *      only territory; viewers and unprovisioned users are bounced to
 *      live.isunday.me.
 *   3. Annotate the sidebar nav with per-item plan gating so the UI can
 *      render locked states without each page reimplementing the check.
 *
 * Plan gating here is COSMETIC — it controls what the sidebar shows.
 * Page-level enforcement (returning a 403, hiding actions) is the
 * responsibility of each page. Two layers because a clever user
 * navigating directly to /studio/audience shouldn't get a usable page
 * just because the sidebar would have hidden the link.
 */
export default async function StudioLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();

  // Auth
  const { data: userData } = await supabase.auth.getUser();
  const user = userData?.user;
  if (!user) {
    redirect("/auth/login");
  }

  // Host row — studio is host-only. Same auto-create story would be
  // possible here as on /host/dashboard but we deliberately don't:
  // a user without a hosts row probably hasn't completed signup
  // properly, and the live dashboard handles that flow.
  const { data: host } = await supabase
    .from("hosts")
    .select("id, display_name, email, plan_slug")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!host) {
    // Bounce them to the live dashboard which handles host bootstrapping.
    redirect("https://live.isunday.me/host/dashboard");
  }

  // Effective plan (admin > grant > stripe > default).
  const effective = await getEffectivePlan(supabase, user.id);
  const plan = effective.plan;
  const planLabel = effective.isPlatformAdmin
    ? "Admin"
    : plan?.name ?? "Free";

  // Annotate nav items with gated state. Admins and grant holders see
  // everything unlocked because their synthetic plan flips every flag.
  const items: ReadonlyArray<StudioSidebarItem> = STUDIO_NAV.map((item) => ({
    ...item,
    gated: !!item.gateKey && !featureEnabled(plan, item.gateKey),
  }));

  return (
    <div className="flex min-h-screen bg-background">
      <StudioSidebar
        items={items}
        hostName={host.display_name || host.email}
        planLabel={planLabel}
      />
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  );
}
