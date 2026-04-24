"use client";

/**
 * Drag-and-drop + file-picker image uploader for the stream overlay.
 *
 * Self-contained module — upload logic, preview, and remove UI all live here.
 * The parent just provides the stream id and receives a public URL via
 * `onUploaded`. No parent state mutation, no Supabase plumbing in the caller.
 *
 * Uploads go to the `stream-overlays` bucket (migration 012). Object path is
 * `{streamId}/{timestamp}-{safeName}` which guarantees uniqueness and keeps
 * all of a stream's overlay images scoped together for easy cleanup.
 */

import { useCallback, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Image as ImageIcon, Upload, X, Loader2 } from "lucide-react";

const MAX_BYTES = 8 * 1024 * 1024; // 8 MB — generous but prevents abuse
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];

interface OverlayImageUploadProps {
  streamId: string;
  /** Current image URL (if any) — shows preview + Remove button when set */
  currentUrl: string;
  /** Called with the new public URL after a successful upload */
  onUploaded: (url: string) => void;
  /** Called when the user clicks Remove on the current image */
  onCleared: () => void;
}

export function OverlayImageUpload({
  streamId,
  currentUrl,
  onUploaded,
  onCleared,
}: OverlayImageUploadProps) {
  const supabaseRef = useRef(createClient());
  const supabase = supabaseRef.current;
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [isDragging, setIsDragging] = useState(false);

  const doUpload = useCallback(
    async (file: File) => {
      if (!ALLOWED_TYPES.includes(file.type)) {
        toast.error("Unsupported format. Use JPG, PNG, WEBP, or GIF.");
        return;
      }
      if (file.size > MAX_BYTES) {
        toast.error(
          `Image is ${(file.size / 1024 / 1024).toFixed(1)} MB — max is ${MAX_BYTES / 1024 / 1024} MB.`
        );
        return;
      }

      setUploading(true);
      setProgress(10);
      try {
        // Safe, unique object path under the stream's folder.
        const ext = file.name.split(".").pop()?.toLowerCase() ?? "bin";
        const safeName = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
        const path = `${streamId}/${safeName}`;

        setProgress(40);
        const { error: upErr } = await supabase.storage
          .from("stream-overlays")
          .upload(path, file, {
            cacheControl: "3600",
            contentType: file.type,
            upsert: false,
          });

        if (upErr) throw upErr;

        setProgress(80);
        const { data: urlData } = supabase.storage
          .from("stream-overlays")
          .getPublicUrl(path);

        if (!urlData?.publicUrl) {
          throw new Error("Could not get public URL for uploaded image");
        }

        setProgress(100);
        onUploaded(urlData.publicUrl);
        toast.success("Image uploaded");
      } catch (err: any) {
        console.error("[overlay-upload] failed:", err);
        toast.error("Upload failed: " + (err?.message ?? "unknown error"));
      } finally {
        setUploading(false);
        setProgress(0);
      }
    },
    [streamId, supabase, onUploaded]
  );

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) doUpload(file);
    // Reset so selecting the same file again re-triggers onChange
    if (inputRef.current) inputRef.current.value = "";
  };

  const onDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) doUpload(file);
  };

  const onDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const onDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  // ── Preview (image already uploaded) ─────────────────────────────────────
  if (currentUrl) {
    return (
      <div className="relative rounded-md border border-border overflow-hidden bg-muted/20">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={currentUrl}
          alt="Overlay image"
          className="w-full max-h-48 object-contain bg-black"
        />
        <div className="flex items-center justify-between gap-2 px-3 py-2 border-t border-border bg-background">
          <span className="text-[11px] text-muted-foreground truncate">
            Image attached to overlay
          </span>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => inputRef.current?.click()}
              disabled={uploading}
            >
              <Upload className="w-3.5 h-3.5 mr-1.5" />
              Replace
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="text-red-500 hover:text-red-600"
              onClick={onCleared}
              disabled={uploading}
            >
              <X className="w-3.5 h-3.5 mr-1.5" />
              Remove
            </Button>
          </div>
        </div>
        <input
          ref={inputRef}
          type="file"
          accept={ALLOWED_TYPES.join(",")}
          onChange={onFileChange}
          className="hidden"
        />
      </div>
    );
  }

  // ── Empty state: drag-drop zone ──────────────────────────────────────────
  return (
    <div
      onDrop={onDrop}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onClick={() => !uploading && inputRef.current?.click()}
      role="button"
      tabIndex={0}
      className={`relative rounded-md border-2 border-dashed p-4 text-center cursor-pointer transition-all ${
        isDragging
          ? "border-primary bg-primary/5"
          : "border-border hover:border-foreground/40 bg-muted/10"
      } ${uploading ? "pointer-events-none opacity-70" : ""}`}
    >
      <input
        ref={inputRef}
        type="file"
        accept={ALLOWED_TYPES.join(",")}
        onChange={onFileChange}
        className="hidden"
      />

      {uploading ? (
        <div className="flex flex-col items-center gap-2 py-2">
          <Loader2 className="w-6 h-6 text-primary animate-spin" />
          <p className="text-xs text-foreground">Uploading… {progress}%</p>
          <div className="w-full max-w-xs h-1.5 rounded-full bg-muted overflow-hidden">
            <div
              className="h-full bg-primary transition-all"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-1.5 py-1">
          <ImageIcon className="w-7 h-7 text-muted-foreground" />
          <p className="text-sm font-medium">
            {isDragging ? "Drop image to upload" : "Drag an image here or click to browse"}
          </p>
          <p className="text-[11px] text-muted-foreground">
            JPG, PNG, WEBP, GIF · up to 8 MB
          </p>
        </div>
      )}
    </div>
  );
}
