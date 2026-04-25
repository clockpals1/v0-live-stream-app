/**
 * Client-side helper for persisting host-controlled display layers (overlay,
 * ticker, slideshow) onto the streams row via the authoritative server
 * endpoint at /api/streams/[streamId]/display-state.
 *
 * Why this helper exists:
 *   - The host and operator UIs both write the SAME columns. Keeping the
 *     network/error code in one place avoids drift.
 *   - The previous implementation used a raw `supabase.from("streams").update`
 *     with `console.error`-only failure handling. Any silent permission /
 *     network blip turned into the late-joiner-loses-overlay bug because the
 *     broadcast still fired but the row never got persisted. This helper
 *     surfaces failures to the caller so the UI can toast / retry.
 */

export type OverlayPatch = {
  active?: boolean;
  message?: string;
  background?: "dark" | "light" | "branded";
  imageUrl?: string;
};

export type TickerPatch = {
  active?: boolean;
  message?: string;
  speed?: "slow" | "normal" | "fast";
  style?: "default" | "urgent" | "info";
};

export type SlideshowPatch = {
  active?: boolean;
  currentUrl?: string;
  currentCaption?: string;
};

export interface DisplayStatePatch {
  overlay?: OverlayPatch;
  ticker?: TickerPatch;
  slideshow?: SlideshowPatch;
}

export async function persistDisplayState(
  streamId: string,
  patch: DisplayStatePatch,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const res = await fetch(`/api/streams/${streamId}/display-state`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (!res.ok) {
      let msg = `HTTP ${res.status}`;
      try {
        const body = await res.json();
        if (body?.error) msg = body.error;
      } catch {
        /* ignore body parse errors — keep the HTTP status message */
      }
      return { ok: false, error: msg };
    }
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err?.message ?? "network error" };
  }
}
