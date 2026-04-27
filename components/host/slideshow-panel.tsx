"use client";

/**
 * Self-contained host panel for the Image Slideshow feature.
 *
 * This panel owns its own state, DB queries, and broadcasts. It plugs into
 * the existing host interface with just two props (streamId + chat channel
 * ref) so adding/removing the feature is a single import + one JSX line.
 *
 * It does NOT touch WebRTC, useSimpleStream, the chat system, overlay, or
 * ticker logic. It reuses the existing chat channel for the `stream-slideshow`
 * broadcast (same pattern as overlay/ticker).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Images,
  Plus,
  Trash2,
  ChevronLeft,
  ChevronRight,
  Play,
  Square,
  Upload,
  Loader2,
} from "lucide-react";
import { StreamSlideshow } from "@/components/stream/stream-slideshow";

interface Slide {
  id: string;
  stream_id: string;
  image_url: string;
  caption: string;
  position: number;
  created_at: string;
}

interface SlideshowPanelProps {
  streamId: string;
  /**
   * The existing chat broadcast channel. We only CALL `.send()` — we never
   * subscribe to our own events or mutate the channel, so this is safe.
   */
  chatChannelRef: React.MutableRefObject<any>;
}

export function SlideshowPanel({ streamId, chatChannelRef }: SlideshowPanelProps) {
  const supabaseRef = useRef(createClient());
  const supabase = supabaseRef.current;

  const [slides, setSlides] = useState<Slide[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [newUrl, setNewUrl] = useState("");
  const [newCaption, setNewCaption] = useState("");
  const [adding, setAdding] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [active, setActive] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);

  // ---- Load slides + current slideshow state on mount ----
  useEffect(() => {
    (async () => {
      setLoadingList(true);
      const [slidesRes, streamRes] = await Promise.all([
        supabase
          .from("stream_slides")
          .select("*")
          .eq("stream_id", streamId)
          .order("position", { ascending: true })
          .order("created_at", { ascending: true }),
        supabase
          .from("streams")
          .select("slideshow_active, slideshow_current_url")
          .eq("id", streamId)
          .single(),
      ]);

      const list = (slidesRes.data as Slide[] | null) ?? [];
      setSlides(list);

      const s = streamRes.data as any;
      if (s?.slideshow_active) {
        setActive(true);
        const idx = list.findIndex((x) => x.image_url === s.slideshow_current_url);
        setCurrentIndex(idx >= 0 ? idx : 0);
      }
      setLoadingList(false);
    })();
  }, [streamId, supabase]);

  // ---- Broadcast + persist current state ----
  const pushState = useCallback(
    async (next: { active: boolean; url: string; caption: string }) => {
      try {
        chatChannelRef.current?.send({
          type: "broadcast",
          event: "stream-slideshow",
          payload: next,
        });
      } catch (err) {
        console.error("[Slideshow] broadcast failed:", err);
      }
      try {
        await supabase
          .from("streams")
          .update({
            slideshow_active: next.active,
            slideshow_current_url: next.url,
            slideshow_current_caption: next.caption,
          })
          .eq("id", streamId);
      } catch (err) {
        console.error("[Slideshow] persist failed:", err);
      }
    },
    [chatChannelRef, supabase, streamId]
  );

  // ---- Library management ----
  const addSlide = async () => {
    const url = newUrl.trim();
    if (!url) {
      toast.error("Paste an image URL first");
      return;
    }
    if (!/^https?:\/\//i.test(url)) {
      toast.error("URL must start with http:// or https://");
      return;
    }
    setAdding(true);
    try {
      const position = slides.length;
      const { data, error } = await supabase
        .from("stream_slides")
        .insert({
          stream_id: streamId,
          image_url: url,
          caption: newCaption.trim(),
          position,
        })
        .select()
        .single();

      if (error) throw error;
      if (data) {
        setSlides((prev) => [...prev, data as Slide]);
        setNewUrl("");
        setNewCaption("");
        toast.success("Slide added");
      }
    } catch (err: any) {
      console.error("[Slideshow] add failed:", err);
      toast.error("Could not add slide: " + (err?.message ?? "unknown"));
    } finally {
      setAdding(false);
    }
  };

  // ---- Upload from device ----
  // Patterns after the watermark uploader: same stream-overlays bucket,
  // 5 MB cap (slides can be larger than logos), public URL inserted into
  // the same stream_slides table via addSlide() so playback / position /
  // delete logic doesn't need to know the source.
  const handleFile = async (file: File) => {
    if (!file.type.startsWith("image/")) {
      toast.error("Choose an image file (JPG, PNG, or WebP).");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error("Image must be under 5 MB.");
      return;
    }
    setUploading(true);
    try {
      const ext = file.name.split(".").pop()?.toLowerCase() ?? "jpg";
      const path = `${streamId}/slides/${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from("stream-overlays")
        .upload(path, file, { cacheControl: "3600", upsert: false });
      if (upErr) throw upErr;
      const { data } = supabase.storage
        .from("stream-overlays")
        .getPublicUrl(path);
      // Pre-fill the URL field so the existing addSlide validates and
      // persists through the same code path. We then auto-trigger it.
      const url = data.publicUrl;
      setNewUrl(url);
      // Insert immediately — no need to make the host click "Add slide"
      // again after they already chose a file.
      const position = slides.length;
      const { data: row, error: insErr } = await supabase
        .from("stream_slides")
        .insert({
          stream_id: streamId,
          image_url: url,
          caption: newCaption.trim(),
          position,
        })
        .select()
        .single();
      if (insErr) throw insErr;
      if (row) {
        setSlides((prev) => [...prev, row as Slide]);
        setNewUrl("");
        setNewCaption("");
        toast.success("Slide uploaded");
      }
    } catch (err: any) {
      console.error("[Slideshow] upload failed:", err);
      toast.error("Upload failed: " + (err?.message ?? "unknown"));
    } finally {
      setUploading(false);
    }
  };

  const deleteSlide = async (id: string) => {
    const idx = slides.findIndex((s) => s.id === id);
    if (idx < 0) return;
    const isCurrent = active && idx === currentIndex;

    try {
      const { error } = await supabase.from("stream_slides").delete().eq("id", id);
      if (error) throw error;
      setSlides((prev) => prev.filter((s) => s.id !== id));

      // If the deleted slide was currently showing, advance or stop.
      if (isCurrent) {
        const remaining = slides.filter((s) => s.id !== id);
        if (remaining.length === 0) {
          setActive(false);
          setCurrentIndex(0);
          await pushState({ active: false, url: "", caption: "" });
        } else {
          const nextIdx = Math.min(currentIndex, remaining.length - 1);
          setCurrentIndex(nextIdx);
          const slide = remaining[nextIdx];
          await pushState({
            active: true,
            url: slide.image_url,
            caption: slide.caption,
          });
        }
      } else if (idx < currentIndex) {
        // Shifting current index left by one to stay pointing at same slide
        setCurrentIndex((i) => Math.max(0, i - 1));
      }
    } catch (err: any) {
      toast.error("Could not delete: " + (err?.message ?? "unknown"));
    }
  };

  // ---- Playback controls ----
  const startSlideshow = async () => {
    if (slides.length === 0) {
      toast.error("Add at least one slide first");
      return;
    }
    const idx = Math.min(currentIndex, slides.length - 1);
    setCurrentIndex(idx);
    setActive(true);
    const slide = slides[idx];
    await pushState({
      active: true,
      url: slide.image_url,
      caption: slide.caption,
    });
  };

  const stopSlideshow = async () => {
    setActive(false);
    await pushState({ active: false, url: "", caption: "" });
  };

  const goTo = async (idx: number) => {
    if (slides.length === 0) return;
    const bounded = (idx + slides.length) % slides.length;
    setCurrentIndex(bounded);
    if (active) {
      const slide = slides[bounded];
      await pushState({
        active: true,
        url: slide.image_url,
        caption: slide.caption,
      });
    }
  };

  const next = () => goTo(currentIndex + 1);
  const prev = () => goTo(currentIndex - 1);

  const currentSlide = slides[currentIndex];

  return (
    <Card>
      <CardHeader className="pb-3 border-b">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
              <Images className="w-4 h-4 text-primary" />
            </div>
            <div className="min-w-0">
              <CardTitle className="text-sm font-semibold">Image Slideshow</CardTitle>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                Cycle through still images viewers see in place of your camera.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {slides.length > 0 && (
              <span className="text-[11px] text-muted-foreground">
                {slides.length} slide{slides.length === 1 ? "" : "s"}
              </span>
            )}
            {active && (
              <Badge className="bg-green-500 text-white text-[10px] h-5 px-1.5">
                LIVE
              </Badge>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {/* Add a slide — either upload from device OR paste a URL. */}
        <div className="flex flex-col gap-2 p-3 rounded-md border border-dashed border-border">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void handleFile(f);
              e.target.value = "";
            }}
          />
          <Button
            type="button"
            variant="outline"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading || adding}
            className="w-full justify-center"
          >
            {uploading ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Uploading…
              </>
            ) : (
              <>
                <Upload className="w-4 h-4 mr-2" />
                Upload image (≤ 5 MB)
              </>
            )}
          </Button>
          <div className="flex items-center gap-2 my-0.5">
            <span className="flex-1 h-px bg-border" />
            <span className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground/70">or paste URL</span>
            <span className="flex-1 h-px bg-border" />
          </div>
          <Input
            placeholder="Paste image URL (https://...)"
            value={newUrl}
            onChange={(e) => setNewUrl(e.target.value)}
            disabled={adding || uploading}
          />
          <Input
            placeholder="Optional caption (shown below the image)"
            value={newCaption}
            onChange={(e) => setNewCaption(e.target.value.slice(0, 140))}
            maxLength={140}
            disabled={adding || uploading}
          />
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] text-muted-foreground">
              Direct image URL (JPG / PNG / WebP).
            </span>
            <Button size="sm" onClick={addSlide} disabled={adding || uploading || !newUrl.trim()}>
              <Plus className="w-4 h-4 mr-1.5" />
              Add slide
            </Button>
          </div>
        </div>

        {/* Slide list */}
        {loadingList ? (
          <p className="text-xs text-muted-foreground">Loading slides…</p>
        ) : slides.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No slides yet. Paste an image URL above to get started.
          </p>
        ) : (
          <div className="flex flex-col gap-1.5 max-h-60 overflow-y-auto pr-1">
            {slides.map((s, i) => (
              <div
                key={s.id}
                className={`flex items-center gap-2 p-1.5 rounded-md border transition-colors ${
                  i === currentIndex && active
                    ? "border-primary bg-primary/5"
                    : "border-border hover:border-foreground/30"
                }`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={s.image_url}
                  alt=""
                  className="w-12 h-12 object-cover rounded flex-shrink-0 bg-muted"
                  onError={(e) => {
                    (e.currentTarget as HTMLImageElement).style.opacity = "0.3";
                  }}
                />
                <div className="flex-1 min-w-0">
                  <p className="text-xs truncate">{s.caption || "(no caption)"}</p>
                  <p className="text-[10px] text-muted-foreground truncate">
                    {s.image_url}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 w-7 p-0 flex-shrink-0"
                  onClick={() => goTo(i)}
                  title="Show this slide"
                >
                  <Play className="w-3.5 h-3.5" />
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 w-7 p-0 flex-shrink-0 text-red-500 hover:text-red-600"
                  onClick={() => deleteSlide(s.id)}
                  title="Delete slide"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </div>
            ))}
          </div>
        )}

        {/* Playback controls */}
        {slides.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-border">
            <div className="flex items-center gap-1">
              <Button
                size="sm"
                variant="outline"
                onClick={prev}
                disabled={slides.length < 2}
              >
                <ChevronLeft className="w-4 h-4" />
              </Button>
              <span className="text-xs text-muted-foreground tabular-nums px-2">
                {currentIndex + 1} / {slides.length}
              </span>
              <Button
                size="sm"
                variant="outline"
                onClick={next}
                disabled={slides.length < 2}
              >
                <ChevronRight className="w-4 h-4" />
              </Button>
            </div>
            {active ? (
              <Button size="sm" variant="destructive" onClick={stopSlideshow}>
                <Square className="w-4 h-4 mr-1.5" />
                Stop
              </Button>
            ) : (
              <Button size="sm" onClick={startSlideshow}>
                <Play className="w-4 h-4 mr-1.5" />
                Start slideshow
              </Button>
            )}
          </div>
        )}

        {/* Host preview — WYSIWYG of what viewers currently see */}
        {currentSlide && (
          <div className="relative w-full rounded-md overflow-hidden border border-border bg-black aspect-video">
            <StreamSlideshow
              active={true}
              imageUrl={currentSlide.image_url}
              caption={currentSlide.caption}
            />
            {!active && (
              <div className="absolute top-2 left-2 bg-black/70 text-white text-[10px] px-2 py-0.5 rounded">
                Preview (not broadcasting)
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
