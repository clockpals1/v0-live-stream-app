import { NextRequest, NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * PATCH /api/host/profile
 * Body: { displayName: string }
 *
 * Updates a host's display name. Email is intentionally not editable
 * here — it's tied to the auth identity and changing it would require
 * the verification dance Supabase Auth handles.
 *
 * We use the admin client to bypass any restrictive UPDATE policies
 * on hosts, but we always scope the update by `user_id` from the
 * authenticated session, so callers can only mutate their own row.
 */
export async function PATCH(req: NextRequest) {
  let body: { displayName?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const displayName = body.displayName?.trim();
  if (!displayName || displayName.length < 1 || displayName.length > 80) {
    return NextResponse.json(
      { error: "Display name must be 1–80 characters." },
      { status: 400 },
    );
  }

  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("hosts")
    .update({ display_name: displayName })
    .eq("user_id", user.id)
    .select("id, display_name")
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json(
      { error: "No host profile found for this account." },
      { status: 404 },
    );
  }

  return NextResponse.json({ ok: true, host: data });
}
