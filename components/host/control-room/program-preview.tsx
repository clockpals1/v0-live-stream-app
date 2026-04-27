"use client";

import { forwardRef } from "react";
import {
  Camera,
  CheckCircle2,
  Mic,
  MicOff,
  RefreshCw,
  Smartphone,
  SwitchCamera,
  Video,
  VideoOff,
  WifiOff as DataSaver,
} from "lucide-react";
import { StreamOverlay } from "@/components/stream/stream-overlay";
import type { OverlayPreset } from "@/lib/control-room/types";
import { SURFACE } from "@/lib/control-room/styles";

interface Props {
  isMobile: boolean;
  cameraFacingMode: "user" | "environment";
  isSwitching: boolean;
  videoEnabled: boolean;
  audioEnabled: boolean;
  mediaInitialized: boolean;
  isStreaming: boolean;
  isDataSaver: boolean;
  videoQuality: "auto" | "high" | "medium" | "low";
  overlay: OverlayPreset;
  watermarkUrl?: string | null;
  watermarkPosition?: "tl" | "tr" | "bl" | "br";
  onRotateCamera: () => void;
  onToggleVideo: () => void;
  onToggleAudio: () => void;
  onToggleDataSaver: () => void;
  onChangeQuality: (q: "auto" | "high" | "medium" | "low") => void;
}

/**
 * Program preview — the host's "what viewers see right now" monitor.
 *
 * Visual treatment:
 *   - When LIVE: a thin red glow rim around the card + an animated
 *     status badge in the corner. Communicates "you are on" before
 *     the host even reads the topbar.
 *   - When READY (preview-only): a soft emerald rim.
 *   - Bottom controls dock floats over the video on a translucent
 *     dark backdrop with subtle inner glow — feels like a piece of
 *     hardware rather than an HTML form.
 *   - Watermark renders absolutely in the corner the host configured.
 *     Pure preview affordance (the outgoing WebRTC track is the raw
 *     camera; canvas-compositing the watermark into the outgoing track
 *     is a future capability).
 */
export const ProgramPreview = forwardRef<HTMLVideoElement, Props>(
  function ProgramPreview(
    {
      isMobile,
      cameraFacingMode,
      isSwitching,
      videoEnabled,
      audioEnabled,
      mediaInitialized,
      isStreaming,
      isDataSaver,
      videoQuality,
      overlay,
      watermarkUrl,
      watermarkPosition = "tr",
      onRotateCamera,
      onToggleVideo,
      onToggleAudio,
      onToggleDataSaver,
      onChangeQuality,
    },
    videoRef,
  ) {
    const wmPos: Record<string, string> = {
      tl: "top-3 left-3",
      tr: "top-3 right-3",
      bl: "bottom-24 left-3",
      br: "bottom-24 right-3",
    };

    // Outer rim color encodes program state — red glow when actually
    // broadcasting, emerald for "ready, not streaming yet", subtle
    // border otherwise.
    const rim = isStreaming
      ? "ring-2 ring-red-500/40 shadow-[0_0_24px_-4px_rgba(239,68,68,0.45)]"
      : mediaInitialized
        ? "ring-1 ring-emerald-500/25 shadow-sm"
        : "ring-1 ring-border shadow-sm";

    return (
      <div
        className={`relative overflow-hidden rounded-xl bg-black transition-shadow ${rim}`}
      >
        <div className="relative aspect-video">
          {/* Top-left chips: camera mode + mobile indicator */}
          <div className="absolute top-3 left-3 flex items-center gap-1.5 z-10">
            <span
              className={`inline-flex items-center gap-1 h-6 px-2 rounded-full text-[10px] font-semibold uppercase tracking-[0.12em] backdrop-blur-md ${
                cameraFacingMode === "environment"
                  ? "bg-blue-500/85 text-white ring-1 ring-blue-300/60"
                  : "bg-black/55 text-white ring-1 ring-white/15"
              }`}
            >
              <Camera className="w-3 h-3" />
              {cameraFacingMode === "environment" ? "Rear" : "Front"}
            </span>
            {isMobile && (
              <span className="inline-flex items-center gap-1 h-6 px-2 rounded-full text-[10px] font-semibold uppercase tracking-[0.12em] bg-black/55 text-white ring-1 ring-white/15 backdrop-blur-md">
                <Smartphone className="w-3 h-3" />
                Mobile
              </span>
            )}
          </div>

          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className={`w-full h-full object-cover ${!videoEnabled ? "hidden" : ""}`}
          />
          {!videoEnabled && (
            <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-zinc-900 to-black">
              <div className="flex flex-col items-center gap-2 text-zinc-500">
                <VideoOff className="w-12 h-12" />
                <span className="text-xs uppercase tracking-[0.14em] font-medium">
                  Camera off
                </span>
              </div>
            </div>
          )}

          {/* Branded watermark — host-side preview only */}
          {watermarkUrl && (
            <div className={`absolute z-10 ${wmPos[watermarkPosition]}`}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={watermarkUrl}
                alt="Watermark preview"
                className="h-9 w-auto opacity-85 drop-shadow-[0_2px_8px_rgba(0,0,0,0.55)]"
              />
            </div>
          )}

          {/* On-stage overlay — exact mirror of viewer-side */}
          <StreamOverlay
            active={overlay.active}
            message={overlay.message}
            background={overlay.background}
            imageUrl={overlay.imageUrl}
          />

          {/* Top-right state pill */}
          <div className="absolute top-3 right-3 z-10">
            {isStreaming ? (
              <span className="inline-flex items-center gap-1.5 h-6 px-2 rounded-full text-[10px] font-semibold uppercase tracking-[0.14em] text-white bg-gradient-to-r from-red-500 to-rose-500 ring-1 ring-red-300/40 shadow-[0_0_0_3px_rgba(239,68,68,0.18)]">
                <span className="relative flex h-1.5 w-1.5">
                  <span className="absolute inline-flex h-full w-full rounded-full bg-white opacity-75 animate-ping" />
                  <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-white" />
                </span>
                Live
              </span>
            ) : mediaInitialized ? (
              <span className="inline-flex items-center gap-1 h-6 px-2 rounded-full text-[10px] font-semibold uppercase tracking-[0.14em] bg-black/55 text-emerald-300 ring-1 ring-emerald-400/30 backdrop-blur-md">
                <CheckCircle2 className="w-3 h-3" />
                Ready
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 h-6 px-2 rounded-full text-[10px] font-semibold uppercase tracking-[0.14em] bg-black/55 text-white ring-1 ring-white/15 backdrop-blur-md">
                <RefreshCw className="w-3 h-3 animate-spin" />
                Starting
              </span>
            )}
          </div>

          {/* Bottom controls dock — glass surface */}
          <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/90 via-black/55 to-transparent pt-12 pb-4 px-4">
            <div className="flex items-end justify-center gap-3 sm:gap-4">
              <ControlButton
                label={isSwitching ? "Switching" : cameraFacingMode === "environment" ? "Rear" : "Front"}
                onClick={onRotateCamera}
                disabled={!mediaInitialized || isSwitching}
                tone="primary"
              >
                {isSwitching ? (
                  <RefreshCw className="w-5 h-5 animate-spin" />
                ) : (
                  <SwitchCamera className="w-5 h-5" />
                )}
              </ControlButton>

              <ControlButton
                label={videoEnabled ? "Camera" : "Off"}
                onClick={onToggleVideo}
                disabled={!mediaInitialized}
                tone={videoEnabled ? "neutral" : "danger"}
              >
                {videoEnabled ? (
                  <Video className="w-5 h-5" />
                ) : (
                  <VideoOff className="w-5 h-5" />
                )}
              </ControlButton>

              <ControlButton
                label={audioEnabled ? "Mic" : "Muted"}
                onClick={onToggleAudio}
                disabled={!mediaInitialized}
                tone={audioEnabled ? "neutral" : "danger"}
              >
                {audioEnabled ? (
                  <Mic className="w-5 h-5" />
                ) : (
                  <MicOff className="w-5 h-5" />
                )}
              </ControlButton>

              <div className="flex flex-col items-center gap-1.5">
                <div className="h-12 flex items-center bg-black/60 backdrop-blur-md rounded-full px-3 gap-1.5 ring-1 ring-white/15">
                  <button
                    type="button"
                    onClick={onToggleDataSaver}
                    disabled={isStreaming}
                    className="disabled:opacity-50"
                    aria-label="Toggle data saver"
                  >
                    <DataSaver className={`w-4 h-4 ${isDataSaver ? "text-orange-400" : "text-white/85"}`} />
                  </button>
                  <select
                    value={videoQuality}
                    onChange={(e) =>
                      onChangeQuality(e.target.value as "auto" | "high" | "medium" | "low")
                    }
                    className="bg-transparent text-white text-xs border-none outline-none cursor-pointer disabled:opacity-50 pr-1"
                    disabled={isStreaming}
                  >
                    <option value="auto" className="bg-zinc-900">Auto</option>
                    <option value="high" className="bg-zinc-900">1080p</option>
                    <option value="medium" className="bg-zinc-900">720p</option>
                    <option value="low" className="bg-zinc-900">480p</option>
                  </select>
                </div>
                <span
                  className="text-white/85 text-[10px] uppercase tracking-[0.14em] font-medium"
                  style={{ textShadow: "0 1px 3px rgba(0,0,0,0.9)" }}
                >
                  Quality
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  },
);

function ControlButton({
  children,
  label,
  onClick,
  disabled,
  tone,
}: {
  children: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  tone: "primary" | "neutral" | "danger";
}) {
  const cls =
    tone === "primary"
      ? "bg-gradient-to-br from-blue-500 to-blue-600 ring-blue-300/40 hover:from-blue-500 hover:to-blue-700"
      : tone === "danger"
        ? "bg-gradient-to-br from-red-500 to-red-600 ring-red-300/40 hover:from-red-500 hover:to-red-700"
        : "bg-white/15 ring-white/25 hover:bg-white/25";
  return (
    <div className="flex flex-col items-center gap-1.5">
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        className={`w-12 h-12 rounded-full flex items-center justify-center ring-1 transition-all shadow-lg shadow-black/30 disabled:opacity-50 text-white ${cls}`}
      >
        {children}
      </button>
      <span
        className="text-white/85 text-[10px] uppercase tracking-[0.14em] font-medium"
        style={{ textShadow: "0 1px 3px rgba(0,0,0,0.9)" }}
      >
        {label}
      </span>
    </div>
  );
}
