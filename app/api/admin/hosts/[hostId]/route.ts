import { NextRequest, NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

async function getAdminUser() {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: host } = await supabase
    .from("hosts")
    .select("id, is_admin")
    .eq("user_id", user.id)
    .eq("is_admin", true)
    .single();
  return host ? user : null;
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ hostId: string }> }
) {
  const admin = await getAdminUser();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 403 });

  const { hostId } = await params;
  const { displayName } = await req.json();

  const adminClient = createAdminClient();
  const { data, error } = await adminClient
    .from("hosts")
    .update({ display_name: displayName })
    .eq("id", hostId)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ host: data });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ hostId: string }> }
) {
  const admin = await getAdminUser();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 403 });

  const { hostId } = await params;
  const adminClient = createAdminClient();

  // Fetch the host record to get user_id + check is_admin
  const { data: host, error: fetchErr } = await adminClient
    .from("hosts")
    .select("*")
    .eq("id", hostId)
    .single();

  if (fetchErr || !host) {
    return NextResponse.json({ error: "Host not found" }, { status: 404 });
  }

  // Prevent deleting the admin's own account
  if (host.user_id === admin.id) {
    return NextResponse.json(
      { error: "You cannot remove your own admin account" },
      { status: 400 }
    );
  }

  // Delete the hosts record (streams remain, foreign key SET NULL)
  const { error: deleteErr } = await adminClient
    .from("hosts")
    .delete()
    .eq("id", hostId);

  if (deleteErr) return NextResponse.json({ error: deleteErr.message }, { status: 500 });

  // Also delete the Supabase auth user
  if (host.user_id) {
    await adminClient.auth.admin.deleteUser(host.user_id);
  }

  return NextResponse.json({ success: true });
}
