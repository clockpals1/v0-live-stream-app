"use client";

import { useEffect, useState } from "react";

export interface StreamSlideshowProps {
  /** Slideshow is currently broadcasting to viewers */
  active: boolean;
  /** URL of the current image to display */
  imageUrl: string;
  /** Optional caption rendered at the bottom of the slide */
  caption?: string;
}

/**
 * Viewer-side slideshow display. Shown as an absolute overlay over the video
 * element (NOT full-screen). Keeps the stream-info bar / ticker / chat intact.
 *
 * Renders nothing when inactive — zero layout impact, zero DOM cost.
 *
 * Does NOT touch the video element, WebRTC, audio, or any global state.
 * Safe to drop into the video container alongside <StreamOverlay/>.
 */
export function StreamSlideshow({ active, imageUrl, caption }: StreamSlideshowProps) {
  const [loaded, setLoaded] = useState(false);

  // Reset the fade-in state when the source URL changes so each new slide
  // animates in smoothly.
  useEffect(() => {
    setLoaded(false);
  }, [imageUrl]);

  if (!active || !imageUrl) return null;

  return (
    <div
      className="absolute inset-0 z-20 flex items-center justify-center bg-black/95 select-none"
      aria-label="Slideshow image"
    >
      {/* Using a plain <img> here is intentional: the URL is external / host-
          provided and we do not want to route it through the Next.js image
          optimizer (no extra infra / config required). */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={imageUrl}
        alt={caption || "Slideshow"}
        onLoad={() => setLoaded(true)}
        draggable={false}
        className={`max-w-full max-h-full object-contain transition-opacity duration-300 ${
          loaded ? "opacity-100" : "opacity-0"
        }`}
        style={{
          // GPU hint for smoother transitions on mobile
          transform: "translateZ(0)",
          backfaceVisibility: "hidden",
        }}
      />

      {/* Placeholder while image loads */}
      {!loaded && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="text-white/60 text-sm animate-pulse">Loading slide…</div>
        </div>
      )}

      {caption && (
        <div className="absolute left-0 right-0 bottom-0 px-4 py-3 bg-gradient-to-t from-black/80 to-transparent">
          <p
            className="text-white text-center font-medium leading-snug"
            style={{ fontSize: "clamp(14px, 2.4vw, 17px)" }}
          >
            {caption}
          </p>
        </div>
      )}
    </div>
  );
}
