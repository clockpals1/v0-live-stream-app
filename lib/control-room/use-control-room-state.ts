"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";
import type {
  BrandingConfig,
  OverlayBackground,
  OverlayPreset,
  Scene,
  SceneLayout,
  TickerPreset,
  TickerSpeed,
  TickerStyle,
} from "./types";

/**
 * Live Control Room — single source of truth for producer state.
 *
 * What lives here:
 *   - overlay (active / message / background / image url + music url)
 *   - overlay music auxiliary state (active / volume / mix-with-mic)
 *   - ticker (active / message / speed / style)
 *   - branding (watermark / theme / layout / accent)
 *   - scenes (saved presets)
 *
 * What does NOT live here:
 *   - WebRTC peer connections   → useHostStream
 *   - Camera / mic device state → useHostStream
 *   - Chat messages             → stream-interface (still owns the chat
 *                                  channel because it doubles as the
 *                                  operator-command and overlay/ticker
 *                                  broadcast bus)
 *
 * Why a single hook:
 *   - One useEffect loads ALL persisted state from streams.* in one round
 *     trip on mount (was four separate selects).
 *   - One place to add a new producer field — the deck UI only needs to
 *     read state and call a `pushX` setter. Persistence + broadcast are
 *     hidden behind that setter.
 *   - Scene apply is a single call that fans out to overlay + ticker +
 *     music + branding using the same setters, so we never duplicate the
 *     persistence/broadcast logic.
 */

interface Args {
  streamId: string;
  supabase: SupabaseClient;
  /**
   * The realtime broadcast channel set up by stream-interface for chat.
   * We re-use it instead of opening a second channel because viewers
   * already subscribe to it for `stream-overlay` / `stream-ticker`
   * events; the payload contracts are unchanged.
   */
  chatChannelRef: React.MutableRefObject<RealtimeChannel | null>;
}

export interface ControlRoomState {
  // ── overlay
  overlay: OverlayPreset;
  setOverlayActive: (v: boolean) => void;
  setOverlayMessage: (v: string) => void;
  setOverlayBackground: (v: OverlayBackground) => void;
  setOverlayImageUrl: (v: string) => void;

  // ── overlay music (auxiliary; the URL itself is in scenes/branding context)
  overlayMusicUrl: string;
  setOverlayMusicUrl: (v: string) => void;
  overlayMusic: { active: boolean; volume: number; mixWithMic: boolean };
  setOverlayMusic: (
    next: { active: boolean; volume: number; mixWithMic: boolean },
  ) => void;

  // ── ticker
  ticker: TickerPreset;
  setTickerActive: (v: boolean) => void;
  setTickerMessage: (v: string) => void;
  setTickerSpeed: (v: TickerSpeed) => void;
  setTickerStyle: (v: TickerStyle) => void;

  // ── branding
  branding: BrandingConfig;
  updateBranding: (patch: Partial<BrandingConfig>) => void;

  // ── scenes
  scenes: Scene[];
  saveScene: (scene: Scene) => Promise<void>;
  deleteScene: (id: string) => Promise<void>;
  applyScene: (scene: Scene) => Promise<void>;

  /** True for the brief moment after mount while we hydrate from DB. */
  hydrated: boolean;
}

const DEFAULT_OVERLAY: OverlayPreset = {
  active: false,
  message: "",
  background: "dark",
  imageUrl: "",
};
const DEFAULT_TICKER: TickerPreset = {
  active: false,
  message: "",
  speed: "normal",
  style: "default",
};
const DEFAULT_BRANDING: BrandingConfig = {};

export function useControlRoomState({
  streamId,
  supabase,
  chatChannelRef,
}: Args): ControlRoomState {
  const [overlay, setOverlay] = useState<OverlayPreset>(DEFAULT_OVERLAY);
  const [overlayMusicUrl, setOverlayMusicUrlState] = useState("");
  const [overlayMusic, setOverlayMusicState] = useState({
    active: false,
    volume: 0.8,
    mixWithMic: true,
  });
  const [ticker, setTicker] = useState<TickerPreset>(DEFAULT_TICKER);
  const [branding, setBranding] = useState<BrandingConfig>(DEFAULT_BRANDING);
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [hydrated, setHydrated] = useState(false);

  // Refs for the latest values so save handlers don't need a fresh
  // closure on every keystroke.
  const overlayRef = useRef(overlay);
  const tickerRef = useRef(ticker);
  const brandingRef = useRef(branding);
  const scenesRef = useRef(scenes);
  useEffect(() => { overlayRef.current = overlay; }, [overlay]);
  useEffect(() => { tickerRef.current = ticker; }, [ticker]);
  useEffect(() => { brandingRef.current = branding; }, [branding]);
  useEffect(() => { scenesRef.current = scenes; }, [scenes]);

  // ── Hydrate every persisted column on mount in one round trip ──────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("streams")
        .select(
          [
            "overlay_active",
            "overlay_message",
            "overlay_background",
            "overlay_image_url",
            "overlay_music_url",
            "overlay_music_volume",
            "overlay_music_mix_mic",
            "ticker_active",
            "ticker_message",
            "ticker_speed",
            "ticker_style",
            "scenes",
            "branding",
          ].join(", "),
        )
        .eq("id", streamId)
        .single();
      if (cancelled || !data) return;
      const d = data as any;
      setOverlay({
        active: !!d.overlay_active,
        message: d.overlay_message ?? "",
        background:
          d.overlay_background === "dark" ||
          d.overlay_background === "light" ||
          d.overlay_background === "branded"
            ? d.overlay_background
            : "dark",
        imageUrl: d.overlay_image_url ?? "",
      });
      setOverlayMusicUrlState(d.overlay_music_url ?? "");
      setOverlayMusicState({
        // Music never auto-resumes — playback requires a user gesture
        // because the audio context is suspended on a fresh page load.
        active: false,
        volume:
          typeof d.overlay_music_volume === "number" ? d.overlay_music_volume : 0.8,
        mixWithMic: d.overlay_music_mix_mic !== false,
      });
      setTicker({
        active: !!d.ticker_active,
        message: d.ticker_message ?? "",
        speed:
          d.ticker_speed === "slow" ||
          d.ticker_speed === "normal" ||
          d.ticker_speed === "fast"
            ? d.ticker_speed
            : "normal",
        style:
          d.ticker_style === "default" ||
          d.ticker_style === "urgent" ||
          d.ticker_style === "info"
            ? d.ticker_style
            : "default",
      });
      // jsonb columns may come back as `null` if migration 027 hasn't
      // applied yet; tolerate both.
      setScenes(Array.isArray(d.scenes) ? (d.scenes as Scene[]) : []);
      setBranding(
        d.branding && typeof d.branding === "object"
          ? (d.branding as BrandingConfig)
          : {},
      );
      setHydrated(true);
    })();
    return () => { cancelled = true; };
  }, [streamId, supabase]);

  // ── Overlay broadcast + persist (debounced edits while active) ─────────
  const pushOverlay = useCallback(
    async (next: OverlayPreset) => {
      const payload = {
        active: next.active,
        message: next.message.slice(0, 120),
        background: next.background,
        imageUrl: next.imageUrl,
      };
      try {
        chatChannelRef.current?.send({
          type: "broadcast",
          event: "stream-overlay",
          payload,
        });
      } catch (err) {
        console.error("[control-room] overlay broadcast failed:", err);
      }
      try {
        await supabase
          .from("streams")
          .update({
            overlay_active: payload.active,
            overlay_message: payload.message,
            overlay_background: payload.background,
            overlay_image_url: payload.imageUrl,
          })
          .eq("id", streamId);
      } catch (err) {
        console.error("[control-room] overlay persist failed:", err);
      }
    },
    [streamId, supabase, chatChannelRef],
  );

  // Debounced re-broadcast while active so viewers see edits live.
  useEffect(() => {
    if (!overlay.active) return;
    const t = setTimeout(() => { void pushOverlay(overlay); }, 250);
    return () => clearTimeout(t);
  }, [overlay, pushOverlay]);

  const setOverlayActive = useCallback(
    (v: boolean) => {
      setOverlay((prev) => {
        const next = { ...prev, active: v };
        void pushOverlay(next);
        return next;
      });
    },
    [pushOverlay],
  );
  const setOverlayMessage = useCallback(
    (v: string) => setOverlay((p) => ({ ...p, message: v.slice(0, 120) })),
    [],
  );
  const setOverlayBackground = useCallback(
    (v: OverlayBackground) => setOverlay((p) => ({ ...p, background: v })),
    [],
  );
  const setOverlayImageUrl = useCallback(
    (v: string) => setOverlay((p) => ({ ...p, imageUrl: v })),
    [],
  );

  // ── Overlay music persist (no broadcast — audio reaches viewers via
  //    the WebRTC track swap done in useHostStream.setLiveAudioTrack)
  const persistMusic = useCallback(
    async (patch: {
      url?: string;
      active?: boolean;
      volume?: number;
      mixWithMic?: boolean;
    }) => {
      try {
        const update: Record<string, unknown> = {};
        if (typeof patch.url === "string") update.overlay_music_url = patch.url;
        if (typeof patch.active === "boolean") update.overlay_music_active = patch.active;
        if (typeof patch.volume === "number") update.overlay_music_volume = patch.volume;
        if (typeof patch.mixWithMic === "boolean") update.overlay_music_mix_mic = patch.mixWithMic;
        if (Object.keys(update).length === 0) return;
        await supabase.from("streams").update(update).eq("id", streamId);
      } catch (err) {
        console.warn("[control-room] music persist failed:", err);
      }
    },
    [streamId, supabase],
  );

  const setOverlayMusicUrl = useCallback(
    (v: string) => {
      setOverlayMusicUrlState(v);
      void persistMusic({ url: v });
    },
    [persistMusic],
  );

  const setOverlayMusic = useCallback(
    (next: { active: boolean; volume: number; mixWithMic: boolean }) => {
      setOverlayMusicState(next);
      void persistMusic(next);
    },
    [persistMusic],
  );

  // ── Ticker broadcast + persist (debounced) ─────────────────────────────
  const pushTicker = useCallback(
    async (next: TickerPreset) => {
      const payload = {
        active: next.active,
        message: next.message.slice(0, 280),
        speed: next.speed,
        style: next.style,
      };
      try {
        chatChannelRef.current?.send({
          type: "broadcast",
          event: "stream-ticker",
          payload,
        });
      } catch (err) {
        console.error("[control-room] ticker broadcast failed:", err);
      }
      try {
        await supabase
          .from("streams")
          .update({
            ticker_active: payload.active,
            ticker_message: payload.message,
            ticker_speed: payload.speed,
            ticker_style: payload.style,
          })
          .eq("id", streamId);
      } catch (err) {
        console.error("[control-room] ticker persist failed:", err);
      }
    },
    [streamId, supabase, chatChannelRef],
  );

  useEffect(() => {
    if (!ticker.active) return;
    const t = setTimeout(() => { void pushTicker(ticker); }, 300);
    return () => clearTimeout(t);
  }, [ticker, pushTicker]);

  const setTickerActive = useCallback(
    (v: boolean) => {
      setTicker((prev) => {
        const next = { ...prev, active: v };
        void pushTicker(next);
        return next;
      });
    },
    [pushTicker],
  );
  const setTickerMessage = useCallback(
    (v: string) => setTicker((p) => ({ ...p, message: v.slice(0, 280) })),
    [],
  );
  const setTickerSpeed = useCallback(
    (v: TickerSpeed) => setTicker((p) => ({ ...p, speed: v })),
    [],
  );
  const setTickerStyle = useCallback(
    (v: TickerStyle) => setTicker((p) => ({ ...p, style: v })),
    [],
  );

  // ── Branding persist (write-through). ───────────────────────────────────
  const updateBranding = useCallback(
    (patch: Partial<BrandingConfig>) => {
      setBranding((prev) => {
        const next = { ...prev, ...patch };
        // Fire and forget — branding is non-realtime.
        void supabase
          .from("streams")
          .update({ branding: next })
          .eq("id", streamId)
          .then((res) => {
            if (res.error) {
              // Migration 027 may not be applied yet — fail soft.
              console.warn("[control-room] branding persist:", res.error.message);
            }
          });
        return next;
      });
    },
    [streamId, supabase],
  );

  // ── Scenes CRUD + apply ─────────────────────────────────────────────────
  const persistScenes = useCallback(
    async (next: Scene[]) => {
      try {
        const { error } = await supabase
          .from("streams")
          .update({ scenes: next })
          .eq("id", streamId);
        if (error) console.warn("[control-room] scenes persist:", error.message);
      } catch (err) {
        console.warn("[control-room] scenes persist threw:", err);
      }
    },
    [streamId, supabase],
  );

  const saveScene = useCallback(
    async (scene: Scene) => {
      const next = [
        ...scenesRef.current.filter((s) => s.id !== scene.id),
        scene,
      ];
      setScenes(next);
      await persistScenes(next);
    },
    [persistScenes],
  );

  const deleteScene = useCallback(
    async (id: string) => {
      const next = scenesRef.current.filter((s) => s.id !== id);
      setScenes(next);
      await persistScenes(next);
    },
    [persistScenes],
  );

  /**
   * Apply a scene live: fan out to the existing overlay/ticker/music
   * setters which already broadcast and persist. The host's existing
   * viewer code path re-renders with no additional plumbing.
   */
  const applyScene = useCallback(
    async (scene: Scene) => {
      // Overlay
      if (scene.overlay) {
        setOverlay(scene.overlay);
        await pushOverlay(scene.overlay);
      } else {
        const cleared: OverlayPreset = { ...overlayRef.current, active: false };
        setOverlay(cleared);
        await pushOverlay(cleared);
      }
      // Ticker
      if (scene.ticker) {
        setTicker(scene.ticker);
        await pushTicker(scene.ticker);
      } else {
        const cleared: TickerPreset = { ...tickerRef.current, active: false };
        setTicker(cleared);
        await pushTicker(cleared);
      }
      // Music URL — playback itself is the host's choice (audio context
      // gesture). We just swap the URL; the OverlayMusic component picks
      // it up on re-render.
      if (scene.musicUrl !== null && scene.musicUrl !== overlayMusicUrl) {
        setOverlayMusicUrlState(scene.musicUrl);
        void persistMusic({ url: scene.musicUrl });
      }
      // Layout → branding
      updateBranding({ layout: scene.layout });
    },
    [
      pushOverlay,
      pushTicker,
      overlayMusicUrl,
      persistMusic,
      updateBranding,
    ],
  );

  return {
    overlay,
    setOverlayActive,
    setOverlayMessage,
    setOverlayBackground,
    setOverlayImageUrl,

    overlayMusicUrl,
    setOverlayMusicUrl,
    overlayMusic,
    setOverlayMusic,

    ticker,
    setTickerActive,
    setTickerMessage,
    setTickerSpeed,
    setTickerStyle,

    branding,
    updateBranding,

    scenes,
    saveScene,
    deleteScene,
    applyScene,

    hydrated,
  };
}
