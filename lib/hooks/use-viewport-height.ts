"use client";

import { useEffect } from "react";

/**
 * Keeps a CSS variable (default `--app-vh`) in sync with the actual visual
 * viewport height in px.
 *
 * Why: on mobile, the "100vh" and even "100dvh" units don't always update
 * predictably when:
 *   - the URL bar collapses/expands during scroll,
 *   - the on-screen keyboard opens/closes,
 *   - the device rotates between portrait and landscape.
 *
 * The VisualViewport API reports the true visible area and fires `resize`
 * on all of these events. We write its height to a CSS variable so any
 * element can use `height: var(--app-vh)` to get a reliable, live-updating
 * viewport height. Falls back to `window.innerHeight` on browsers without
 * visualViewport (very old Android WebViews).
 *
 * Runs once at mount; no-op on SSR.
 */
export function useViewportHeight(cssVarName: string = "--app-vh"): void {
  useEffect(() => {
    if (typeof window === "undefined") return;

    const apply = () => {
      const h =
        window.visualViewport?.height ??
        window.innerHeight ??
        document.documentElement.clientHeight;
      document.documentElement.style.setProperty(cssVarName, `${h}px`);
    };

    apply();

    const vv = window.visualViewport;
    if (vv) {
      vv.addEventListener("resize", apply);
      vv.addEventListener("scroll", apply);
    }
    window.addEventListener("resize", apply);
    window.addEventListener("orientationchange", apply);

    return () => {
      if (vv) {
        vv.removeEventListener("resize", apply);
        vv.removeEventListener("scroll", apply);
      }
      window.removeEventListener("resize", apply);
      window.removeEventListener("orientationchange", apply);
    };
  }, [cssVarName]);
}
