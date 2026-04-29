import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { PageHeader } from "@/components/shell/page-header";
import { Users, CreditCard, Sparkles, ChevronRight } from "lucide-react";

export default async function AdminPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  let hostCount: number | null = null;
  try {
    const db = createAdminClient();
    const { count } = await db.from("hosts").select("id", { count: "exact", head: true });
    hostCount = count;
  } catch {
    hostCount = null;
  }

  const sections = [
    {
      href: "/admin/hosts",
      icon: Users,
      label: "Hosts & Users",
      description: "Manage platform hosts, roles, and access permissions.",
      stat: hostCount !== null ? `${hostCount} registered` : null,
      color: "from-blue-600 to-cyan-500",
    },
    {
      href: "/admin/billing",
      icon: CreditCard,
      label: "Plans & Billing",
      description: "Configure subscription plans, Stripe integration, and feature grants.",
      stat: null,
      color: "from-emerald-600 to-teal-500",
    },
    {
      href: "/admin/ai",
      icon: Sparkles,
      label: "AI Configuration",
      description: "Set default AI providers, model routing, and quota limits.",
      stat: null,
      color: "from-violet-600 to-fuchsia-500",
    },
  ] as const;

  return (
    <div className="flex flex-1 flex-col min-h-0">
      <PageHeader
        title="Admin Center"
        description="Platform management and configuration."
        breadcrumbs={[{ label: "Admin Center" }]}
      />
      <main className="flex-1 overflow-auto p-6">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 max-w-4xl">
          {sections.map(({ href, icon: Icon, label, description, stat, color }) => (
            <Link
              key={href}
              href={href}
              className="group flex flex-col gap-3 rounded-xl border border-border bg-card p-5 transition-all hover:border-primary/40 hover:shadow-sm"
            >
              <div className="flex items-start justify-between gap-2">
                <div className={`flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br text-white shadow-sm ${color}`}>
                  <Icon className="h-5 w-5" />
                </div>
                <ChevronRight className="h-4 w-4 text-muted-foreground/40 mt-1 group-hover:text-primary transition-colors" />
              </div>
              <div>
                <p className="font-semibold text-sm">{label}</p>
                <p className="mt-0.5 text-[12px] text-muted-foreground leading-snug">{description}</p>
                {stat && (
                  <p className="mt-2 text-[11px] font-medium text-primary">{stat}</p>
                )}
              </div>
            </Link>
          ))}
        </div>
      </main>
    </div>
  );
}
