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
} from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Post-stream choice dialog.
 *
 * Shown immediately after `handleEndStream` resolves with a recording.
 * Behaviour:
 *   - Calls /api/host/storage/status to learn whether cloud archive is
 *     reachable for this host (server config + plan check).
 *   - Renders three primary actions:
 *       Save to cloud    — gated; runs the upload flow when allowed
 *       Download to device — re-trigger the local .webm save
 *       Skip             — close the dialog with no archive
 *   - When cloud_archive is in the host's plan but R2 is server-side
 *     unconfigured, shows an info notice so admins know to set the
 *     secrets. When the host is on a plan WITHOUT cloud_archive, shows
 *     an upgrade prompt.
 *
 * Upload protocol (see /api/streams/[id]/archive/start + finalize):
 *   1. POST archive/start with { contentType } → presigned PUT URL
 *   2. fetch(uploadUrl, { method: 'PUT', headers, body: blob })
 *   3. POST archive/[archiveId]/finalize with { success, byteSize }
 */

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  streamId: string;
  blob: Blob | null;
  /** When true, the dialog mentions a successful local download. */
  alreadyDownloaded: boolean;
  /** Called by Download button to re-run the local save. */
  onDownloadLocal: () => void;
}

interface StatusResp {
  serverConfigured: boolean;
  planAllows: boolean;
  available: boolean;
  planSlug: string | null;
}

type Phase = "idle" | "starting" | "uploading" | "finalizing" | "done" | "error";

export function PostStreamDialog({
  open,
  onOpenChange,
  streamId,
  blob,
  alreadyDownloaded,
  onDownloadLocal,
}: Props) {
  const [status, setStatus] = useState<StatusResp | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState(0);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [archiveUrl, setArchiveUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setPhase("idle");
    setProgress(0);
    setErrorMsg(null);
    setArchiveUrl(null);
    fetch("/api/host/storage/status", { cache: "no-store" })
      .then((r) => r.json())
      .then((j: StatusResp & { error?: string }) => {
        if ((j as { error?: string }).error) {
          throw new Error((j as { error?: string }).error);
        }
        setStatus(j);
      })
      .catch((e) => {
        console.error("[post-stream] status check failed:", e);
        setStatus({
          serverConfigured: false,
          planAllows: false,
          available: false,
          planSlug: null,
        });
      });
  }, [open]);

  async function uploadToCloud() {
    if (!blob) {
      setErrorMsg("No recording in memory.");
      return;
    }
    setErrorMsg(null);
    setProgress(0);
    setPhase("starting");

    // 1. Get presigned URL.
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
      const msg = e instanceof Error ? e.message : "Could not start upload.";
      setErrorMsg(msg);
      setPhase("error");
      return;
    }

    // 2. PUT to R2 with progress.
    setPhase("uploading");
    try {
      await putWithProgress(startResp.uploadUrl, startResp.headers, blob, (p) =>
        setProgress(p),
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Upload failed.";
      setErrorMsg(msg);
      setPhase("error");
      // Tell the server it failed so the row gets cleaned up.
      fetch(`/api/streams/${streamId}/archive/${startResp.archiveId}/finalize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ success: false, failureReason: msg }),
      }).catch(() => {});
      return;
    }

    // 3. Finalize.
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
      const msg = e instanceof Error ? e.message : "Finalize failed.";
      setErrorMsg(msg);
      setPhase("error");
      return;
    }

    setPhase("done");
    setArchiveUrl(startResp.publicUrl);
    toast.success("Stream archived to the cloud.");
  }

  const sizeMb = blob ? (blob.size / (1024 * 1024)).toFixed(1) : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <CheckCircle2 className="h-4 w-4 text-emerald-500" />
            Stream ended
          </DialogTitle>
          <DialogDescription className="text-xs">
            {alreadyDownloaded
              ? "Your recording downloaded to this device. Save a cloud copy too?"
              : "Choose what to do with the recording."}
          </DialogDescription>
        </DialogHeader>

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

        {/* Cloud upload state */}
        {phase === "idle" || phase === "error" ? (
          <CloudCta
            status={status}
            blob={blob}
            onUpload={uploadToCloud}
            errorMsg={errorMsg}
          />
        ) : phase === "done" ? (
          <SuccessPanel archiveUrl={archiveUrl} />
        ) : (
          <UploadProgress phase={phase} progress={progress} />
        )}

        <DialogFooter className="flex flex-wrap gap-2 sm:flex-nowrap">
          {phase === "idle" || phase === "error" || phase === "done" ? (
            <>
              <Button
                variant="outline"
                onClick={onDownloadLocal}
                disabled={!blob}
                className="flex-1 sm:flex-none"
              >
                <Download className="mr-2 h-4 w-4" />
                {alreadyDownloaded ? "Download again" : "Download"}
              </Button>
              <Button
                variant="ghost"
                onClick={() => onOpenChange(false)}
                className="flex-1 sm:flex-none"
              >
                <X className="mr-2 h-4 w-4" />
                {phase === "done" ? "Close" : "Skip"}
              </Button>
            </>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CloudCta({
  status,
  blob,
  onUpload,
  errorMsg,
}: {
  status: StatusResp | null;
  blob: Blob | null;
  onUpload: () => void;
  errorMsg: string | null;
}) {
  if (!status) {
    return (
      <div className="rounded-lg border border-border bg-muted/30 p-4 text-center text-xs text-muted-foreground">
        Checking cloud archive availability…
      </div>
    );
  }

  // Plan disallows: upgrade prompt.
  if (!status.planAllows) {
    return (
      <div className="space-y-3 rounded-lg border border-primary/30 bg-primary/5 p-4">
        <div className="flex items-start gap-2.5">
          <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          <div className="text-sm">
            <div className="font-medium text-foreground">
              Cloud archive is a Pro feature
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Save your recording to permanent cloud storage and share a link
              instead of a multi-GB file. Upgrade anytime from your dashboard.
            </p>
          </div>
        </div>
        <Button
          variant="outline"
          className="w-full"
          onClick={() => {
            window.location.href = "/host/dashboard?upgrade=cloud_archive";
          }}
        >
          See plans
          <ArrowUpRight className="ml-1 h-3.5 w-3.5" />
        </Button>
      </div>
    );
  }

  // Server-side R2 not bound.
  if (!status.serverConfigured) {
    return (
      <Alert variant="destructive" className="py-3">
        <AlertTriangle className="h-4 w-4" />
        <AlertDescription className="text-xs">
          Cloud archive is in your plan but the server hasn't been configured
          with R2 credentials yet. Ask the admin to add the
          <code className="mx-1 rounded bg-muted px-1 py-0.5 font-mono text-[10px]">
            R2_*
          </code>
          secrets on Cloudflare.
        </AlertDescription>
      </Alert>
    );
  }

  // Available.
  return (
    <div className="space-y-3">
      <Button
        onClick={onUpload}
        disabled={!blob}
        className="w-full"
        size="lg"
      >
        <Cloud className="mr-2 h-4 w-4" />
        Save to cloud archive
      </Button>
      {errorMsg ? (
        <Alert variant="destructive" className="py-2">
          <AlertDescription className="text-xs">{errorMsg}</AlertDescription>
        </Alert>
      ) : (
        <p className="text-center text-[11px] text-muted-foreground">
          Uploads directly to your R2 bucket — keep this tab open until done.
        </p>
      )}
    </div>
  );
}

function UploadProgress({
  phase,
  progress,
}: {
  phase: Phase;
  progress: number;
}) {
  const label =
    phase === "starting"
      ? "Preparing upload…"
      : phase === "uploading"
        ? `Uploading… ${Math.round(progress)}%`
        : "Finalising…";
  return (
    <div className="space-y-3 rounded-lg border border-border bg-muted/30 p-4">
      <div className="flex items-center gap-2 text-sm">
        <Loader2 className="h-4 w-4 animate-spin" />
        {label}
      </div>
      <Progress value={progress} />
      <p className="text-[11px] text-muted-foreground">
        Don't close this tab until the upload finishes.
      </p>
    </div>
  );
}

function SuccessPanel({ archiveUrl }: { archiveUrl: string | null }) {
  return (
    <div
      className={cn(
        "space-y-3 rounded-lg border p-4",
        "border-emerald-500/30 bg-emerald-500/5",
      )}
    >
      <div className="flex items-center gap-2 text-sm font-medium text-emerald-700 dark:text-emerald-300">
        <CheckCircle2 className="h-4 w-4" />
        Saved to the cloud
      </div>
      {archiveUrl ? (
        <div className="space-y-1.5">
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
            Public URL
          </div>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded bg-muted px-2 py-1 font-mono text-[11px]">
              {archiveUrl}
            </code>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                navigator.clipboard.writeText(archiveUrl);
                toast.success("URL copied.");
              }}
            >
              Copy
            </Button>
            <Button variant="outline" size="sm" asChild>
              <a href={archiveUrl} target="_blank" rel="noreferrer">
                Open
                <ArrowUpRight className="ml-1 h-3 w-3" />
              </a>
            </Button>
          </div>
        </div>
      ) : (
        <Badge variant="outline" className="text-xs">
          Private bucket — visible from your dashboard
        </Badge>
      )}
    </div>
  );
}

/**
 * PUT a Blob with progress reporting via XMLHttpRequest. fetch() does
 * not expose upload progress events on any browser, so XHR is the
 * canonical workaround. Returns once the upload either succeeds (2xx)
 * or fails — never resolves with an error response code.
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
            `Upload failed with HTTP ${xhr.status}: ${xhr.responseText.slice(
              0,
              200,
            )}`,
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
