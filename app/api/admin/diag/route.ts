import { NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { listVisibleBindings } from "@/lib/supabase/admin";

/**
 * /api/admin/diag — admin-only environment diagnostic.
 *
 * Returns the *names* (never values) of every binding visible to the
 * running Worker, from each runtime env source. Use this to confirm
 * that secrets added in the Cloudflare dashboard are actually reaching
 * the deployed Worker.
 *
 * Authorisation: must be authenticated AND have role=admin or
 * is_admin=true on the `hosts` row, same as every other /api/admin/*
 * route. Returning binding NAMES (not values) is still safe even if
 * we accidentally expose this — names are not secret on their own.
 */

interface HostRow {
  role?: string | null;
  is_admin?: boolean | null;
}

async function isAdmin(): Promise<boolean> {
  try {
    const supabase = await createServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return false;
    const { data: host } = await supabase
      .from("hosts")
      .select("*")
      .eq("user_id", user.id)
      .maybeSingle();
    if (!host) return false;
    const row = host as HostRow;
    return row.role === "admin" || row.is_admin === true;
  } catch (e) {
    console.error("[admin/diag] isAdmin check failed:", e);
    return false;
  }
}

export async function GET() {
  if (!(await isAdmin())) {
    return NextResponse.json(
      { error: "Unauthorized — admin role required." },
      { status: 403 },
    );
  }

  const bindings = listVisibleBindings();

  // Build a few specific assertions so an admin can read the result
  // without parsing the full key list.
  const checks = {
    SUPABASE_SERVICE_ROLE_KEY_in_processEnv:
      bindings.hasServiceRoleKeyInProcessEnv,
    SUPABASE_SERVICE_ROLE_KEY_in_cloudflareEnv:
      bindings.hasServiceRoleKeyInCloudflareEnv,
    NEXT_PUBLIC_SUPABASE_URL_in_processEnv:
      typeof process.env.NEXT_PUBLIC_SUPABASE_URL === "string" &&
      process.env.NEXT_PUBLIC_SUPABASE_URL.length > 0,
    SMTP_HOST_present: hasAnywhere(bindings, "SMTP_HOST"),
    SMTP_USER_present: hasAnywhere(bindings, "SMTP_USER"),
    SMTP_PASS_present: hasAnywhere(bindings, "SMTP_PASS"),
    APP_URL_present: hasAnywhere(bindings, "APP_URL"),
  };

  return NextResponse.json({
    runtime:
      typeof globalThis.navigator?.userAgent === "string" &&
      globalThis.navigator.userAgent.includes("Cloudflare")
        ? "cloudflare-workers"
        : "node",
    timestamp: new Date().toISOString(),
    checks,
    processEnvKeys: bindings.processEnvKeys,
    cloudflareEnvKeys: bindings.cloudflareEnvKeys,
  });
}

function hasAnywhere(
  bindings: ReturnType<typeof listVisibleBindings>,
  name: string,
): boolean {
  return (
    bindings.processEnvKeys.includes(name) ||
    bindings.cloudflareEnvKeys.includes(name)
  );
}
