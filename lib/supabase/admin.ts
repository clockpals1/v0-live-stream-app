import { createClient } from "@supabase/supabase-js";

/**
 * Build a Supabase client backed by the service-role key.
 *
 * Bypasses Row-Level Security; MUST be used only in server-only code
 * paths (route handlers, server components, server actions). Never
 * expose the resulting client (or its key) to the browser.
 *
 * ─── Env access strategy ────────────────────────────────────────────
 *
 * On Node (local dev, `next dev`, `next build`) the secret comes from
 * `process.env` populated by `.env*` files.
 *
 * On Cloudflare Workers (production, via OpenNext) the canonical
 * runtime source for bindings is the `env` argument passed to the
 * Worker's `fetch(request, env, ctx)` handler. OpenNext exposes that
 * via `getCloudflareContext().env` and ALSO mirrors values onto
 * `process.env` at request entry. The mirror has been observed to be
 * unreliable for secrets added after the most recent deploy, so we
 * read both sources and use whichever has a value. This single change
 * eliminates an entire class of "env var missing in production but
 * set in dashboard" failures.
 */

interface CfBindings {
  NEXT_PUBLIC_SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  [k: string]: unknown;
}

/**
 * Read a binding from the most authoritative source available, falling
 * back gracefully so the same code works in Node and Workers without a
 * conditional at every call site.
 */
function readBinding(name: keyof CfBindings): string | undefined {
  // 1. process.env: works in Node and on Workers when OpenNext's shim
  //    populated it correctly.
  const fromProc = (process.env as Record<string, string | undefined>)[
    name as string
  ];
  if (fromProc) return fromProc;

  // 2. Workers `env` binding: the canonical runtime source on
  //    Cloudflare. Calling `getCloudflareContext()` outside a request
  //    scope (or in pure-Node mode) throws — we treat that as
  //    "binding not available here" and return undefined.
  try {
    // Lazy `require` so the @opennextjs/cloudflare module is only
    // pulled in inside Workers; pure-Node callers (build, tests) skip
    // this branch entirely.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require("@opennextjs/cloudflare") as {
      getCloudflareContext?: () => { env: CfBindings };
    };
    const ctx = mod.getCloudflareContext?.();
    const value = ctx?.env?.[name];
    return typeof value === "string" ? value : undefined;
  } catch {
    return undefined;
  }
}

export function createAdminClient() {
  const url = readBinding("NEXT_PUBLIC_SUPABASE_URL");
  const key = readBinding("SUPABASE_SERVICE_ROLE_KEY");

  if (!url) {
    throw new Error(
      "createAdminClient: NEXT_PUBLIC_SUPABASE_URL is not set on either " +
        "process.env or the Cloudflare Workers env binding. Add it to " +
        ".env.production AND to the Worker's bindings.",
    );
  }
  if (!key) {
    throw new Error(
      "createAdminClient: SUPABASE_SERVICE_ROLE_KEY is not visible to the " +
        "running Worker. Confirm via /api/admin/diag that the binding is " +
        "actually attached to the latest deployed version. If it shows up " +
        "in `cloudflareEnvKeys` but not `processEnvKeys`, the OpenNext " +
        "shim missed it (still works through this client). If it shows up " +
        "in NEITHER, the secret is not bound to this Worker — re-add it " +
        "in the Cloudflare dashboard under your `v0-live-stream-app` " +
        "Worker → Settings → Variables and Secrets, then redeploy.",
    );
  }

  return createClient(url, key, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

/**
 * Returns the names (not values) of every binding visible to the current
 * runtime, from each env source. Used by the /api/admin/diag endpoint
 * for production troubleshooting. Never returns secret values.
 */
export function listVisibleBindings(): {
  processEnvKeys: string[];
  cloudflareEnvKeys: string[];
  hasServiceRoleKeyInProcessEnv: boolean;
  hasServiceRoleKeyInCloudflareEnv: boolean;
} {
  const processEnvKeys = Object.keys(process.env)
    .filter((k) => !k.startsWith("npm_") && !k.startsWith("__"))
    .sort();

  let cloudflareEnvKeys: string[] = [];
  let hasServiceRoleKeyInCloudflareEnv = false;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require("@opennextjs/cloudflare") as {
      getCloudflareContext?: () => { env: Record<string, unknown> };
    };
    const env = mod.getCloudflareContext?.().env ?? {};
    cloudflareEnvKeys = Object.keys(env).sort();
    hasServiceRoleKeyInCloudflareEnv =
      typeof env.SUPABASE_SERVICE_ROLE_KEY === "string" &&
      (env.SUPABASE_SERVICE_ROLE_KEY as string).length > 0;
  } catch {
    // not in a Workers context
  }

  return {
    processEnvKeys,
    cloudflareEnvKeys,
    hasServiceRoleKeyInProcessEnv:
      typeof process.env.SUPABASE_SERVICE_ROLE_KEY === "string" &&
      process.env.SUPABASE_SERVICE_ROLE_KEY.length > 0,
    hasServiceRoleKeyInCloudflareEnv,
  };
}
