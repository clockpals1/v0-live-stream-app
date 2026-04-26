/**
 * Centralised admin-auth check for /api/admin/* routes.
 *
 * Returns { user } on success, or { error, status } on failure. Using
 * one helper means every admin route handles authn/authz the same way
 * and we don't drift across files.
 */

import { createClient as createServerClient } from "@/lib/supabase/server";

export interface RequireAdminOk {
  ok: true;
  userId: string;
  email: string;
}

export interface RequireAdminErr {
  ok: false;
  status: 401 | 403 | 500;
  error: string;
}

interface HostRow {
  role?: string | null;
  is_admin?: boolean | null;
}

export async function requireAdmin(): Promise<RequireAdminOk | RequireAdminErr> {
  let supabase;
  try {
    supabase = await createServerClient();
  } catch (e) {
    return {
      ok: false,
      status: 500,
      error:
        e instanceof Error ? e.message : "Failed to init server client",
    };
  }

  const {
    data: { user },
    error: userErr,
  } = await supabase.auth.getUser();
  if (userErr) {
    return { ok: false, status: 401, error: userErr.message };
  }
  if (!user) {
    return { ok: false, status: 401, error: "Not signed in." };
  }

  const { data: host, error: hostErr } = await supabase
    .from("hosts")
    .select("*")
    .eq("user_id", user.id)
    .maybeSingle();
  if (hostErr) {
    return {
      ok: false,
      status: 500,
      error: `Host lookup failed: ${hostErr.message}`,
    };
  }
  if (!host) {
    return { ok: false, status: 403, error: "No host profile found." };
  }
  const row = host as HostRow;
  const isAdmin = row.role === "admin" || row.is_admin === true;
  if (!isAdmin) {
    return { ok: false, status: 403, error: "Admin role required." };
  }
  return { ok: true, userId: user.id, email: user.email ?? "" };
}
