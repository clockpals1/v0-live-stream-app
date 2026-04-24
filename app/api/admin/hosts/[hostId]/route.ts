import { NextRequest, NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isRole } from "@/lib/rbac";

async function getAdminUser() {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: host } = await supabase
    .from("hosts")
    .select("id, role, is_admin")
    .eq("user_id", user.id)
    .single();
  if (!host) return null;
  // admin === role='admin' (is_admin is kept in sync by DB trigger)
  const isAdmin = (host as { role?: string; is_admin?: boolean }).role === "admin"
    || (host as { is_admin?: boolean }).is_admin === true;
  return isAdmin ? user : null;
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ hostId: string }> }
) {
  const admin = await getAdminUser();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 403 });

  const { hostId } = await params;
  const body = await req.json();
  const { displayName, role } = body as { displayName?: string; role?: string };

  const adminClient = createAdminClient();

  // Build the update payload; only include fields that were actually sent.
  const update: Record<string, unknown> = {};
  if (typeof displayName === "string") update.display_name = displayName;

  if (typeof role !== "undefined") {
    if (!isRole(role)) {
      return NextResponse.json(
        { error: "Invalid role. Must be one of: admin, host, cohost, superuser." },
        { status: 400 }
      );
    }

    // Load target to run self-demote / last-admin guards
    const { data: target, error: tErr } = await adminClient
      .from("hosts")
      .select("id, user_id, role, is_admin")
      .eq("id", hostId)
      .single();
    if (tErr || !target) {
      return NextResponse.json({ error: "Host not found" }, { status: 404 });
    }

    const targetRole = (target as { role?: string; is_admin?: boolean }).role
      ?? ((target as { is_admin?: boolean }).is_admin ? "admin" : "host");

    // Block self-demotion from admin
    if (
      (target as { user_id: string }).user_id === admin.id &&
      targetRole === "admin" &&
      role !== "admin"
    ) {
      return NextResponse.json(
        { error: "You cannot demote your own admin account." },
        { status: 400 }
      );
    }

    // Block demoting the last admin
    if (targetRole === "admin" && role !== "admin") {
      const { count } = await adminClient
        .from("hosts")
        .select("id", { count: "exact", head: true })
        .eq("role", "admin");
      if ((count ?? 0) <= 1) {
        return NextResponse.json(
          { error: "Cannot demote the last remaining admin." },
          { status: 400 }
        );
      }
    }

    update.role = role;
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "No updatable fields provided." }, { status: 400 });
  }

  const { data, error } = await adminClient
    .from("hosts")
    .update(update)
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
