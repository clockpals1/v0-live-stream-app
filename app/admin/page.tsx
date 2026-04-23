import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { AdminPanel } from "@/components/admin/admin-panel";
import { Button } from "@/components/ui/button";
import { Radio, ArrowLeft, ShieldCheck } from "lucide-react";

export default async function AdminPage() {
  const supabase = await createClient();

  let user: Awaited<ReturnType<typeof supabase.auth.getUser>>["data"]["user"] = null;
  try {
    const { data } = await supabase.auth.getUser();
    user = data.user;
  } catch {
    redirect("/auth/login");
  }

  if (!user) redirect("/auth/login");

  // Verify the user is an admin host
  const { data: host } = await supabase
    .from("hosts")
    .select("*")
    .eq("user_id", user.id)
    .eq("is_admin", true)
    .single();

  if (!host) redirect("/host/dashboard");

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
              <Radio className="w-4 h-4 text-primary-foreground" />
            </div>
            <span className="font-bold text-foreground">Isunday Stream Live</span>
          </Link>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5 text-sm text-primary font-medium">
              <ShieldCheck className="w-4 h-4" />
              Admin
            </div>
            <Button variant="ghost" size="sm" asChild>
              <Link href="/host/dashboard">
                <ArrowLeft className="w-4 h-4 mr-1.5" />
                Dashboard
              </Link>
            </Button>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8 max-w-4xl">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <ShieldCheck className="w-6 h-6 text-primary" />
            Host Management
          </h1>
          <p className="text-muted-foreground mt-1">
            Create and manage host accounts that can access the streaming dashboard.
          </p>
        </div>

        <AdminPanel currentUserId={user.id} />
      </main>
    </div>
  );
}
