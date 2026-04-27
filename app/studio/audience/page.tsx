import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AudienceCrmView } from "@/components/studio/audience/crm-view";

/**
 * Audience CRM — Phase 4 surface.
 *
 * SSR: resolves host display name then hands off to the client CRM view
 * which lazy-loads subscriber + broadcast data via client-side fetch.
 */
export const dynamic = "force-dynamic";

export default async function AudiencePage() {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData?.user) redirect("/auth/login");

  const { data: host } = await supabase
    .from("hosts")
    .select("display_name, email")
    .eq("user_id", userData.user.id)
    .maybeSingle();

  const hostName =
    (host as { display_name?: string; email?: string } | null)?.display_name ||
    (host as { display_name?: string; email?: string } | null)?.email ||
    "Host";

  return (
    <main className="mx-auto max-w-5xl px-5 py-10 sm:px-8">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">Audience CRM</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Your subscribers, segments, and email broadcasts — all in one place.
        </p>
      </header>
      <AudienceCrmView hostName={hostName} />
    </main>
  );
}
