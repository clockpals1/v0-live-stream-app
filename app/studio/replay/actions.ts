"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getEffectivePlan } from "@/lib/billing/entitlements";
import { featureEnabled } from "@/lib/billing/plans";
import { defaultSlugFromTitle } from "@/lib/studio/replay/queries";

/**
 * Server actions for the Replay Library.
 *
 * All actions:
 *   - require an authenticated user
 *   - look up that user's host row (RLS will fail-closed on every other
 *     write, but doing it explicitly here lets us return clean error
 *     messages to the UI)
 *   - check the `replay_publishing` plan feature
 *   - call revalidatePath('/studio/replay') so the list rerenders with
 *     the new state without the client having to manage cache
 *
 * Errors are returned as a structured `{ ok: false, message }` rather
 * than thrown — this keeps the UI's optimistic-update path simple.
 */

export type ActionResult =
  | { ok: true }
  | { ok: false; message: string };

type HostCtx =
  | { error: string }
  | {
      supabase: Awaited<ReturnType<typeof createClient>>;
      hostId: string;
      userId: string;
    };

async function requireHost(): Promise<HostCtx> {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  const user = userData?.user;
  if (!user) return { error: "Not signed in." };

  const { data: host } = await supabase
    .from("hosts")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!host) return { error: "No host profile found." };

  const effective = await getEffectivePlan(supabase, user.id);
  if (!featureEnabled(effective.plan, "replay_publishing")) {
    return { error: "Your plan doesn't include replay publishing." };
  }

  return { supabase, hostId: host.id, userId: user.id };
}

/**
 * Publish or update a replay. If a publication already exists for this
 * archive we UPDATE it; otherwise we INSERT a fresh row with sensible
 * defaults derived from the source stream.
 */
export async function publishReplay(input: {
  archiveId: string;
  title?: string;
  description?: string;
  thumbnailUrl?: string;
  slug?: string;
  isFeatured?: boolean;
}): Promise<ActionResult> {
  const ctx = await requireHost();
  if ("error" in ctx) return { ok: false, message: ctx.error };
  const { supabase, hostId } = ctx;

  // Sanity-check the archive belongs to this host before touching it.
  const { data: archive } = await supabase
    .from("stream_archives")
    .select("id, host_id, streams(title)")
    .eq("id", input.archiveId)
    .maybeSingle();
  if (!archive || (archive as { host_id: string }).host_id !== hostId) {
    return { ok: false, message: "Archive not found." };
  }

  const inferredTitle =
    input.title?.trim() ||
    (archive as { streams?: { title?: string } | null }).streams?.title ||
    "Untitled replay";
  const slug = (input.slug?.trim() || defaultSlugFromTitle(inferredTitle))
    .toLowerCase();

  // Upsert by archive_id (UNIQUE constraint).
  const payload: Record<string, unknown> = {
    archive_id: input.archiveId,
    host_id: hostId,
    slug,
    title: inferredTitle,
    description: input.description?.trim() || null,
    thumbnail_url: input.thumbnailUrl?.trim() || null,
    is_published: true,
    is_featured: !!input.isFeatured,
    published_at: new Date().toISOString(),
  };

  const { error } = await supabase
    .from("replay_publications")
    .upsert(payload, { onConflict: "archive_id" });
  if (error) {
    // Slug collision is the common failure — surface a friendly message.
    if (error.code === "23505") {
      return {
        ok: false,
        message:
          "That slug is already in use. Pick a different one or leave the field blank.",
      };
    }
    console.error("[studio/replay] publish failed:", error);
    return { ok: false, message: "Couldn't publish that replay." };
  }
  revalidatePath("/studio/replay");
  return { ok: true };
}

/**
 * Unpublish — flips is_published=false but keeps the row so we don't
 * lose the host's title/description/thumbnail edits when they
 * republish later.
 */
export async function unpublishReplay(input: {
  publicationId: string;
}): Promise<ActionResult> {
  const ctx = await requireHost();
  if ("error" in ctx) return { ok: false, message: ctx.error };
  const { supabase } = ctx;

  const { error } = await supabase
    .from("replay_publications")
    .update({ is_published: false, published_at: null })
    .eq("id", input.publicationId);
  if (error) {
    console.error("[studio/replay] unpublish failed:", error);
    return { ok: false, message: "Couldn't unpublish that replay." };
  }
  revalidatePath("/studio/replay");
  return { ok: true };
}

/**
 * Toggle featured. RLS gates ownership; we don't need to recheck.
 */
export async function setFeatured(input: {
  publicationId: string;
  isFeatured: boolean;
}): Promise<ActionResult> {
  const ctx = await requireHost();
  if ("error" in ctx) return { ok: false, message: ctx.error };
  const { supabase } = ctx;

  const { error } = await supabase
    .from("replay_publications")
    .update({ is_featured: input.isFeatured })
    .eq("id", input.publicationId);
  if (error) {
    console.error("[studio/replay] setFeatured failed:", error);
    return { ok: false, message: "Couldn't update featured state." };
  }
  revalidatePath("/studio/replay");
  return { ok: true };
}
