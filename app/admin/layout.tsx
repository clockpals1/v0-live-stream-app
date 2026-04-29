import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isNextControlFlowSignal } from "@/lib/next/control-flow";
import { AdminShell } from "@/components/admin/admin-shell";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  try {
    return await renderLayout({ children });
  } catch (err) {
    if (isNextControlFlowSignal(err)) throw err;
    console.error("[admin/layout]", err);
    return (
      <div className="flex min-h-screen items-center justify-center p-6">
        <p className="text-sm text-muted-foreground">Admin portal failed to load.</p>
      </div>
    );
  }
}

async function renderLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  const { data: host } = await supabase
    .from("hosts")
    .select("display_name, email, is_admin")
    .eq("user_id", user.id)
    .single();

  if (!host?.is_admin) redirect("/host/dashboard");

  return (
    <div className="flex min-h-screen flex-col bg-background lg:flex-row">
      <AdminShell
        userName={host.display_name || host.email || "Admin"}
      />
      <div className="flex flex-1 min-w-0 flex-col">{children}</div>
    </div>
  );
}
