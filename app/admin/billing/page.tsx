import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getBillingConfig, redactConfig } from "@/lib/billing/config";
import { Button } from "@/components/ui/button";
import { Radio, ArrowLeft, CreditCard, ShieldCheck } from "lucide-react";
import { ModeBanner } from "@/components/admin/billing/mode-banner";
import { StripeConfigPanel } from "@/components/admin/billing/stripe-config";
import { PlansEditor } from "@/components/admin/billing/plans-editor";

/**
 * /admin/billing — admin Billing dashboard.
 *
 * Server component: gates on admin role, then loads the redacted
 * billing_config server-side so the StripeConfigPanel hydrates without
 * a separate client request. PlansEditor fetches plans client-side
 * (it has its own create/edit/delete state to manage).
 */

export default async function AdminBillingPage() {
  const supabase = await createClient();

  let user: Awaited<ReturnType<typeof supabase.auth.getUser>>["data"]["user"] = null;
  try {
    const { data } = await supabase.auth.getUser();
    user = data.user;
  } catch {
    redirect("/auth/login");
  }
  if (!user) redirect("/auth/login");

  const { data: host } = await supabase
    .from("hosts")
    .select("*")
    .eq("user_id", user.id)
    .single();
  const isAdmin =
    !!host && (host.role === "admin" || host.is_admin === true);
  if (!isAdmin) redirect("/host/dashboard");

  // Server-side load of redacted config. If billing_config row is
  // missing for some reason (migration not run), fall through with a
  // safe default so the page can still render with an empty state.
  let initialConfig;
  try {
    const admin = createAdminClient();
    const cfg = await getBillingConfig(admin);
    initialConfig = redactConfig(cfg);
  } catch (e) {
    initialConfig = null;
    console.error("[admin/billing] failed to load billing_config:", e);
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border">
        <div className="container mx-auto flex items-center justify-between px-4 py-4">
          <Link href="/" className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary">
              <Radio className="h-4 w-4 text-primary-foreground" />
            </div>
            <span className="font-bold text-foreground">Isunday Stream Live</span>
          </Link>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5 text-sm font-medium text-primary">
              <ShieldCheck className="h-4 w-4" />
              Admin
            </div>
            <Button variant="ghost" size="sm" asChild>
              <Link href="/admin">
                <ArrowLeft className="mr-1.5 h-4 w-4" />
                User management
              </Link>
            </Button>
          </div>
        </div>
      </header>

      <main className="container mx-auto max-w-5xl space-y-6 px-4 py-8">
        <div>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Link href="/admin" className="hover:text-foreground">
              Admin
            </Link>
            <span>/</span>
            <span className="text-foreground">Billing</span>
          </div>
          <h1 className="mt-2 flex items-center gap-2 text-2xl font-semibold">
            <CreditCard className="h-5 w-5" />
            Billing
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Manage subscription plans, Stripe credentials, and the active
            payment environment.
          </p>
        </div>

        {initialConfig ? (
          <ModeBanner mode={initialConfig.stripe_mode} />
        ) : null}

        <PlansEditor />

        {initialConfig ? (
          <StripeConfigPanel initial={initialConfig} />
        ) : (
          <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
            Billing configuration row is missing from the database. Apply
            migration <code>019_billing_plans.sql</code> in the Supabase SQL
            editor, then refresh this page.
          </div>
        )}
      </main>
    </div>
  );
}
