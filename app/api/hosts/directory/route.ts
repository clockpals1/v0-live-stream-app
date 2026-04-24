import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * GET /api/hosts/directory
 *
 * Returns a minimal directory of platform users (id, display_name, email, role)
 * that is safe to expose to any authenticated host. This powers the operator
 * assignment dialog when it is opened by a non-admin stream owner — admins get
 * the richer list via /api/admin/hosts, non-admins fall back here.
 *
 * Privacy notes:
 *   - Only the four fields above are returned — no created_at, no user_id, no
 *     is_admin, nothing that could be mis-used.
 *   - Admin users are filtered out: assigning an admin as an operator is
 *     redundant (admins already bypass per-stream access) and cluttering the
 *     dropdown with admins confuses hosts.
 *   - Super_user accounts with no assignments yet ARE included — they are
 *     exactly the users a host would want to assign.
 *
 * Access control: any authenticated host may call this endpoint. The dialog
 * is itself gated to admins + stream owners via the operator-assignment API.
 */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // Require that the caller is a registered host (has a row in public.hosts).
  const { data: me } = await supabase
    .from("hosts")
    .select("id")
    .eq("user_id", user.id)
    .single();

  if (!me) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { data, error } = await supabase
    .from("hosts")
    .select("id, display_name, email, role")
    .neq("role", "admin")
    .order("display_name", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ hosts: data ?? [] });
}
