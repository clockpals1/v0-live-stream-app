import { NextRequest, NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isRole, type Role } from "@/lib/rbac";

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
  const isAdmin = (host as { role?: string; is_admin?: boolean }).role === "admin"
    || (host as { is_admin?: boolean }).is_admin === true;
  return isAdmin ? user : null;
}

export async function GET() {
  const admin = await getAdminUser();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 403 });

  const adminClient = createAdminClient();
  const { data, error } = await adminClient
    .from("hosts")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ hosts: data });
}

export async function POST(req: NextRequest) {
  const admin = await getAdminUser();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 403 });

  const { email, displayName, password, role } = await req.json();

  if (!email || !displayName || !password) {
    return NextResponse.json(
      { error: "email, displayName, and password are required" },
      { status: 400 }
    );
  }

  // Default to 'host' when the caller does not specify a role.
  // Only 'host', 'cohost', and 'superuser' can be created through this
  // endpoint — to make someone an admin, use the PATCH endpoint after
  // creation so the self-demote / last-admin guards run consistently.
  let newRole: Role = "host";
  if (typeof role !== "undefined") {
    if (!isRole(role) || role === "admin") {
      return NextResponse.json(
        {
          error:
            "role must be 'host', 'cohost', or 'superuser' when creating a user.",
        },
        { status: 400 }
      );
    }
    newRole = role;
  }

  const adminClient = createAdminClient();

  // Check if a host with this email already exists
  const { data: existing } = await adminClient
    .from("hosts")
    .select("id")
    .eq("email", email.toLowerCase().trim())
    .maybeSingle();

  if (existing) {
    return NextResponse.json(
      { error: "A host with this email already exists" },
      { status: 409 }
    );
  }

  // Create the Supabase auth user (email_confirm: true skips verification email)
  const { data: authData, error: authError } = await adminClient.auth.admin.createUser({
    email: email.toLowerCase().trim(),
    password,
    email_confirm: true,
    user_metadata: { display_name: displayName },
  });

  if (authError) {
    return NextResponse.json({ error: authError.message }, { status: 500 });
  }

  // Create the hosts record linked to the new auth user
  const { data: newHost, error: hostError } = await adminClient
    .from("hosts")
    .insert({
      user_id: authData.user.id,
      email: email.toLowerCase().trim(),
      display_name: displayName,
      role: newRole,
    })
    .select()
    .single();

  if (hostError) {
    // Roll back: delete the auth user we just created
    await adminClient.auth.admin.deleteUser(authData.user.id);
    return NextResponse.json({ error: hostError.message }, { status: 500 });
  }

  return NextResponse.json({ host: newHost }, { status: 201 });
}
