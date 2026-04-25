import { createClient } from "@supabase/supabase-js";

/**
 * Build a Supabase client backed by the service-role key. This client
 * BYPASSES Row-Level Security and must NEVER be sent to a browser. Only
 * use it in server-only code paths (route handlers, server components,
 * server actions).
 *
 * Throws a clear, actionable error if either required env var is missing
 * so a misconfigured deployment fails loudly instead of silently 500ing
 * with an opaque "supabaseKey is required" stack trace from the SDK.
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url) {
    throw new Error(
      "createAdminClient: NEXT_PUBLIC_SUPABASE_URL is not set. " +
        "Add it to .env.production and to the deployment environment.",
    );
  }
  if (!key) {
    throw new Error(
      "createAdminClient: SUPABASE_SERVICE_ROLE_KEY is not set. " +
        "Add it as an encrypted environment variable in the Cloudflare Pages " +
        "dashboard (Production environment) and redeploy. This key is required " +
        "for any /api/admin/* route handler — without it, those routes will 500.",
    );
  }

  return createClient(url, key, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
