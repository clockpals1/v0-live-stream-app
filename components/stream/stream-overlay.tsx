"use client";

import { useEffect, useState } from "react";

export type OverlayBackground = "dark" | "light" | "branded";

interface StreamOverlayProps {
  active: boolean;
  message: string;
  background: OverlayBackground;
}

/**
 * Fullscreen overlay rendered on top of a <video>. Used on both the host preview
 * (so the host can see exactly what viewers see) and the viewer video container.
 *
 * - Fades in on `active=true`, fades out then unmounts 350ms after `active=false`.
 * - `pointer-events: none` so underlying video controls still work.
 * - Background variants: dark / light / branded (app primary color).
 */
export function StreamOverlay({ active, message, background }: StreamOverlayProps) {
  const [mounted, setMounted] = useState(active);
  const [visible, setVisible] = useState(active);

  useEffect(() => {
    if (active) {
      setMounted(true);
      // next paint → fade in
      const raf = requestAnimationFrame(() => setVisible(true));
      return () => cancelAnimationFrame(raf);
    } else {
      setVisible(false);
      const t = setTimeout(() => setMounted(false), 350);
      return () => clearTimeout(t);
    }
  }, [active]);

  if (!mounted) return null;

  const bgStyle: Record<OverlayBackground, { background: string; color: string }> = {
    dark: { background: "rgba(0, 0, 0, 0.82)", color: "#ffffff" },
    light: { background: "rgba(255, 255, 255, 0.90)", color: "#111827" },
    // Uses CSS var --primary from Tailwind theme; fallback violet if unset.
    branded: {
      background: "hsl(var(--primary) / 0.88)",
      color: "#ffffff",
    },
  };

  const style = bgStyle[background] ?? bgStyle.dark;

  return (
    <div
      className="absolute inset-0 flex items-center justify-center"
      style={{
        zIndex: 20,
        pointerEvents: "none",
        background: style.background,
        color: style.color,
        opacity: visible ? 1 : 0,
        transition: "opacity 0.35s ease",
      }}
      aria-live="polite"
      role="status"
    >
      <p
        className="text-center"
        style={{
          fontSize: "clamp(1.2rem, 3vw, 2rem)",
          fontWeight: 500,
          maxWidth: "80%",
          padding: "2rem",
          lineHeight: 1.3,
          textShadow:
            background === "light" ? "none" : "0 2px 8px rgba(0,0,0,0.4)",
        }}
      >
        {message}
      </p>
    </div>
  );
}
