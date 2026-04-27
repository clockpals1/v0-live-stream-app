"use client";

import { useState } from "react";
import { toast } from "sonner";
import {
  Youtube,
  Download,
  Upload,
  CheckCircle2,
  XCircle,
  Clock,
  Video,
  ExternalLink,
  Lock,
  Wifi,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { pushArchiveToYoutube } from "@/lib/distribution/youtube-push";
import type { ReplayItem } from "@/lib/studio/replay/queries";

interface YoutubeConnection {
  providerAccountId: string | null;
  providerAccountName: string | null;
  providerAccountAvatarUrl: string | null;
  connectedAt: string;
}

export interface DistributionHubProps {
  archives: ReplayItem[];
  youtubeConnected: YoutubeConnection | null;
  youtubeServerConfigured: boolean;
  canYoutube: boolean;
  canDownload: boolean;
}

type PushPhase = "idle" | "init" | "download" | "upload" | "done" | "error";

interface PushState {
  archiveId: string;
  phase: PushPhase;
  downloadPct: number;
  uploadPct: number;
  error: string | null;
}

function formatBytes(bytes: number): string {
  if (!bytes) return "—";
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

// ─── YouTube Push Dialog ──────────────────────────────────────────────

function YoutubePushDialog({
  archive,
  canYoutube,
  youtubeConnected,
  pushState,
  onPush,
}: {
  archive: ReplayItem;
  canYoutube: boolean;
  youtubeConnected: YoutubeConnection | null;
  pushState: PushState | null;
  onPush: (opts: { title: string; description: string; privacy: "private" | "unlisted" | "public" }) => void;
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(archive.streamTitle);
  const [description, setDescription] = useState("");
  const [privacy, setPrivacy] = useState<"private" | "unlisted" | "public">("private");

  const isPushing = pushState !== null && pushState.phase !== "idle" && pushState.phase !== "done" && pushState.phase !== "error";
  const isDone = pushState?.phase === "done";

  const handleSubmit = () => {
    onPush({ title, description, privacy });
    setOpen(false);
  };

  if (!canYoutube) {
    return (
      <Button size="sm" variant="outline" disabled className="gap-1.5 text-xs">
        <Lock className="h-3 w-3" />
        YouTube
      </Button>
    );
  }

  if (!youtubeConnected) {
    return (
      <Button
        size="sm"
        variant="outline"
        className="gap-1.5 text-xs text-muted-foreground"
        onClick={() => { window.location.href = "/api/integrations/youtube/connect"; }}
      >
        <Youtube className="h-3 w-3" />
        Connect first
      </Button>
    );
  }

  if (isDone) {
    return (
      <Button size="sm" variant="outline" className="gap-1.5 text-xs text-emerald-600 dark:text-emerald-400" disabled>
        <CheckCircle2 className="h-3 w-3" />
        Pushed
      </Button>
    );
  }

  if (isPushing) {
    const pct = pushState!.phase === "download"
      ? Math.round(pushState!.downloadPct * 50)
      : 50 + Math.round(pushState!.uploadPct * 50);
    return (
      <div className="flex min-w-[120px] flex-col gap-1">
        <div className="flex items-center justify-between text-[10px] text-muted-foreground">
          <span>{pushState!.phase === "download" ? "Downloading…" : pushState!.phase === "upload" ? "Uploading…" : "Starting…"}</span>
          <span>{pct}%</span>
        </div>
        <Progress value={pct} className="h-1.5" />
      </div>
    );
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className="gap-1.5 text-xs">
          <Youtube className="h-3 w-3 text-rose-500" />
          Push to YouTube
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Youtube className="h-4 w-4 text-rose-500" />
            Push to YouTube
          </DialogTitle>
          <DialogDescription>
            Upload this recording to{" "}
            <span className="font-medium text-foreground">
              {youtubeConnected.providerAccountName ?? "your channel"}
            </span>
            . It starts as Private — you can change it on YouTube.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="yt-title">Video title</Label>
            <Input
              id="yt-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={100}
              placeholder="Stream recording title"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="yt-desc">Description <span className="text-muted-foreground">(optional)</span></Label>
            <Textarea
              id="yt-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              maxLength={1000}
              placeholder="Add a description for this video…"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Privacy</Label>
            <Select value={privacy} onValueChange={(v) => setPrivacy(v as typeof privacy)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="private">Private</SelectItem>
                <SelectItem value="unlisted">Unlisted</SelectItem>
                <SelectItem value="public">Public</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <p className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
            <AlertTriangle className="mr-1 inline h-3 w-3" />
            Keep this tab open while the recording uploads. Large files can take several minutes.
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button
            className="bg-rose-600 text-white hover:bg-rose-700"
            onClick={handleSubmit}
            disabled={!title.trim()}
          >
            <Upload className="mr-2 h-4 w-4" />
            Start upload
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Archive Row ──────────────────────────────────────────────────────

function ArchiveRow({
  archive,
  canYoutube,
  canDownload,
  youtubeConnected,
  pushState,
  onPush,
}: {
  archive: ReplayItem;
  canYoutube: boolean;
  canDownload: boolean;
  youtubeConnected: YoutubeConnection | null;
  pushState: PushState | null;
  onPush: (opts: { title: string; description: string; privacy: "private" | "unlisted" | "public" }) => void;
}) {
  const [downloading, setDownloading] = useState(false);

  const handleDownload = async () => {
    setDownloading(true);
    try {
      const res = await fetch(`/api/host/archives/${archive.archiveId}/download`);
      const json = (await res.json()) as { url?: string; error?: string };
      if (!res.ok || !json.url) {
        toast.error(json.error ?? "Couldn't get download link.");
        return;
      }
      const a = document.createElement("a");
      a.href = json.url;
      a.download = `${archive.streamTitle}.webm`;
      a.click();
    } catch {
      toast.error("Download failed. Try again.");
    } finally {
      setDownloading(false);
    }
  };

  const isError = pushState?.phase === "error";

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4 sm:flex-row sm:items-center sm:gap-4">
      {/* Icon */}
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted">
        <Video className="h-5 w-5 text-muted-foreground" />
      </div>

      {/* Info */}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate text-sm font-medium">{archive.streamTitle}</span>
          {archive.publication?.isPublished && (
            <Badge variant="outline" className="border-emerald-500/40 text-emerald-600 dark:text-emerald-400 text-[10px]">
              Published
            </Badge>
          )}
          {archive.archiveExpired && (
            <Badge variant="outline" className="border-destructive/40 text-destructive text-[10px]">
              Expired
            </Badge>
          )}
        </div>
        <div className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <Clock className="h-3 w-3" />
            {formatDate(archive.archivedAt)}
          </span>
          <span>{formatBytes(archive.sizeBytes)}</span>
          {archive.publication && (
            <a
              href={`/r/${archive.publication.id}`}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-0.5 hover:text-foreground hover:underline"
            >
              View replay
              <ExternalLink className="h-2.5 w-2.5" />
            </a>
          )}
        </div>
        {isError && (
          <p className="mt-1 text-xs text-destructive">
            <XCircle className="mr-0.5 inline h-3 w-3" />
            {pushState!.error}
          </p>
        )}
      </div>

      {/* Actions */}
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        {!archive.archiveExpired && canDownload && (
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5 text-xs"
            onClick={handleDownload}
            disabled={downloading}
          >
            <Download className="h-3 w-3" />
            {downloading ? "Getting link…" : "Download"}
          </Button>
        )}
        {!archive.archiveExpired && (
          <YoutubePushDialog
            archive={archive}
            canYoutube={canYoutube}
            youtubeConnected={youtubeConnected}
            pushState={pushState}
            onPush={onPush}
          />
        )}
      </div>
    </div>
  );
}

// ─── Destination Card (locked) ────────────────────────────────────────

function LockedDestinationCard({ name, icon, description }: { name: string; icon: React.ReactNode; description: string }) {
  return (
    <Card className="opacity-60">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center justify-between text-base">
          <span className="flex items-center gap-2">
            {icon}
            {name}
          </span>
          <Badge variant="outline" className="text-[10px] text-muted-foreground">
            Coming soon
          </Badge>
        </CardTitle>
        <CardDescription className="text-xs">{description}</CardDescription>
      </CardHeader>
      <CardContent>
        <Button variant="outline" className="w-full" disabled>
          <Lock className="mr-2 h-4 w-4" />
          Not yet available
        </Button>
      </CardContent>
    </Card>
  );
}

// ─── Main Hub View ────────────────────────────────────────────────────

export function DistributionHubView({
  archives,
  youtubeConnected,
  youtubeServerConfigured,
  canYoutube,
  canDownload,
}: DistributionHubProps) {
  const [pushStates, setPushStates] = useState<Record<string, PushState>>({});
  const [showAll, setShowAll] = useState(false);

  const readyArchives = archives.filter((a) => !a.archiveExpired);
  const expiredArchives = archives.filter((a) => a.archiveExpired);
  const visibleArchives = showAll ? readyArchives : readyArchives.slice(0, 6);

  const handlePush = async (
    archive: ReplayItem,
    opts: { title: string; description: string; privacy: "private" | "unlisted" | "public" },
  ) => {
    const id = archive.archiveId;
    const setPhase = (phase: PushPhase, extra?: Partial<PushState>) =>
      setPushStates((s) => {
        const prev = s[id] ?? { archiveId: id, phase: "idle" as PushPhase, downloadPct: 0, uploadPct: 0, error: null };
        return { ...s, [id]: { ...prev, phase, downloadPct: 0, uploadPct: 0, error: null, ...extra } };
      });

    setPhase("init");

    const result = await pushArchiveToYoutube({
      archiveId: id,
      title: opts.title,
      description: opts.description,
      privacyStatus: opts.privacy,
      onDownloadProgress: (f) => setPhase("download", { downloadPct: f }),
      onUploadProgress: (f) => setPhase("upload", { uploadPct: f }),
    });

    if (result.status === "pushed") {
      setPhase("done");
      toast.success(`"${opts.title}" is uploading to YouTube. Check your YouTube Studio for status.`, { duration: 8000 });
    } else {
      setPhase("error", { error: result.message });
      toast.error(`YouTube push failed: ${result.message}`);
    }
  };

  return (
    <div className="space-y-10">
      {/* ─── Destinations ─────────────────────────────────────────── */}
      <section>
        <h2 className="mb-4 text-lg font-semibold tracking-tight">Destinations</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {/* YouTube */}
          <Card className={cn(youtubeConnected ? "border-emerald-500/30" : "")}>
            <CardHeader className="pb-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Youtube className="h-4 w-4 text-rose-500" />
                    YouTube
                  </CardTitle>
                  <CardDescription className="mt-1 text-xs">
                    Push recordings directly to your YouTube channel.
                  </CardDescription>
                </div>
                {youtubeConnected ? (
                  <Badge className="shrink-0 border-0 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 text-[10px]">
                    <CheckCircle2 className="mr-1 h-3 w-3" />
                    Connected
                  </Badge>
                ) : (
                  <Badge variant="outline" className="shrink-0 text-[10px] text-muted-foreground">
                    Not connected
                  </Badge>
                )}
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {youtubeConnected ? (
                <div className="flex items-center gap-2.5 rounded-lg border border-border bg-muted/30 px-3 py-2">
                  {youtubeConnected.providerAccountAvatarUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={youtubeConnected.providerAccountAvatarUrl}
                      alt=""
                      className="h-7 w-7 shrink-0 rounded-full border border-border"
                    />
                  ) : (
                    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted">
                      <Youtube className="h-3.5 w-3.5 text-muted-foreground" />
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs font-medium">
                      {youtubeConnected.providerAccountName ?? "Connected"}
                    </div>
                    {youtubeConnected.providerAccountId && (
                      <a
                        href={`https://www.youtube.com/channel/${youtubeConnected.providerAccountId}`}
                        target="_blank"
                        rel="noreferrer"
                        className="flex items-center gap-0.5 text-[10px] text-muted-foreground hover:underline"
                      >
                        Open channel
                        <ExternalLink className="h-2.5 w-2.5" />
                      </a>
                    )}
                  </div>
                </div>
              ) : !canYoutube ? (
                <div className="rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-xs">
                  YouTube push is a paid feature. Upgrade to enable it.
                </div>
              ) : !youtubeServerConfigured ? (
                <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
                  <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                  Server not configured. Ask admin to set GOOGLE_* secrets.
                </div>
              ) : null}
              {canYoutube && youtubeServerConfigured && !youtubeConnected && (
                <Button
                  className="w-full bg-rose-600 text-white hover:bg-rose-700"
                  size="sm"
                  onClick={() => { window.location.href = "/api/integrations/youtube/connect"; }}
                >
                  Connect YouTube
                </Button>
              )}
              {youtubeConnected && (
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full text-muted-foreground"
                  onClick={() => { window.location.href = "/host/settings?tab=integrations"; }}
                >
                  Manage in Settings
                </Button>
              )}
            </CardContent>
          </Card>

          {/* Vimeo — locked */}
          <LockedDestinationCard
            name="Vimeo"
            icon={<Wifi className="h-4 w-4 text-sky-500" />}
            description="Publish directly to your Vimeo library with privacy controls."
          />

          {/* Custom RTMP — locked */}
          <LockedDestinationCard
            name="Custom RTMP"
            icon={<Video className="h-4 w-4 text-violet-500" />}
            description="Push to any RTMP-compatible destination: Wowza, Mux, and more."
          />
        </div>
      </section>

      {/* ─── Recordings ───────────────────────────────────────────── */}
      <section>
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold tracking-tight">Recordings</h2>
            <p className="text-sm text-muted-foreground">
              {readyArchives.length} recording{readyArchives.length !== 1 ? "s" : ""} available
              {expiredArchives.length > 0 && ` · ${expiredArchives.length} expired`}
            </p>
          </div>
        </div>

        {readyArchives.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
                <Video className="h-6 w-6 text-muted-foreground" />
              </div>
              <div>
                <p className="text-sm font-medium">No recordings yet</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Your recordings will appear here after you end a stream and save the archive.
                </p>
              </div>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {visibleArchives.map((archive) => (
              <ArchiveRow
                key={archive.archiveId}
                archive={archive}
                canYoutube={canYoutube}
                canDownload={canDownload}
                youtubeConnected={youtubeConnected}
                pushState={pushStates[archive.archiveId] ?? null}
                onPush={(opts) => handlePush(archive, opts)}
              />
            ))}
            {readyArchives.length > 6 && (
              <Button
                variant="ghost"
                size="sm"
                className="w-full text-muted-foreground"
                onClick={() => setShowAll((v) => !v)}
              >
                {showAll ? (
                  <><ChevronUp className="mr-1 h-3.5 w-3.5" /> Show less</>
                ) : (
                  <><ChevronDown className="mr-1 h-3.5 w-3.5" /> Show {readyArchives.length - 6} more</>
                )}
              </Button>
            )}
          </div>
        )}
      </section>

      {/* ─── Export note ──────────────────────────────────────────── */}
      <section className="rounded-xl border border-border bg-muted/30 px-5 py-4">
        <div className="flex items-start gap-3">
          <Download className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          <div>
            <p className="text-sm font-medium">One-off exports</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Use the <strong>Download</strong> button on any recording to get a direct link to the raw file — 
              share it with sponsors, clients, or editors without publishing a public replay.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
