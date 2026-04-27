"use client";

import { useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Trash2, Loader2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";

/**
 * Delete-archive confirmation button.
 *
 * Server component (the summary page) renders this for each archive
 * row. We POST to DELETE /api/streams/[streamId]/archive/[archiveId]
 * with no body — the route handles auth + R2 hard-delete + DB
 * soft-delete in a single transaction-ish flow.
 *
 * After success we call router.refresh() instead of replacing in
 * place, because the parent page also needs to re-render the empty
 * state, the "Cloud copies" stat, and (if applicable) the
 * streams.recording_url cleared from another card. A full server
 * re-fetch keeps every section in sync without prop-drilling.
 */
export function DeleteArchiveButton({
  streamId,
  archiveId,
  size = "sm",
}: {
  streamId: string;
  archiveId: string;
  size?: "sm" | "default";
}) {
  const [pending, setPending] = useState(false);
  const router = useRouter();

  async function confirm() {
    setPending(true);
    try {
      const res = await fetch(
        `/api/streams/${encodeURIComponent(streamId)}/archive/${encodeURIComponent(
          archiveId,
        )}`,
        { method: "DELETE" },
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          (json as { error?: string }).error ?? "Failed to delete archive.",
        );
      }
      toast.success("Archive deleted.");
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Delete failed.");
    } finally {
      setPending(false);
    }
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button
          variant="ghost"
          size={size}
          className="h-7 px-2 text-muted-foreground hover:text-destructive"
          title="Delete archive permanently"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-500" />
            Delete this recording?
          </AlertDialogTitle>
          <AlertDialogDescription className="space-y-2">
            <span className="block">
              The video file will be permanently removed from cloud storage
              and any links to it will stop working.
            </span>
            <span className="block">
              This cannot be undone. If you've already published it to
              YouTube, that copy is unaffected.
            </span>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={confirm}
            disabled={pending}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {pending ? (
              <>
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                Deleting…
              </>
            ) : (
              <>
                <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                Delete permanently
              </>
            )}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
