"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Film,
  Globe,
  EyeOff,
  Link2,
  Check,
  Star,
  Pencil,
  ExternalLink,
  Heart,
  MessageSquare,
  Eye,
  Loader2,
  Trash2,
  AlertTriangle,
} from "lucide-react";
import { useRouter } from "next/navigation";
import {
  publishReplay,
  unpublishReplay,
  setFeatured,
} from "@/app/studio/replay/actions";
import type { ReplayItem } from "@/lib/studio/replay/queries";

/**
 * Replay Library — interactive list view.
 *
 * One row per archive. Each row shows:
 *   - title (from publication if any, else stream title)
 *   - "draft" / "published" / "featured" status pills
 *   - engagement counters (likes, comments, views) when published —
 *     stub values today, populated by Phase 2 triggers
 *   - actions: Publish / Edit / Unpublish, Feature toggle
 *
 * The "Publish" dialog captures title, description, thumbnail URL,
 * slug. We deliberately keep this minimal in Phase 1; the URL field
 * accepts any external link so a host can use any image they have
 * (Imgur, their own CDN). Phase 2 adds proper R2 thumbnail upload.
 */
interface ReplayLibraryViewProps {
  replays: ReplayItem[];
  canPublish: boolean;
  hostId: string;
}

export function ReplayLibraryView({
  replays,
  canPublish,
}: ReplayLibraryViewProps) {
  if (replays.length === 0) {
    return (
      <Card className="border-dashed">
        <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <Film className="h-5 w-5" />
          </div>
          <div>
            <h3 className="text-base font-medium">No archives yet</h3>
            <p className="mt-1 max-w-sm text-xs text-muted-foreground">
              Once you've finished a live stream with cloud archive enabled,
              your recordings will appear here ready to publish as replays.
            </p>
          </div>
          <Button asChild size="sm" variant="outline">
            <Link href="https://live.isunday.me/host/dashboard">
              Go to live dashboard
            </Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {replays.map((r) => (
        <ReplayRow key={r.archiveId} replay={r} canPublish={canPublish} />
      ))}
    </div>
  );
}

function ReplayRow({
  replay,
  canPublish,
}: {
  replay: ReplayItem;
  canPublish: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const pub = replay.publication;
  const displayTitle = pub?.title || replay.streamTitle;
  const archivedDate = new Date(replay.archivedAt).toLocaleDateString(
    undefined,
    { year: "numeric", month: "short", day: "numeric" },
  );
  const sizeMB =
    replay.sizeBytes > 0
      ? `${(replay.sizeBytes / (1024 * 1024)).toFixed(0)} MB`
      : null;

  function handleUnpublish() {
    if (!pub) return;
    startTransition(async () => {
      const res = await unpublishReplay({ publicationId: pub.id });
      if (res.ok) toast.success("Replay unpublished.");
      else toast.error(res.message);
    });
  }

  function handleToggleFeatured() {
    if (!pub) return;
    startTransition(async () => {
      const res = await setFeatured({
        publicationId: pub.id,
        isFeatured: !pub.isFeatured,
      });
      if (res.ok) {
        toast.success(pub.isFeatured ? "Removed from featured." : "Featured!");
      } else {
        toast.error(res.message);
      }
    });
  }

  // Hard-delete the R2 object and soft-delete the DB row. This calls
  // the existing DELETE /api/streams/[id]/archive/[id] endpoint which
  // does ownership + admin checks server-side. We refresh the route
  // afterwards so the deleted card disappears immediately — the row is
  // soft-deleted (status='deleted') and listReplaysForHost filters it
  // out via deleted_at IS NULL.
  async function handleDelete() {
    if (!replay.streamId) {
      toast.error("This archive is missing its stream link — cannot delete.");
      return;
    }
    setDeleting(true);
    try {
      const res = await fetch(
        `/api/streams/${replay.streamId}/archive/${replay.archiveId}`,
        { method: "DELETE", headers: { "Content-Type": "application/json" } },
      );
      const json = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      toast.success("Recording deleted.");
      setConfirmingDelete(false);
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't delete recording.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <>
      <Card>
        <CardContent className="flex items-start gap-4 p-4">
          {/* Thumbnail / icon */}
          <div className="relative flex h-20 w-32 shrink-0 items-center justify-center overflow-hidden rounded-md bg-gradient-to-br from-violet-500/20 to-indigo-500/10">
            {pub?.thumbnailUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={pub.thumbnailUrl}
                alt={displayTitle}
                className="h-full w-full object-cover"
              />
            ) : (
              <Film className="h-6 w-6 text-violet-700/50 dark:text-violet-300/50" />
            )}
            {pub?.isFeatured && (
              <div className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-amber-500 text-white shadow">
                <Star className="h-3 w-3 fill-white" />
              </div>
            )}
          </div>

          {/* Body */}
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline gap-2">
              <h3 className="truncate text-sm font-semibold">{displayTitle}</h3>
              {pub?.isPublished ? (
                <Badge className="h-5 px-1.5 text-[10px] bg-emerald-500/15 text-emerald-700 hover:bg-emerald-500/15 dark:text-emerald-300">
                  <Globe className="mr-1 h-2.5 w-2.5" />
                  Published
                </Badge>
              ) : (
                <Badge
                  variant="outline"
                  className="h-5 px-1.5 text-[10px] text-muted-foreground"
                >
                  Draft
                </Badge>
              )}
              {replay.archiveExpired && (
                <Badge
                  variant="outline"
                  className="h-5 px-1.5 text-[10px] text-amber-600 border-amber-500/30"
                >
                  Archive expired
                </Badge>
              )}
            </div>
            <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
              {pub?.description || (
                <span className="italic">No description yet.</span>
              )}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
              <span>Recorded {archivedDate}</span>
              {sizeMB && <span>· {sizeMB}</span>}
              {pub?.isPublished && (
                <>
                  <span className="flex items-center gap-1">
                    <Eye className="h-3 w-3" />
                    {pub.viewCount}
                  </span>
                  <span className="flex items-center gap-1">
                    <Heart className="h-3 w-3" />
                    {pub.likeCount}
                  </span>
                  <span className="flex items-center gap-1">
                    <MessageSquare className="h-3 w-3" />
                    {pub.commentCount}
                  </span>
                </>
              )}
            </div>
          </div>

          {/* Actions */}
          <div className="flex shrink-0 flex-col items-end gap-1.5">
            {!pub?.isPublished ? (
              <div className="flex items-center gap-1.5">
                <Button
                  size="sm"
                  onClick={() => setEditing(true)}
                  disabled={!canPublish || replay.archiveExpired || pending}
                >
                  {pending ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <>
                      <Globe className="mr-1.5 h-3.5 w-3.5" />
                      Publish
                    </>
                  )}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setConfirmingDelete(true)}
                  disabled={pending || deleting}
                  title="Delete this recording permanently"
                  className="text-muted-foreground hover:text-destructive"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            ) : (
              <div className="flex gap-1.5">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={handleToggleFeatured}
                  disabled={pending}
                  title={
                    pub.isFeatured
                      ? "Remove from featured"
                      : "Mark as featured"
                  }
                >
                  <Star
                    className={`h-3.5 w-3.5 ${
                      pub.isFeatured ? "fill-amber-500 text-amber-500" : ""
                    }`}
                  />
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setEditing(true)}
                  disabled={pending}
                >
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
                <CopyPublicLinkButton publicationId={pub.id} />
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={handleUnpublish}
                  disabled={pending}
                  title="Unpublish"
                >
                  <EyeOff className="h-3.5 w-3.5" />
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setConfirmingDelete(true)}
                  disabled={pending || deleting}
                  title="Delete this recording permanently"
                  className="text-muted-foreground hover:text-destructive"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            )}
            {replay.archiveUrl && (
              <a
                href={replay.archiveUrl}
                target="_blank"
                rel="noreferrer"
                className="text-[11px] text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
              >
                Source <ExternalLink className="h-3 w-3" />
              </a>
            )}
          </div>
        </CardContent>
      </Card>

      <PublishDialog
        open={editing}
        onClose={() => setEditing(false)}
        replay={replay}
      />

      {/* Destructive-action confirmation. Modal because the R2 delete is
          irreversible — we don't want a fat-finger to nuke a recording. */}
      <Dialog
        open={confirmingDelete}
        onOpenChange={(o) => !deleting && setConfirmingDelete(o)}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              Delete this recording?
            </DialogTitle>
            <DialogDescription>
              This permanently removes the video file from cloud storage.
              {pub?.isPublished
                ? " The public replay page will also stop working."
                : ""}
              <br />
              <span className="mt-2 inline-block font-medium text-foreground">
                {displayTitle}
              </span>
              {sizeMB && (
                <span className="text-muted-foreground"> · {sizeMB}</span>
              )}
              <br />
              <span className="mt-2 inline-block text-xs">
                This cannot be undone.
              </span>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setConfirmingDelete(false)}
              disabled={deleting}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={deleting}
            >
              {deleting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Deleting…
                </>
              ) : (
                <>
                  <Trash2 className="mr-2 h-4 w-4" />
                  Delete recording
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function PublishDialog({
  open,
  onClose,
  replay,
}: {
  open: boolean;
  onClose: () => void;
  replay: ReplayItem;
}) {
  const pub = replay.publication;
  const [title, setTitle] = useState(pub?.title || replay.streamTitle);
  const [description, setDescription] = useState(pub?.description || "");
  const [thumbnailUrl, setThumbnailUrl] = useState(pub?.thumbnailUrl || "");
  const [slug, setSlug] = useState(pub?.slug || "");
  const [pending, startTransition] = useTransition();

  function submit() {
    startTransition(async () => {
      const res = await publishReplay({
        archiveId: replay.archiveId,
        title,
        description,
        thumbnailUrl,
        slug: slug || undefined,
      });
      if (res.ok) {
        toast.success(pub ? "Replay updated." : "Replay published!");
        onClose();
      } else {
        toast.error(res.message);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{pub ? "Edit replay" : "Publish replay"}</DialogTitle>
          <DialogDescription>
            {pub
              ? "Tweak the details visible to your audience."
              : "Give this recording a public identity. You can always edit later."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="title">Title</Label>
            <Input
              id="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Friday night service"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="A short blurb that appears on the replay page."
              rows={3}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="thumbnail">Thumbnail URL (optional)</Label>
            <Input
              id="thumbnail"
              value={thumbnailUrl}
              onChange={(e) => setThumbnailUrl(e.target.value)}
              placeholder="https://example.com/cover.jpg"
            />
            <p className="text-[10px] text-muted-foreground">
              Paste any image URL. Direct R2 upload coming in Phase 2.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="slug">URL slug (optional)</Label>
            <Input
              id="slug"
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              placeholder="auto-generated from title"
            />
            <p className="text-[10px] text-muted-foreground">
              Public URL will be /r/{"{your-handle}"}/{slug || "auto-slug"}
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={pending || !title.trim()}>
            {pending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : pub ? (
              "Save changes"
            ) : (
              "Publish"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Copy-public-link button. Tiny standalone component because three
 * pieces of state (copied flag, click handler, fallback) would clutter
 * the parent ReplayCard. Uses navigator.clipboard with a hard fallback
 * for browsers/iframes that block it (older Safari, Cloudflare Tunnel
 * preview, etc.).
 */
function CopyPublicLinkButton({ publicationId }: { publicationId: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    if (typeof window === "undefined") return;
    const url = `${window.location.origin}/r/${publicationId}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      toast.success("Public link copied.");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback: open a prompt the user can copy from manually.
      window.prompt("Copy this URL:", url);
    }
  };
  return (
    <Button
      size="sm"
      variant="ghost"
      onClick={handleCopy}
      title="Copy public link"
      aria-label="Copy public link"
    >
      {copied ? (
        <Check className="h-3.5 w-3.5 text-emerald-500" />
      ) : (
        <Link2 className="h-3.5 w-3.5" />
      )}
    </Button>
  );
}
