"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

/**
 * Server actions for the public replay page.
 *
 * SECURITY MODEL
 * --------------
 * Every action is auth-gated. We DON'T expose anonymous likes or
 * comments — viewers can read everything but must sign in to write.
 * RLS on replay_likes / replay_comments enforces the same rule a
 * second time so a missed check here is still safe.
 *
 * RETURN SHAPE
 * ------------
 * Every action returns `ActionResult` so the client component can
 * uniformly handle "needs sign-in" vs "real error" vs "ok".
 *
 * REVALIDATION
 * ------------
 * We revalidatePath('/r/<id>') after every successful write so the
 * server-rendered page picks up new counts on the next render. Counts
 * themselves are maintained by DB triggers (migration 026); we just
 * tell Next.js to drop the cached HTML.
 */

export type ActionResult =
  | { ok: true }
  | { ok: false; reason: "unauthenticated" | "not_published" | "error"; message?: string };

interface AuthCtx {
  supabase: Awaited<ReturnType<typeof createClient>>;
  userId: string;
  displayName: string;
}

async function requireAuth(): Promise<AuthCtx | { error: ActionResult }> {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  const user = userData?.user;
  if (!user) {
    return { error: { ok: false, reason: "unauthenticated" } };
  }
  // Pull a display name. Prefer the hosts row if present (creators
  // commenting on their own/others' replays); fall back to the email
  // local-part so anonymous-feel viewers still get a label.
  const { data: host } = await supabase
    .from("hosts")
    .select("display_name")
    .eq("user_id", user.id)
    .maybeSingle<{ display_name: string | null }>();
  const fallback = user.email?.split("@")[0] ?? "Viewer";
  const displayName =
    host?.display_name?.trim() ||
    (user.user_metadata?.display_name as string | undefined)?.trim() ||
    fallback;
  return { supabase, userId: user.id, displayName };
}

/**
 * Toggle a like. Idempotent on either direction — if the row exists
 * we delete it, otherwise we insert. RLS guarantees we can only ever
 * touch our own (viewer_id = auth.uid()).
 */
export async function toggleLike(input: {
  replayId: string;
}): Promise<ActionResult> {
  const ctx = await requireAuth();
  if ("error" in ctx) return ctx.error;
  const { supabase, userId } = ctx;

  // Confirm replay is published — defence in depth on top of RLS.
  const { data: replay } = await supabase
    .from("replay_publications")
    .select("id")
    .eq("id", input.replayId)
    .eq("is_published", true)
    .maybeSingle();
  if (!replay) return { ok: false, reason: "not_published" };

  const { data: existing } = await supabase
    .from("replay_likes")
    .select("id")
    .eq("replay_id", input.replayId)
    .eq("viewer_id", userId)
    .maybeSingle<{ id: string }>();

  if (existing) {
    const { error } = await supabase
      .from("replay_likes")
      .delete()
      .eq("id", existing.id);
    if (error) {
      console.error("[r/[id]] unlike failed:", error);
      return { ok: false, reason: "error", message: "Couldn't remove like." };
    }
  } else {
    const { error } = await supabase
      .from("replay_likes")
      .insert({ replay_id: input.replayId, viewer_id: userId });
    if (error) {
      console.error("[r/[id]] like failed:", error);
      return { ok: false, reason: "error", message: "Couldn't add like." };
    }
  }
  revalidatePath(`/r/${input.replayId}`);
  return { ok: true };
}

/**
 * Post a comment. Body is trimmed and capped at 2000 chars (the same
 * CHECK constraint at the DB level). Empty bodies bounce.
 */
export async function postComment(input: {
  replayId: string;
  body: string;
}): Promise<ActionResult> {
  const ctx = await requireAuth();
  if ("error" in ctx) return ctx.error;
  const { supabase, userId, displayName } = ctx;

  const body = input.body.trim();
  if (body.length === 0) {
    return { ok: false, reason: "error", message: "Write something first." };
  }
  if (body.length > 2000) {
    return {
      ok: false,
      reason: "error",
      message: "Keep comments under 2000 characters.",
    };
  }

  const { data: replay } = await supabase
    .from("replay_publications")
    .select("id")
    .eq("id", input.replayId)
    .eq("is_published", true)
    .maybeSingle();
  if (!replay) return { ok: false, reason: "not_published" };

  const { error } = await supabase.from("replay_comments").insert({
    replay_id: input.replayId,
    viewer_id: userId,
    display_name: displayName,
    body,
  });
  if (error) {
    console.error("[r/[id]] post comment failed:", error);
    return { ok: false, reason: "error", message: "Couldn't post comment." };
  }
  revalidatePath(`/r/${input.replayId}`);
  return { ok: true };
}

/**
 * Soft-delete a comment. RLS allows the comment author OR the
 * replay's host to UPDATE — we just stamp deleted_at.
 */
export async function deleteComment(input: {
  commentId: string;
  replayId: string;
}): Promise<ActionResult> {
  const ctx = await requireAuth();
  if ("error" in ctx) return ctx.error;
  const { supabase } = ctx;

  const { error } = await supabase
    .from("replay_comments")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", input.commentId);
  if (error) {
    console.error("[r/[id]] delete comment failed:", error);
    return { ok: false, reason: "error", message: "Couldn't remove comment." };
  }
  revalidatePath(`/r/${input.replayId}`);
  return { ok: true };
}
