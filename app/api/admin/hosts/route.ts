import { NextRequest, NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isRole, type Role } from "@/lib/rbac";

/**
 * /api/admin/hosts — list and create users (admin-only).
 *
 * HARDENING NOTES
 * ---------------
 * - Every code path is wrapped in try/catch and logs to console with a
 *   `[admin/hosts]` prefix so failures show up clearly in Cloudflare /
 *   server logs. The thrown error message is also returned in the JSON
 *   response so the admin panel can render it instead of an opaque 500.
 *
 * - The auth-admin check selects "*" instead of "id, role, is_admin" so
 *   it is resilient to a database that has only one of those columns
 *   (e.g. an older deployment where the `role` migration has not yet run).
 *
 * - Missing env vars (SUPABASE_SERVICE_ROLE_KEY in particular) throw a
 *   clear, descriptive error from createAdminClient() — never a silent
 *   crash inside the supabase-js SDK.
 */

interface HostRow {
  id: string;
  user_id: string;
  email: string;
  display_name: string | null;
  role?: string | null;
  is_admin?: boolean | null;
  created_at: string;
}

async function getAdminUser() {
  const supabase = await createServerClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();
  if (userError) {
    console.error("[admin/hosts] auth.getUser failed:", userError.message);
    return null;
  }
  if (!user) return null;

  const { data: host, error: hostErr } = await supabase
    .from("hosts")
    .select("*")
    .eq("user_id", user.id)
    .maybeSingle();

  if (hostErr) {
    console.error(
      "[admin/hosts] failed to look up caller in hosts table:",
      hostErr.message,
    );
    return null;
  }
  if (!host) return null;

  const row = host as Partial<HostRow>;
  const isAdmin = row.role === "admin" || row.is_admin === true;
  return isAdmin ? user : null;
}

function jsonError(status: number, message: string, details?: unknown) {
  if (details) console.error(`[admin/hosts] ${status}: ${message}`, details);
  else console.error(`[admin/hosts] ${status}: ${message}`);
  return NextResponse.json({ error: message }, { status });
}

export async function GET() {
  try {
    const admin = await getAdminUser();
    if (!admin) {
      return jsonError(403, "Unauthorized — admin role required.");
    }

    let adminClient;
    try {
      adminClient = createAdminClient();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to init admin client";
      return jsonError(500, msg);
    }

    const { data, error } = await adminClient
      .from("hosts")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      return jsonError(
        500,
        `Database query failed: ${error.message}`,
        { code: error.code, hint: error.hint, details: error.details },
      );
    }

    return NextResponse.json({ hosts: data ?? [] });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unexpected server error";
    const stack = e instanceof Error ? e.stack : undefined;
    return jsonError(500, msg, stack);
  }
}

export async function POST(req: NextRequest) {
  try {
    const admin = await getAdminUser();
    if (!admin) {
      return jsonError(403, "Unauthorized — admin role required.");
    }

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return jsonError(400, "Request body must be valid JSON.");
    }

    const { email, displayName, password, role } = body as {
      email?: string;
      displayName?: string;
      password?: string;
      role?: string;
    };

    if (!email || !displayName || !password) {
      return jsonError(
        400,
        "email, displayName, and password are required.",
      );
    }

    let newRole: Role = "host";
    if (typeof role !== "undefined") {
      if (!isRole(role) || role === "admin") {
        return jsonError(
          400,
          "role must be 'host', 'cohost', or 'super_user' when creating a user.",
        );
      }
      newRole = role;
    }

    let adminClient;
    try {
      adminClient = createAdminClient();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to init admin client";
      return jsonError(500, msg);
    }

    const cleanEmail = email.toLowerCase().trim();

    const { data: existing, error: existingErr } = await adminClient
      .from("hosts")
      .select("id")
      .eq("email", cleanEmail)
      .maybeSingle();

    if (existingErr) {
      return jsonError(
        500,
        `Failed to check for existing user: ${existingErr.message}`,
      );
    }

    if (existing) {
      return jsonError(409, "A host with this email already exists.");
    }

    const { data: authData, error: authError } =
      await adminClient.auth.admin.createUser({
        email: cleanEmail,
        password,
        email_confirm: true,
        user_metadata: { display_name: displayName },
      });

    if (authError || !authData?.user) {
      return jsonError(
        500,
        authError?.message || "Failed to create auth user.",
      );
    }

    const { data: newHost, error: hostError } = await adminClient
      .from("hosts")
      .insert({
        user_id: authData.user.id,
        email: cleanEmail,
        display_name: displayName,
        role: newRole,
      })
      .select()
      .single();

    if (hostError) {
      // Roll back the auth user we just created so the admin can retry cleanly.
      await adminClient.auth.admin.deleteUser(authData.user.id).catch((e) => {
        console.error(
          "[admin/hosts] rollback deleteUser also failed:",
          e instanceof Error ? e.message : String(e),
        );
      });
      return jsonError(
        500,
        `Failed to create hosts row: ${hostError.message}`,
        { code: hostError.code, hint: hostError.hint },
      );
    }

    return NextResponse.json({ host: newHost }, { status: 201 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unexpected server error";
    const stack = e instanceof Error ? e.stack : undefined;
    return jsonError(500, msg, stack);
  }
}
