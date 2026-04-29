import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AdminPanel } from "@/components/admin/admin-panel";
import { PageHeader } from "@/components/shell/page-header";

export default async function AdminPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  return (
    <div className="flex flex-1 flex-col min-h-0">
      <PageHeader
        title="Hosts & Users"
        description="Manage platform hosts, roles, and access permissions."
        breadcrumbs={[{ label: "Admin Center", href: "/admin" }, { label: "Hosts & Users" }]}
      />
      <main className="flex-1 overflow-auto p-6">
        <AdminPanel currentUserId={user.id} />
      </main>
    </div>
  );
}
