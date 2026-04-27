import { redirect } from "next/navigation";
import Link from "next/link";
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

  // Host row — studio is host-only. Auto-create on first visit using
  // the same self-insert path the live dashboard uses (allowed by
  // migration 024's RLS policy: auth.uid() = user_id). We do NOT do a
  // cross-origin redirect to live.isunday.me here: in Next 16 on
  // OpenNext + Cloudflare Workers, redirect() to an absolute external
  // URL inside a server component sometimes leaks the throw without
  // emitting a Location header, surfacing as a 500 in the browser.
  // Auto-create + inline fallback is more robust and means a host who
  // came straight to studio.isunday.me without ever opening the live
  // dashboard still gets a usable session.
  type HostRow = {
    id: string;
    display_name: string | null;
    email: string;
    plan_slug?: string | null;
  };
  let host: HostRow | null = null;

  const { data: existing } = await supabase
    .from("hosts")
    .select("id, display_name, email, plan_slug")
    .eq("user_id", user.id)
    .maybeSingle();
  host = (existing as HostRow | null) ?? null;

  if (!host && user.email) {
    try {
      const { data: created } = await supabase
        .from("hosts")
        .insert({
          user_id: user.id,
          email: user.email,
          display_name:
            (user.user_metadata?.display_name as string) ||
            user.email.split("@")[0],
        })
        .select("id, display_name, email, plan_slug")
        .single();
      if (created) host = created as HostRow;
    } catch (err) {
      console.error("[studio/layout] auto-create host failed:", err);
    }
  }

  if (!host) {
    // Last-resort inline page. Don't throw, don't cross-origin redirect.
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-6">
        <div className="max-w-sm text-center">
          <h1 className="text-lg font-semibold">Studio isn't ready yet</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            We couldn't load your host profile. Open the live dashboard
            once to finish setting up your account, then come back here.
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
