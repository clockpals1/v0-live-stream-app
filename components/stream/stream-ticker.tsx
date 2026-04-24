"use client";

import { useEffect, useState } from "react";

export type TickerSpeed = "slow" | "normal" | "fast";
export type TickerStyle = "default" | "urgent" | "info";

interface StreamTickerProps {
  active: boolean;
  message: string;
  speed: TickerSpeed;
  style: TickerStyle;
}

/**
 * News-style scrolling ticker that sits BELOW the video container, between the
 * video and the stream info bar. Pure CSS marquee — no JS intervals or scroll
 * libraries. The message text is rendered TWICE back-to-back so the loop has
 * no visible gap as the first copy scrolls off the left and the second enters.
 *
 * Pauses automatically when the tab is hidden (document.visibilityState) to
 * save CPU on mobile.
 */
export function StreamTicker({ active, message, speed, style }: StreamTickerProps) {
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    const onVis = () => setPaused(document.visibilityState === "hidden");
    onVis();
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  // Nothing rendered when inactive — no reserved space, no layout shift.
  if (!active || !message.trim()) return null;

  const duration =
    speed === "slow" ? "30s" : speed === "fast" ? "10s" : "18s";

  const palette: Record<TickerStyle, { bg: string; fg: string; accent: string }> = {
    default: { bg: "#111827", fg: "#ffffff", accent: "#ffffff" }, // gray-900
    urgent: { bg: "#dc2626", fg: "#ffffff", accent: "#fecaca" }, // red-600
    info: { bg: "#1d4ed8", fg: "#ffffff", accent: "#bfdbfe" }, // blue-700
  };
  const c = palette[style] ?? palette.default;

  return (
    <div
      aria-live="off"
      className="w-full overflow-hidden select-none stream-ticker-root"
      style={{
        background: c.bg,
        color: c.fg,
        height: 36,
        borderTop: `1px solid rgba(255,255,255,0.08)`,
        borderBottom: `1px solid rgba(255,255,255,0.08)`,
      }}
    >
      {/* Scoped plain <style> — safe in any React tree, no styled-jsx dep. */}
      <style>{`
        @keyframes stream-ticker-marquee {
          0% { transform: translate3d(0, 0, 0); }
          /* Scroll exactly one copy's width (-50%) so the second copy
             seamlessly replaces the first — zero visible gap at the loop. */
          100% { transform: translate3d(-50%, 0, 0); }
        }
        .stream-ticker-root .ticker-track {
          display: inline-flex;
          white-space: nowrap;
          will-change: transform;
          animation: stream-ticker-marquee var(--ticker-duration, 18s) linear infinite;
        }
        .stream-ticker-root .ticker-track.paused {
          animation-play-state: paused;
        }
        .stream-ticker-root .ticker-chunk {
          display: inline-flex;
          align-items: center;
          padding: 0 2rem;
          font-weight: 500;
          line-height: 36px;
          font-size: clamp(13px, 2.6vw, 15px);
          letter-spacing: 0.01em;
        }
        .stream-ticker-root .ticker-dot {
          display: inline-block;
          width: 6px;
          height: 6px;
          border-radius: 9999px;
          margin: 0 0.9rem;
          background: var(--ticker-accent, #ffffff);
          opacity: 0.7;
          flex-shrink: 0;
        }
      `}</style>

      <div
        className={`ticker-track ${paused ? "paused" : ""}`}
        style={
          {
            ["--ticker-duration" as any]: duration,
            ["--ticker-accent" as any]: c.accent,
          } as React.CSSProperties
        }
      >
        {/* Two back-to-back copies. The animation translates -50% (one copy). */}
        <span className="ticker-chunk">
          {message}
          <span className="ticker-dot" />
        </span>
        <span className="ticker-chunk" aria-hidden>
          {message}
          <span className="ticker-dot" />
        </span>
      </div>
    </div>
  );
}
