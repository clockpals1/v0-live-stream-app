import type { SupabaseClient, User } from "@supabase/supabase-js";

/**
 * Single source of truth for "load this user's host row, creating
 * one if it doesn't exist yet".
 *
 * WHY THIS EXISTS
 * ---------------
 * Previously the live dashboard (@/app/host/dashboard/page.tsx) and
 * the studio layout (@/app/studio/layout.tsx) each had their own
 * variant of this logic. They diverged in subtle ways:
 *
 *   - the live page hard-coded ADMIN_EMAIL = "sunday@isunday.me"
 *     and only flipped is_admin for that exact address;
 *   - the studio layout used the proper `is_admin` column / role
 *     check and fell back gracefully when the row didn't yet exist;
 *   - retry behaviour on race (two tabs inserting at once) only
 *     existed on the live side.
 *
 * Hosts who landed first on studio could end up with one row state,
 * those who landed first on live with another. This helper unifies
 * the path and is used by BOTH surfaces.
 *
 * SECURITY
 * --------
 * `is_admin` is NEVER set here. The caller must use the service-role
 * client + a separate UPDATE if they want to grant admin (the live
 * dashboard does this, gated to a configured bootstrap email). RLS
 * on `hosts` only allows `auth.uid() = user_id` self-inserts (see
 * migration 024), so this works through the user-scoped client too.
 */

export interface HostRow {
  id: string;
  user_id: string;
  email: string;
  display_name: string | null;
  plan_slug?: string | null;
  is_admin?: boolean | null;
  role?: string | null;
  // Allow extra columns through without breaking the type.
  [key: string]: unknown;
}

/**
 * Look up the host row for `user`. If absent, attempt a self-insert
 * with sensible defaults (display_name from user_metadata or email
 * local-part). On a race with another tab the unique-constraint
 * violation triggers a single re-fetch.
 *
 * Returns null only if both lookup and insert fail — callers should
 * treat that as "host not provisioned" and surface a friendly fallback
 * UI rather than crashing.
 */
export async function ensureHostRow(
  supabase: SupabaseClient,
  user: Pick<User, "id" | "email" | "user_metadata">,
): Promise<HostRow | null> {
  const { data: existing } = await supabase
    .from("hosts")
    .select("*")
    .eq("user_id", user.id)
    .maybeSingle();
  if (existing) return existing as HostRow;

  if (!user.email) return null;

  const display =
    (user.user_metadata?.display_name as string | undefined)?.trim() ||
    user.email.split("@")[0];

  try {
    const { data: created, error } = await supabase
      .from("hosts")
      .insert({
        user_id: user.id,
        email: user.email,
        display_name: display,
      })
      .select("*")
      .single();
    if (!error && created) return created as HostRow;
  } catch (err) {
    console.warn("[host/bootstrap] insert failed (will re-fetch):", err);
  }

  // Race fallback — another tab/process likely inserted it.
  const { data: retry } = await supabase
    .from("hosts")
    .select("*")
    .eq("user_id", user.id)
    .maybeSingle();
  return (retry as HostRow | null) ?? null;
}

/**
 * Bootstrap-email helper: the single configured email that gets
 * `is_admin=true` flipped on its host row when first provisioned.
 * Reads from env so the value isn't hard-coded into the source.
 *
 * Returns null if the env var is unset (no automatic admin bootstrap;
 * admins must be granted via the admin client manually).
 */
export function getBootstrapAdminEmail(): string | null {
  const v =
    process.env.HOST_BOOTSTRAP_ADMIN_EMAIL ??
    process.env.NEXT_PUBLIC_BOOTSTRAP_ADMIN_EMAIL ??
    null;
  return v ? v.trim().toLowerCase() : null;
}
