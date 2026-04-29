"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import {
  MoreHorizontal, ArrowRight, Clapperboard, FileText, Hash,
  ListOrdered, Lightbulb, TrendingUp, Sparkles, Star,
  ExternalLink, RotateCcw, Copy, Trash2, FolderOpen,
  AlertTriangle, Loader2, Send,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

export interface AssetCardData {
  id: string;
  asset_type: string;
  title: string | null;
  content: string;
  platform: string | null;
  created_at: string;
  is_starred: boolean;
  video_project_id: string | null;
  video_project_status: string | null;
}

const TYPE_LABELS: Record<string, string> = {
  script:             "Stream Script",
  caption:            "Caption Pack",
  hashtags:           "Hashtag Pack",
  title:              "Title Variants",
  content_ideas:      "Content Ideas",
  campaign_copy:      "Campaign / Ad",
  short_video:        "Short Video Project",
  short_video_script: "Short Video Script",
  summary:            "Summary",
};

const TYPE_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  script:             FileText,
  caption:            FileText,
  hashtags:           Hash,
  title:              ListOrdered,
  content_ideas:      Lightbulb,
  campaign_copy:      TrendingUp,
  short_video:        Clapperboard,
  short_video_script: Clapperboard,
  summary:            Sparkles,
};

const VIDEO_STATUS_LABELS: Record<string, string> = {
  script_ready:      "Script ready",
  scenes_generated:  "Scenes set",
  visuals_pending:   "Visuals pending",
  voiceover_pending: "Voiceover pending",
  preview_ready:     "Preview ready",
  rendering:         "Rendering",
  published:         "Published",
};

export function AssetCardClient({ asset: initial }: { asset: AssetCardData }) {
  const router = useRouter();
  const [asset, setAsset] = useState(initial);
  const [loadingAction, setLoadingAction] = useState<string | null>(null);
  const [removed, setRemoved] = useState(false);

  if (removed) return null;

  const preview = asset.content
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/#+\s/g, "")
    .replace(/\n+/g, " ")
    .trim()
    .slice(0, 140);

  const ago = formatDistanceToNow(new Date(asset.created_at), { addSuffix: true });
  const TypeIcon = TYPE_ICONS[asset.asset_type] ?? FileText;
  const isShortVideo = asset.asset_type === "short_video";
  const hasWorkspace = isShortVideo && !!asset.video_project_id;
  const isPublished = asset.video_project_status === "published";
  const videoStatusLabel = asset.video_project_status
    ? (VIDEO_STATUS_LABELS[asset.video_project_status] ?? asset.video_project_status)
    : "Script ready";

  // ── actions ───────────────────────────────────────────────────────────────

  const handleOpenWorkspace = () => {
    if (asset.video_project_id) {
      router.push(`/ai/video/${asset.video_project_id}`);
    }
  };

  const handleRegenerate = async () => {
    if (!asset.video_project_id) return;
    setLoadingAction("regenerate");
    try {
      const res = await fetch(`/api/ai/video/${asset.video_project_id}/regenerate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fields: "full" }),
      });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error || "Regeneration failed"); return; }
      toast.success("Project regenerated — opening workspace");
      router.push(`/ai/video/${asset.video_project_id}`);
    } finally {
      setLoadingAction(null);
    }
  };

  const handleDuplicate = async () => {
    if (!asset.video_project_id) return;
    setLoadingAction("duplicate");
    try {
      const res = await fetch(`/api/ai/video/${asset.video_project_id}/duplicate`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error || "Duplicate failed"); return; }
      toast.success("Project duplicated — opening copy");
      router.push(`/ai/video/${data.projectId}`);
    } finally {
      setLoadingAction(null);
    }
  };

  const handleStar = async () => {
    setLoadingAction("star");
    try {
      const next = !asset.is_starred;
      const res = await fetch(`/api/ai/assets/${asset.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_starred: next }),
      });
      if (res.ok) {
        setAsset((prev) => ({ ...prev, is_starred: next }));
        toast.success(next ? "Starred" : "Unstarred");
      }
    } finally {
      setLoadingAction(null);
    }
  };

  const handleCopyContent = async () => {
    await navigator.clipboard.writeText(asset.content);
    toast.success("Copied to clipboard");
  };

  const handleDelete = async () => {
    if (!confirm("Delete this project? This cannot be undone.")) return;
    setLoadingAction("delete");
    try {
      const url = asset.video_project_id
        ? `/api/ai/video/${asset.video_project_id}`
        : `/api/ai/assets/${asset.id}`;
      const res = await fetch(url, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error || "Delete failed"); return; }
      toast.success("Deleted");
      setRemoved(true);
      router.refresh();
    } finally {
      setLoadingAction(null);
    }
  };

  const isLoading = loadingAction !== null;

  return (
    <Card className={cn(
      "group relative flex flex-col overflow-hidden transition-all",
      isShortVideo
        ? "border-violet-500/30 bg-gradient-to-br from-violet-500/5 via-background to-background hover:border-violet-500/50 hover:shadow-sm hover:shadow-violet-500/10"
        : "hover:border-primary/40 hover:shadow-sm",
    )}>
      <CardContent className="flex flex-1 flex-col p-4">
        {/* Header row */}
        <div className="mb-2.5 flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 min-w-0">
            <TypeIcon className={cn(
              "h-3.5 w-3.5 shrink-0",
              isShortVideo ? "text-violet-500" : "text-muted-foreground",
            )} />
            <span className={cn(
              "truncate text-[11px] font-semibold uppercase tracking-wider",
              isShortVideo ? "text-violet-600 dark:text-violet-400" : "text-muted-foreground",
            )}>
              {TYPE_LABELS[asset.asset_type] ?? asset.asset_type}
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {isShortVideo && (
              <span className={cn(
                "rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide",
                isPublished
                  ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                  : "bg-violet-500/15 text-violet-700 dark:text-violet-300",
              )}>
                {videoStatusLabel}
              </span>
            )}
            {asset.platform && !isShortVideo && (
              <Badge variant="outline" className="h-4 px-1.5 text-[10px] font-normal capitalize">
                {asset.platform}
              </Badge>
            )}
            {asset.platform && isShortVideo && (
              <Badge variant="outline" className="h-4 border-violet-500/20 px-1.5 text-[10px] font-normal capitalize text-muted-foreground">
                {asset.platform}
              </Badge>
            )}

            {/* Three-dot menu */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  disabled={isLoading}
                  className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground/50 transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40"
                  onClick={(e) => e.stopPropagation()}
                >
                  {isLoading
                    ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    : <MoreHorizontal className="h-3.5 w-3.5" />}
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                {hasWorkspace && (
                  <DropdownMenuItem onClick={handleOpenWorkspace}>
                    <FolderOpen className="mr-2 h-3.5 w-3.5" />
                    Open project
                  </DropdownMenuItem>
                )}
                {hasWorkspace && (
                  <DropdownMenuItem onClick={() => router.push(`/ai/video/${asset.video_project_id}`)}>
                    <ExternalLink className="mr-2 h-3.5 w-3.5" />
                    Edit in workspace
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem onClick={handleCopyContent}>
                  <Copy className="mr-2 h-3.5 w-3.5" />
                  Copy content
                </DropdownMenuItem>
                <DropdownMenuItem onClick={handleStar}>
                  <Star className={cn("mr-2 h-3.5 w-3.5", asset.is_starred && "fill-amber-400 text-amber-400")} />
                  {asset.is_starred ? "Unstar" : "Star"}
                </DropdownMenuItem>
                {hasWorkspace && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={handleRegenerate}>
                      <RotateCcw className="mr-2 h-3.5 w-3.5" />
                      Regenerate project
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={handleDuplicate}>
                      <Copy className="mr-2 h-3.5 w-3.5" />
                      Duplicate project
                    </DropdownMenuItem>
                  </>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={handleDelete}
                  className="text-destructive focus:text-destructive"
                >
                  <Trash2 className="mr-2 h-3.5 w-3.5" />
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {/* Title */}
        {asset.title && (
          <p className="mb-1.5 text-sm font-semibold leading-snug line-clamp-1">{asset.title}</p>
        )}

        {/* Preview */}
        <p className="flex-1 text-xs text-muted-foreground line-clamp-2 leading-relaxed">
          {preview}{preview.length >= 140 ? "…" : ""}
        </p>

        {/* Recovery hint for short video with missing workspace */}
        {isShortVideo && !hasWorkspace && (
          <div className="mt-2 flex items-center gap-1.5 rounded-md border border-amber-500/30 bg-amber-500/5 px-2 py-1.5">
            <AlertTriangle className="h-3 w-3 shrink-0 text-amber-600" />
            <p className="text-[10px] text-amber-700 dark:text-amber-400">
              No project workspace — script generated but project record missing
            </p>
          </div>
        )}

        {/* Footer */}
        <div className={cn(
          "mt-3 flex items-center justify-between gap-2 border-t pt-2.5",
          isShortVideo ? "border-violet-500/20" : "border-border/50",
        )}>
          <div className="flex items-center gap-1 min-w-0">
            <p className="text-[11px] text-muted-foreground">{ago}</p>
            {asset.is_starred && (
              <Star className="ml-1 h-3 w-3 fill-amber-400 text-amber-400" />
            )}
          </div>

          {/* CTA */}
          {hasWorkspace ? (
            <button
              type="button"
              onClick={handleOpenWorkspace}
              className="flex shrink-0 items-center gap-1 rounded-md bg-violet-600 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-violet-700 transition-colors"
            >
              Open project <ArrowRight className="h-3 w-3" />
            </button>
          ) : isShortVideo ? (
            <span className="flex shrink-0 items-center gap-1 rounded-md border border-violet-500/30 bg-violet-500/10 px-2 py-1 text-[11px] font-medium text-violet-700 dark:text-violet-300">
              <Clapperboard className="h-3 w-3" />
              Video Script
            </span>
          ) : (
            <a
              href="/ai/publish"
              className="flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
            >
              Add to queue <Send className="h-3 w-3" />
            </a>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
