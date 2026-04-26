"use client";

import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { toast } from "sonner";
import {
  Cloud,
  Download,
  X,
  Sparkles,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  ArrowUpRight,
  Youtube,
  Link as LinkIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Post-stream dialog.
 *
 * Two independent destination cards, side-by-side on desktop, stacked
 * on mobile. Each card has its own state machine and progress bar so
 * the host can run them in parallel or in sequence — pick whatever
 * order suits them. Sharing one blob across destinations is fine
 * since reading a Blob is non-destructive (multiple PUTs are allowed
 * concurrently from the same Blob handle).
 *
 * Destinations:
 *   1. Cloud archive (R2) — presigned PUT to our bucket. Plan-gated by
 *      the cloud_archive feature flag.
 *   2. YouTube — resumable session URL. Plan-gated by youtube_upload
 *      AND requires the host to have connected their channel from the
 *      dashboard's YouTube card.
 *
 * Local download still happens automatically before the dialog opens
 * (see stream-interface.tsx). The dialog also offers a "Download
 * again" button as a backup.
 */

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  streamId: string;
  streamTitle?: string | null;
  blob: Blob | null;
  alreadyDownloaded: boolean;
  onDownloadLocal: () => void;
}

export function PostStreamDialog({
  open,
  onOpenChange,
  streamId,
  streamTitle,
  blob,
  alreadyDownloaded,
  onDownloadLocal,
}: Props) {
  const sizeMb = blob ? (blob.size / (1024 * 1024)).toFixed(1) : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] gap-0 overflow-hidden p-0 sm:max-w-2xl">
        <DialogHeader className="space-y-1 border-b border-border bg-muted/30 px-6 py-4 text-left">
          <DialogTitle className="flex items-center gap-2 text-base">
            <CheckCircle2 className="h-4 w-4 text-emerald-500" />
            Stream ended
          </DialogTitle>
          <DialogDescription className="text-xs">
            {alreadyDownloaded
              ? "Your recording downloaded to this device. Save copies to the cloud or YouTube too."
              : "Choose what to do with the recording."}
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[calc(90vh-9rem)] space-y-4 overflow-y-auto p-6">
          {/* Recording summary */}
          {blob ? (
            <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/30 px-4 py-2.5">
              <div className="text-xs text-muted-foreground">Recording</div>
              <div className="font-mono text-sm font-medium">
                {sizeMb} MB <span className="text-muted-foreground">·</span>{" "}
                {blob.type || "video/webm"}
              </div>
            </div>
          ) : null}

          {/* Side-by-side destination cards. Stack on mobile. */}
          <div className="grid gap-4 sm:grid-cols-2">
            <CloudArchiveCard streamId={streamId} blob={blob} />
            <YoutubeCard
              streamId={streamId}
              streamTitle={streamTitle ?? null}
              blob={blob}
            />
          </div>
        </div>

        <DialogFooter className="border-t border-border bg-muted/30 px-6 py-3">
          <Button
            variant="outline"
            onClick={onDownloadLocal}
            disabled={!blob}
            className="flex-1 sm:flex-none"
          >
            <Download className="mr-2 h-4 w-4" />
            {alreadyDownloaded ? "Download again" : "Download"}
          </Button>
          {/* Summary link \u2014 lets the host bookmark or revisit a
              permanent recap of this stream's cloud + YouTube state. */}
          <Button
            variant="outline"
            asChild
            className="flex-1 sm:flex-none"
          >
            <a href={`/host/streams/${streamId}/summary`}>
              <ArrowUpRight className="mr-2 h-4 w-4" />
              View summary
            </a>
          </Button>
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            className="flex-1 sm:flex-none"
          >
            <X className="mr-2 h-4 w-4" />
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ────────────────────────────────────────────────────────────────────
// Cloud Archive (R2)
// ────────────────────────────────────────────────────────────────────

interface CloudStatusResp {
  serverConfigured: boolean;
  planAllows: boolean;
  available: boolean;
}

type Phase = "idle" | "starting" | "uploading" | "finalizing" | "done" | "error";

function CloudArchiveCard({
  streamId,
  blob,
}: {
  streamId: string;
  blob: Blob | null;
}) {
  const [status, setStatus] = useState<CloudStatusResp | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState(0);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [archiveUrl, setArchiveUrl] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/host/storage/status", { cache: "no-store" })
      .then((r) => r.json())
      .then((j: CloudStatusResp & { error?: string }) => {
        if (j.error) throw new Error(j.error);
        setStatus(j);
      })
      .catch(() =>
        setStatus({
          serverConfigured: false,
          planAllows: false,
          available: false,
        }),
      );
  }, []);

  async function uploadToCloud() {
    if (!blob) return;
    setErrorMsg(null);
    setProgress(0);
    setPhase("starting");
    let startResp: {
      archiveId: string;
      uploadUrl: string;
      headers: Record<string, string>;
      publicUrl: string | null;
    };
    try {
      const res = await fetch(`/api/streams/${streamId}/archive/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contentType: blob.type || "video/webm" }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Could not start upload.");
      startResp = json;
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "Could not start upload.");
      setPhase("error");
      return;
    }
    setPhase("uploading");
    try {
      await putWithProgress(
        startResp.uploadUrl,
        startResp.headers,
        blob,
        (p) => setProgress(p),
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Upload failed.";
      setErrorMsg(msg);
      setPhase("error");
      fetch(`/api/streams/${streamId}/archive/${startResp.archiveId}/finalize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ success: false, failureReason: msg }),
      }).catch(() => {});
      return;
    }
    setPhase("finalizing");
    try {
      const res = await fetch(
        `/api/streams/${streamId}/archive/${startResp.archiveId}/finalize`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ success: true, byteSize: blob.size }),
        },
      );
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Finalize failed.");
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "Finalize failed.");
      setPhase("error");
      return;
    }
    setPhase("done");
    setArchiveUrl(startResp.publicUrl);
    toast.success("Stream archived to the cloud.");
  }

  return (
    <DestCard
      icon={<Cloud className="h-4 w-4 text-sky-500" />}
      title="Cloud archive"
      description="Permanent copy in your R2 bucket."
      status={status}
      planLabel="Cloud archive is a paid feature"
      planDescription="Save unlimited recordings to durable storage and share a permanent URL."
      phase={phase}
      progress={progress}
      errorMsg={errorMsg}
      onUpload={uploadToCloud}
      uploadLabel="Save to cloud archive"
      blob={blob}
      doneSuccess={
        <SuccessLink
          label="Public URL"
          url={archiveUrl}
          fallback="Saved to your private bucket"
        />
      }
    />
  );
}

// ────────────────────────────────────────────────────────────────────
// YouTube
// ────────────────────────────────────────────────────────────────────

interface YtStatusResp {
  serverConfigured: boolean;
  planAllows: boolean;
  available: boolean;
  connected: null | {
    providerAccountName: string | null;
    providerAccountAvatarUrl: string | null;
  };
}

function YoutubeCard({
  streamId,
  streamTitle,
  blob,
}: {
  streamId: string;
  streamTitle: string | null;
  blob: Blob | null;
}) {
  const [status, setStatus] = useState<YtStatusResp | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState(0);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [watchUrl, setWatchUrl] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/host/integrations/youtube/status", { cache: "no-store" })
      .then((r) => r.json())
      .then((j: YtStatusResp & { error?: string }) => {
        if (j.error) throw new Error(j.error);
        setStatus(j);
      })
      .catch(() =>
        setStatus({
          serverConfigured: false,
          planAllows: false,
          available: false,
          connected: null,
        }),
      );
  }, []);

  async function uploadToYouTube() {
    if (!blob) return;
    setErrorMsg(null);
    setProgress(0);
    setPhase("starting");

    // 1. Start session.
    let session: { uploadUrl: string; contentType: string };
    try {
      const res = await fetch(`/api/streams/${streamId}/youtube/upload`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contentType: blob.type || "video/webm",
          contentLength: blob.size,
          title: streamTitle ?? "Stream recording",
          privacyStatus: "private",
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Could not start upload.");
      session = json;
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "Could not start upload.");
      setPhase("error");
      return;
    }

    // 2. PUT bytes to YouTube's resumable URL.
    setPhase("uploading");
    let videoId: string;
    try {
      videoId = await putToYoutube(
        session.uploadUrl,
        session.contentType,
        blob,
        (p) => setProgress(p),
      );
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "Upload failed.");
      setPhase("error");
      return;
    }

    // 3. Persist the video id on our side.
    setPhase("finalizing");
    try {
      const res = await fetch(`/api/streams/${streamId}/youtube/finalize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ videoId }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Finalize failed.");
      setWatchUrl(json.watchUrl);
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "Finalize failed.");
      setPhase("error");
      return;
    }

    setPhase("done");
    toast.success("Uploaded to YouTube as a private video.");
  }

  // Special-case "available but not connected" — render a Connect prompt
  // instead of a generic gated card.
  if (status && status.available && !status.connected) {
    return (
      <div className="flex flex-col rounded-xl border border-border p-4">
        <div className="flex items-center gap-2">
          <Youtube className="h-4 w-4 text-rose-500" />
          <div className="text-sm font-semibold tracking-tight">YouTube</div>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          Publish recordings to your channel.
        </p>
        <div className="mt-4 flex flex-1 flex-col justify-end">
          <Button
            className="w-full bg-rose-600 text-white hover:bg-rose-700"
            onClick={() => {
              window.location.href = "/api/integrations/youtube/connect";
            }}
          >
            <LinkIcon className="mr-2 h-4 w-4" />
            Connect YouTube
          </Button>
          <p className="mt-2 text-center text-[11px] text-muted-foreground">
            You'll be redirected to Google to grant upload access.
          </p>
        </div>
      </div>
    );
  }

  return (
    <DestCard
      icon={<Youtube className="h-4 w-4 text-rose-500" />}
      title="YouTube"
      description={
        status?.connected?.providerAccountName
          ? `Will publish privately to ${status.connected.providerAccountName}.`
          : "Publish to your connected channel."
      }
      status={status}
      planLabel="YouTube upload is a paid feature"
      planDescription="One-click publishing to your channel — uploaded as private; you choose when to make it public."
      phase={phase}
      progress={progress}
      errorMsg={errorMsg}
      onUpload={uploadToYouTube}
      uploadLabel="Upload to YouTube"
      blob={blob}
      doneSuccess={
        <SuccessLink
          label="Watch URL (private)"
          url={watchUrl}
          fallback="Uploaded as a private video"
        />
      }
    />
  );
}

// ────────────────────────────────────────────────────────────────────
// Shared destination card
// ────────────────────────────────────────────────────────────────────

function DestCard({
  icon,
  title,
  description,
  status,
  planLabel,
  planDescription,
  phase,
  progress,
  errorMsg,
  onUpload,
  uploadLabel,
  blob,
  doneSuccess,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  status:
    | { serverConfigured: boolean; planAllows: boolean; available: boolean }
    | null;
  planLabel: string;
  planDescription: string;
  phase: Phase;
  progress: number;
  errorMsg: string | null;
  onUpload: () => void;
  uploadLabel: string;
  blob: Blob | null;
  doneSuccess: React.ReactNode;
}) {
  const isWorking = phase === "starting" || phase === "uploading" || phase === "finalizing";

  return (
    <div
      className={cn(
        "flex flex-col rounded-xl border p-4 transition",
        phase === "done"
          ? "border-emerald-500/40 bg-emerald-500/5"
          : phase === "error"
            ? "border-rose-500/40 bg-rose-500/5"
            : "border-border",
      )}
    >
      <div className="flex items-center gap-2">
        {icon}
        <div className="text-sm font-semibold tracking-tight">{title}</div>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">{description}</p>

      <div className="mt-4 flex-1">
        {!status ? (
          <div className="rounded-md border border-dashed border-border p-3 text-center text-[11px] text-muted-foreground">
            Checking availability…
          </div>
        ) : !status.planAllows ? (
          <div className="space-y-2 rounded-md border border-primary/30 bg-primary/5 p-3">
            <div className="flex items-start gap-2 text-xs">
              <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
              <div>
                <div className="font-medium text-foreground">{planLabel}</div>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  {planDescription}
                </p>
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="w-full"
              onClick={() => {
                window.location.href = "/host/dashboard?upgrade=feature";
              }}
            >
              See plans
              <ArrowUpRight className="ml-1 h-3 w-3" />
            </Button>
          </div>
        ) : !status.serverConfigured ? (
          <Alert variant="destructive" className="py-2">
            <AlertTriangle className="h-3.5 w-3.5" />
            <AlertDescription className="text-[11px]">
              Server not configured. Ask the admin to add the required
              secrets.
            </AlertDescription>
          </Alert>
        ) : phase === "done" ? (
          doneSuccess
        ) : isWorking ? (
          <div className="space-y-2 rounded-md border border-border bg-muted/30 p-3">
            <div className="flex items-center gap-1.5 text-xs">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              {phase === "starting"
                ? "Preparing…"
                : phase === "uploading"
                  ? `Uploading ${Math.round(progress)}%`
                  : "Finalising…"}
            </div>
            <Progress value={progress} className="h-1.5" />
          </div>
        ) : (
          <div className="space-y-2">
            {errorMsg ? (
              <Alert variant="destructive" className="py-2">
                <AlertDescription className="text-[11px]">
                  {errorMsg}
                </AlertDescription>
              </Alert>
            ) : null}
          </div>
        )}
      </div>

      {/* Action button — only when available + idle/error and we have a blob */}
      {status?.available && phase !== "done" && !isWorking ? (
        <Button onClick={onUpload} disabled={!blob} className="mt-3 w-full">
          {uploadLabel}
        </Button>
      ) : null}
    </div>
  );
}

function SuccessLink({
  label,
  url,
  fallback,
}: {
  label: string;
  url: string | null;
  fallback: string;
}) {
  return (
    <div className="space-y-2 rounded-md border border-emerald-500/30 bg-emerald-500/5 p-3">
      <div className="flex items-center gap-1.5 text-xs font-medium text-emerald-700 dark:text-emerald-300">
        <CheckCircle2 className="h-3.5 w-3.5" />
        Done
      </div>
      {url ? (
        <>
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
            {label}
          </div>
          <div className="flex items-center gap-1">
            <code className="min-w-0 flex-1 truncate rounded bg-muted px-1.5 py-1 font-mono text-[10px]">
              {url}
            </code>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={() => {
                navigator.clipboard.writeText(url);
                toast.success("URL copied.");
              }}
            >
              Copy
            </Button>
            <Button variant="ghost" size="sm" asChild className="h-7 px-2">
              <a href={url} target="_blank" rel="noreferrer">
                <ArrowUpRight className="h-3 w-3" />
              </a>
            </Button>
          </div>
        </>
      ) : (
        <Badge variant="outline" className="text-[10px]">
          {fallback}
        </Badge>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// Upload helpers
// ────────────────────────────────────────────────────────────────────

/**
 * PUT a Blob with progress reporting via XMLHttpRequest. fetch() does
 * not expose upload progress on any browser, so XHR is the canonical
 * workaround. Resolves on 2xx, rejects otherwise.
 */
function putWithProgress(
  url: string,
  headers: Record<string, string>,
  blob: Blob,
  onProgress: (percent: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    for (const [k, v] of Object.entries(headers)) {
      xhr.setRequestHeader(k, v);
    }
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        onProgress(Math.min(99, (e.loaded / e.total) * 100));
      }
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress(100);
        resolve();
      } else {
        reject(
          new Error(
            `Upload failed (HTTP ${xhr.status}): ${xhr.responseText.slice(0, 200)}`,
          ),
        );
      }
    };
    xhr.onerror = () =>
      reject(new Error("Network error during upload. Check your connection."));
    xhr.onabort = () => reject(new Error("Upload was cancelled."));
    xhr.send(blob);
  });
}

/**
 * PUT a Blob to YouTube's resumable session URL. YouTube responds
 * with 200/201 and a JSON video resource on success — we extract the
 * id from there. Same XHR pattern as above for progress events.
 */
function putToYoutube(
  url: string,
  contentType: string,
  blob: Blob,
  onProgress: (percent: number) => void,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("Content-Type", contentType);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        onProgress(Math.min(99, (e.loaded / e.total) * 100));
      }
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress(100);
        try {
          const resource = JSON.parse(xhr.responseText) as { id?: string };
          if (!resource.id) {
            reject(new Error("YouTube response missing video id."));
            return;
          }
          resolve(resource.id);
        } catch {
          reject(new Error("Could not parse YouTube response."));
        }
      } else {
        reject(
          new Error(
            `YouTube upload failed (HTTP ${xhr.status}): ${xhr.responseText.slice(
              0,
              200,
            )}`,
          ),
        );
      }
    };
    xhr.onerror = () =>
      reject(new Error("Network error during YouTube upload."));
    xhr.onabort = () => reject(new Error("Upload was cancelled."));
    xhr.send(blob);
  });
}
