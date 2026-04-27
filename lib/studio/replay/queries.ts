import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Replay Library — server-side data access.
 *
 * The library is a JOIN between two tables:
 *   - stream_archives    (storage row: bytes, expiry, size — migration 020)
 *   - replay_publications (metadata row: title, slug, engagement — mig 025)
 *
 * Most pages want both: "show me every archive, plus its publication
 * status if any". We expose typed helpers here so pages don't reinvent
 * the join shape.
 *
 * RLS NOTE
 * --------
 * Pass a user-scoped client (lib/supabase/server.ts) when reading on
 * behalf of the host — RLS on both tables already enforces ownership
 * scope. Pass the admin client only when running server-side jobs
 * (cron, retention sweeps).
 */

export interface ReplayItem {
  /** stream_archives row id — stable across publish/unpublish. */
  archiveId: string;
  /** Source streams.id, null for orphaned archives (rare). */
  streamId: string | null;
  /** Title from streams.title at the time of archiving. */
  streamTitle: string;
  /** stream_archives.created_at — when the archive landed in R2. */
  archivedAt: string;
  /** Bytes in R2 — for size badges. */
  sizeBytes: number;
  /** Public R2 URL or signed URL, null if archive is missing. */
  archiveUrl: string | null;
  /** Whether the archive has expired/been deleted by retention. */
  archiveExpired: boolean;
  /** Replay publication row, null if the host never published. */
  publication: ReplayPublication | null;
}

export interface ReplayPublication {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  thumbnailUrl: string | null;
  isPublished: boolean;
  isFeatured: boolean;
  publishedAt: string | null;
  viewCount: number;
  likeCount: number;
  commentCount: number;
  updatedAt: string;
}

/**
 * List every archive owned by `hostId`, joined with its publication
 * row (if any), newest archive first.
 *
 * We deliberately do NOT filter by publication status at this layer —
 * the library page wants to show "everything" so the host can decide
 * what to publish next.
 */
export async function listReplaysForHost(
  supabase: SupabaseClient,
  hostId: string,
): Promise<ReplayItem[]> {
  // Two queries are simpler than a single nested select with RLS quirks.
  // Volume is bounded by the host's archive count so the cost is fine.
  //
  // The column name is `byte_size`, not `size_bytes` — every other
  // archive read in the codebase uses byte_size (see migration 020).
  // The earlier typo here failed every fetch silently with PostgREST
  // error "column stream_archives.size_bytes does not exist" and
  // forced the Replay Library into the 'No archives yet' empty state
  // even when the host had successfully uploaded recordings.
  //
  // We also filter `deleted_at IS NULL` so soft-deleted rows the
  // archive-cleanup cron has marked for retention purge don't flash
  // in the UI before being filtered out elsewhere.
  const { data: archives, error: archiveErr } = await supabase
    .from("stream_archives")
    .select(
      "id, stream_id, byte_size, created_at, public_url, status, streams(title)",
    )
    .eq("host_id", hostId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(200);
  if (archiveErr) {
    console.error("[studio/replay] archive list failed:", archiveErr);
    return [];
  }

  const archiveIds = (archives ?? []).map((a) => (a as { id: string }).id);
  let publications: Record<string, ReplayPublication> = {};
  if (archiveIds.length > 0) {
    const { data: pubs } = await supabase
      .from("replay_publications")
      .select(
        "id, archive_id, slug, title, description, thumbnail_url, is_published, is_featured, published_at, view_count, like_count, comment_count, updated_at",
      )
      .in("archive_id", archiveIds);
    publications = Object.fromEntries(
      (pubs ?? []).map((p) => {
        const row = p as Record<string, unknown>;
        return [
          row.archive_id as string,
          {
            id: row.id as string,
            slug: row.slug as string,
            title: row.title as string,
            description: (row.description as string | null) ?? null,
            thumbnailUrl: (row.thumbnail_url as string | null) ?? null,
            isPublished: !!row.is_published,
            isFeatured: !!row.is_featured,
            publishedAt: (row.published_at as string | null) ?? null,
            viewCount: Number(row.view_count ?? 0),
            likeCount: Number(row.like_count ?? 0),
            commentCount: Number(row.comment_count ?? 0),
            updatedAt: row.updated_at as string,
          } satisfies ReplayPublication,
        ];
      }),
    );
  }

  return (archives ?? []).map((a) => {
    const row = a as Record<string, unknown>;
    const streamRel = row.streams as { title?: string } | null;
    return {
      archiveId: row.id as string,
      streamId: (row.stream_id as string | null) ?? null,
      streamTitle: streamRel?.title || "Untitled stream",
      archivedAt: row.created_at as string,
      sizeBytes: Number(row.byte_size ?? 0),
      archiveUrl: (row.public_url as string | null) ?? null,
      archiveExpired: row.status === "expired" || row.status === "deleted",
      publication: publications[row.id as string] ?? null,
    } satisfies ReplayItem;
  });
}

/**
 * Generate a URL-safe slug from a title. Used as the default when a
 * host clicks "Publish" without typing a slug.
 */
export function defaultSlugFromTitle(title: string): string {
  return (
    title
      .toLowerCase()
      .replace(/['"`]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "replay"
  );
}
