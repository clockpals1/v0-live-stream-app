import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { ReplayPublicView } from "@/components/replay/public-view";

/**
 * Public replay page — `/r/[id]`.
 *
 * URL CHOICE
 * ----------
 * We deliberately use the publication's primary-key UUID rather than
 * `/r/{host}/{slug}`. Reasons:
 *   - One DB lookup, indexed by PK. No risk of slug collisions across
 *     hosts or migration headaches when we eventually add a host_slug.
 *   - Share links are immutable across renames. If a host edits the
 *     title (and therefore slug), every YouTube/Twitter card stays
 *     pointing at the right replay.
 *   - Length-wise, 36 chars vs ~30 for slug+host — fine for share UX.
 *
 * RLS / data flow
 * ---------------
 * - replay_publications has a public SELECT policy WHERE is_published.
 * - stream_archives gained a parallel public SELECT policy in
 *   migration 026 (only when an archive backs a published replay).
 * - replay_comments / replay_likes are SELECT-public on published
 *   replays. Mutations require auth; the route's server actions will
 *   redirect to /auth/login?next=/r/[id] when needed.
 *
 * View counter
 * ------------
 * We bump view_count at SSR time via the `increment_replay_view` RPC
 * (migration 026, SECURITY DEFINER). Yes, this counts every render
 * including bot crawls — that's an intentional simplification for
 * Phase 2; per-IP de-duplication can come later if we ever care.
 */

export const dynamic = "force-dynamic";

type Params = { id: string };

interface ReplayRow {
  id: string;
  archive_id: string;
  host_id: string;
  slug: string;
  title: string;
  description: string | null;
  thumbnail_url: string | null;
  is_published: boolean;
  is_featured: boolean;
  published_at: string | null;
  view_count: number;
  like_count: number;
  comment_count: number;
  created_at: string;
}

interface ArchiveRow {
  id: string;
  public_url: string | null;
  content_type: string;
  byte_size: number | null;
}

interface HostRow {
  id: string;
  display_name: string | null;
}

interface CommentRow {
  id: string;
  viewer_id: string;
  display_name: string;
  body: string;
  created_at: string;
  deleted_at: string | null;
}

async function loadReplay(id: string): Promise<{
  replay: ReplayRow;
  archive: ArchiveRow | null;
  host: HostRow | null;
  comments: CommentRow[];
  viewerHasLiked: boolean;
  viewerId: string | null;
  viewerIsHost: boolean;
} | null> {
  const supabase = await createClient();

  // 1) The publication row. Public SELECT policy fences this to
  //    is_published=true so an unpublished replay 404s for visitors.
  const { data: replay, error } = await supabase
    .from("replay_publications")
    .select(
      "id, archive_id, host_id, slug, title, description, thumbnail_url, is_published, is_featured, published_at, view_count, like_count, comment_count, created_at",
    )
    .eq("id", id)
    .eq("is_published", true)
    .maybeSingle<ReplayRow>();
  if (error) {
    console.warn("[r/[id]] replay lookup failed:", error.message);
    return null;
  }
  if (!replay) return null;

  // 2) Archive (for the player). May fail benignly if RLS rejects.
  const { data: archive } = await supabase
    .from("stream_archives")
    .select("id, public_url, content_type, byte_size")
    .eq("id", replay.archive_id)
    .maybeSingle<ArchiveRow>();

  // 3) Host display name. Hosts table SELECT policy lets owners read
  //    themselves; for the public we read it via a nested RPC-free
  //    select. RLS on hosts requires the requester to BE the host —
  //    so for anonymous viewers, this returns null. We tolerate that
  //    and fall back to "Creator" as the display name.
  const { data: host } = await supabase
    .from("hosts")
    .select("id, display_name")
    .eq("id", replay.host_id)
    .maybeSingle<HostRow>();

  // 4) Comments. Public read policy on published replays.
  const { data: comments } = await supabase
    .from("replay_comments")
    .select("id, viewer_id, display_name, body, created_at, deleted_at")
    .eq("replay_id", replay.id)
    .order("created_at", { ascending: false })
    .limit(200);

  // 5) Has the current viewer liked this replay?
  const { data: userData } = await supabase.auth.getUser();
  const viewerId = userData?.user?.id ?? null;
  let viewerHasLiked = false;
  if (viewerId) {
    const { data: likeRow } = await supabase
      .from("replay_likes")
      .select("id")
      .eq("replay_id", replay.id)
      .eq("viewer_id", viewerId)
      .maybeSingle();
    viewerHasLiked = !!likeRow;
  }

  // 6) Is the current viewer the host? (Lets them moderate.)
  let viewerIsHost = false;
  if (viewerId && host) {
    const { data: hostRow } = await supabase
      .from("hosts")
      .select("id")
      .eq("user_id", viewerId)
      .maybeSingle();
    viewerIsHost = !!hostRow && hostRow.id === replay.host_id;
  }

  // 7) Bump view counter (best-effort; RPC is SECURITY DEFINER so
  //    even anon callers succeed).
  try {
    await supabase.rpc("increment_replay_view", { p_replay_id: replay.id });
  } catch (err) {
    console.warn("[r/[id]] view counter bump failed:", err);
  }

  return {
    replay,
    archive: archive ?? null,
    host: host ?? null,
    comments: (comments as CommentRow[] | null) ?? [],
    viewerHasLiked,
    viewerId,
    viewerIsHost,
  };
}

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const { id } = await params;
  const supabase = await createClient();
  const { data } = await supabase
    .from("replay_publications")
    .select("title, description, thumbnail_url, is_published")
    .eq("id", id)
    .eq("is_published", true)
    .maybeSingle<{
      title: string;
      description: string | null;
      thumbnail_url: string | null;
      is_published: boolean;
    }>();
  if (!data) {
    return { title: "Replay not found" };
  }
  const desc = data.description?.slice(0, 200) ?? "Watch this replay.";
  const url =
    (process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ??
      "https://live.isunday.me") + `/r/${id}`;
  return {
    title: data.title,
    description: desc,
    openGraph: {
      title: data.title,
      description: desc,
      url,
      type: "video.other",
      images: data.thumbnail_url ? [data.thumbnail_url] : undefined,
    },
    twitter: {
      card: data.thumbnail_url ? "summary_large_image" : "summary",
      title: data.title,
      description: desc,
      images: data.thumbnail_url ? [data.thumbnail_url] : undefined,
    },
    alternates: { canonical: url },
  };
}

export default async function PublicReplayPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { id } = await params;
  const data = await loadReplay(id);
  if (!data) notFound();

  return (
    <ReplayPublicView
      replayId={data.replay.id}
      title={data.replay.title}
      description={data.replay.description}
      thumbnailUrl={data.replay.thumbnail_url}
      videoUrl={data.archive?.public_url ?? null}
      videoMime={data.archive?.content_type ?? "video/webm"}
      hostName={data.host?.display_name ?? "Creator"}
      publishedAt={data.replay.published_at}
      counts={{
        views: data.replay.view_count,
        likes: data.replay.like_count,
        comments: data.replay.comment_count,
      }}
      viewerHasLiked={data.viewerHasLiked}
      viewerId={data.viewerId}
      viewerIsHost={data.viewerIsHost}
      comments={data.comments
        .filter((c) => c.deleted_at == null || true) // keep deleted to render "[removed]"
        .map((c) => ({
          id: c.id,
          viewerId: c.viewer_id,
          displayName: c.display_name,
          body: c.body,
          createdAt: c.created_at,
          deletedAt: c.deleted_at,
        }))}
    />
  );
}
