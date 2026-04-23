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

  const { email, displayName, password } = await req.json();

  if (!email || !displayName || !password) {
    return NextResponse.json(
      { error: "email, displayName, and password are required" },
      { status: 400 }
    );
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
