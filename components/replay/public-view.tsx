"use client";

import { useState, useTransition, useOptimistic } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Heart,
  MessageCircle,
  Eye,
  Share2,
  Trash2,
  Loader2,
  Radio,
  Check,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ThemeToggle } from "@/components/theme-toggle";
import { cn } from "@/lib/utils";
import { toggleLike, postComment, deleteComment } from "@/app/r/[id]/actions";

/**
 * Public replay view — what every shared link renders.
 *
 * COMPONENT SHAPE
 * ---------------
 * One client component on purpose. The video, like button, comment
 * list, and share menu are tightly intertwined (a like updates the
 * counter, a new comment scrolls the list) and splitting them adds
 * more cross-component plumbing than the savings are worth.
 *
 * OPTIMISTIC LIKES
 * ----------------
 * useOptimistic flips the count and the heart icon instantly; if the
 * server action rejects (rare — usually means signed-out) we roll
 * back. Rollback path: refresh the route so the SSR-rendered count
 * comes back from the DB.
 *
 * SIGN-IN BOUNCE
 * --------------
 * If the action returns reason='unauthenticated', we route the user
 * to /auth/login?next=<currentPath>. The login page reads ?next= and
 * routes them straight back here after sign-in.
 */

interface CommentItem {
  id: string;
  viewerId: string;
  displayName: string;
  body: string;
  createdAt: string;
  deletedAt: string | null;
}

interface PublicViewProps {
  replayId: string;
  title: string;
  description: string | null;
  thumbnailUrl: string | null;
  videoUrl: string | null;
  videoMime: string;
  hostName: string;
  publishedAt: string | null;
  counts: { views: number; likes: number; comments: number };
  viewerHasLiked: boolean;
  viewerId: string | null;
  viewerIsHost: boolean;
  comments: CommentItem[];
}

export function ReplayPublicView({
  replayId,
  title,
  description,
  thumbnailUrl,
  videoUrl,
  videoMime,
  hostName,
  publishedAt,
  counts,
  viewerHasLiked,
  viewerId,
  viewerIsHost,
  comments,
}: PublicViewProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [likeState, applyLikeOptimistic] = useOptimistic(
    { liked: viewerHasLiked, count: counts.likes },
    (state) => ({
      liked: !state.liked,
      count: state.liked ? Math.max(state.count - 1, 0) : state.count + 1,
    }),
  );

  const [commentBody, setCommentBody] = useState("");
  const [commentError, setCommentError] = useState<string | null>(null);
  const [shareOk, setShareOk] = useState(false);

  const bounceToLogin = () => {
    if (typeof window === "undefined") return;
    const next = encodeURIComponent(window.location.pathname);
    router.push(`/auth/login?next=${next}`);
  };

  const handleToggleLike = () => {
    if (!viewerId) {
      bounceToLogin();
      return;
    }
    startTransition(async () => {
      applyLikeOptimistic(undefined);
      const res = await toggleLike({ replayId });
      if (!res.ok) {
        // Reset by pulling the truth back from the server.
        router.refresh();
      }
    });
  };

  const handlePostComment = (e: React.FormEvent) => {
    e.preventDefault();
    setCommentError(null);
    if (!viewerId) {
      bounceToLogin();
      return;
    }
    const body = commentBody.trim();
    if (!body) {
      setCommentError("Write something first.");
      return;
    }
    startTransition(async () => {
      const res = await postComment({ replayId, body });
      if (res.ok) {
        setCommentBody("");
        router.refresh();
      } else if (res.reason === "unauthenticated") {
        bounceToLogin();
      } else {
        setCommentError(res.message ?? "Couldn't post that.");
      }
    });
  };

  const handleDeleteComment = (commentId: string) => {
    if (!confirm("Remove this comment?")) return;
    startTransition(async () => {
      const res = await deleteComment({ commentId, replayId });
      if (res.ok) router.refresh();
      else if (res.reason === "unauthenticated") bounceToLogin();
    });
  };

  const handleShare = async () => {
    const url =
      typeof window !== "undefined" ? window.location.href : "";
    try {
      if (typeof navigator !== "undefined" && navigator.share) {
        await navigator.share({ title, text: description ?? "", url });
        return;
      }
    } catch {
      // user cancelled — fall through to copy
    }
    try {
      await navigator.clipboard.writeText(url);
      setShareOk(true);
      setTimeout(() => setShareOk(false), 2000);
    } catch (err) {
      console.warn("[r/[id]] clipboard write failed:", err);
    }
  };

  const publishedLabel = publishedAt
    ? new Date(publishedAt).toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
      })
    : "Recently";

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* ─── Header ──────────────────────────────────────────────────── */}
      <header className="border-b border-border/60 bg-card/40 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          <Link href="/" className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary">
              <Radio className="h-4 w-4 text-primary-foreground" />
            </div>
            <span className="font-semibold">Isunday Stream</span>
          </Link>
          <ThemeToggle />
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-6">
        {/* ─── Player ──────────────────────────────────────────────── */}
        <div className="overflow-hidden rounded-xl bg-black">
          {videoUrl ? (
            <video
              key={videoUrl}
              src={videoUrl}
              poster={thumbnailUrl ?? undefined}
              controls
              playsInline
              preload="metadata"
              className="aspect-video w-full bg-black"
            >
              <source src={videoUrl} type={videoMime} />
              Your browser doesn't support video playback.
            </video>
          ) : (
            <div className="flex aspect-video items-center justify-center bg-muted text-sm text-muted-foreground">
              This replay is no longer available.
            </div>
          )}
        </div>

        {/* ─── Title row ───────────────────────────────────────────── */}
        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <h1 className="break-words text-2xl font-bold leading-tight">
              {title}
            </h1>
            <div className="mt-1 text-sm text-muted-foreground">
              {hostName} · {publishedLabel}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button
              size="sm"
              variant={likeState.liked ? "default" : "outline"}
              onClick={handleToggleLike}
              disabled={pending}
              aria-pressed={likeState.liked}
            >
              <Heart
                className={cn(
                  "mr-2 h-4 w-4",
                  likeState.liked && "fill-current",
                )}
              />
              {likeState.count}
            </Button>
            <Button size="sm" variant="outline" onClick={handleShare}>
              {shareOk ? (
                <Check className="mr-2 h-4 w-4 text-emerald-500" />
              ) : (
                <Share2 className="mr-2 h-4 w-4" />
              )}
              {shareOk ? "Copied" : "Share"}
            </Button>
          </div>
        </div>

        {/* ─── Stats row ───────────────────────────────────────────── */}
        <div className="mt-3 flex items-center gap-4 text-sm text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <Eye className="h-4 w-4" />
            {counts.views.toLocaleString()} views
          </span>
          <span className="inline-flex items-center gap-1">
            <MessageCircle className="h-4 w-4" />
            {counts.comments.toLocaleString()} comments
          </span>
        </div>

        {/* ─── Description ─────────────────────────────────────────── */}
        {description && (
          <div className="mt-4 whitespace-pre-wrap rounded-lg border border-border/60 bg-card/40 p-4 text-sm leading-relaxed">
            {description}
          </div>
        )}

        {/* ─── Comments ────────────────────────────────────────────── */}
        <section className="mt-8">
          <h2 className="mb-3 text-lg font-semibold">
            {counts.comments.toLocaleString()} comments
          </h2>

          <form onSubmit={handlePostComment} className="mb-6 space-y-2">
            <Textarea
              value={commentBody}
              onChange={(e) => setCommentBody(e.target.value)}
              placeholder={
                viewerId ? "Add a comment…" : "Sign in to leave a comment."
              }
              maxLength={2000}
              rows={3}
              disabled={pending}
            />
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-muted-foreground">
                {commentError ?? `${commentBody.length} / 2000`}
              </span>
              <Button type="submit" size="sm" disabled={pending}>
                {pending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : null}
                {viewerId ? "Comment" : "Sign in to comment"}
              </Button>
            </div>
          </form>

          {comments.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border/60 p-6 text-center text-sm text-muted-foreground">
              No comments yet. Be the first.
            </div>
          ) : (
            <ul className="space-y-4">
              {comments.map((c) => {
                const removed = c.deletedAt != null;
                const canDelete =
                  !removed && (viewerId === c.viewerId || viewerIsHost);
                return (
                  <li
                    key={c.id}
                    className="rounded-lg border border-border/60 bg-card/40 p-3"
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <div className="text-sm font-medium">
                        {removed ? "—" : c.displayName}
                      </div>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <time>
                          {new Date(c.createdAt).toLocaleDateString()}
                        </time>
                        {canDelete && (
                          <button
                            type="button"
                            onClick={() => handleDeleteComment(c.id)}
                            className="inline-flex items-center gap-1 text-muted-foreground hover:text-destructive"
                            disabled={pending}
                            aria-label="Delete comment"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                    <p
                      className={cn(
                        "mt-1 whitespace-pre-wrap text-sm leading-relaxed",
                        removed && "italic text-muted-foreground",
                      )}
                    >
                      {removed ? "[comment removed]" : c.body}
                    </p>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
}
