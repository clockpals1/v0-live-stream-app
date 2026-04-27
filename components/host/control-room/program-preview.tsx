"use client";

import { forwardRef } from "react";
import {
  Camera,
  CheckCircle2,
  RefreshCw,
  Smartphone,
  Mic,
  MicOff,
  SwitchCamera,
  Video,
  VideoOff,
  WifiOff as DataSaver,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { StreamOverlay } from "@/components/stream/stream-overlay";
import type { OverlayPreset } from "@/lib/control-room/types";

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
 * The video element is forwarded so the host page can attach the
 * appropriate stream (relay > host-on-air > black) using the same
 * priority chain used server-side.
 *
 * Bottom controls bar lives inside the preview card so it overlaps
 * the video on small screens (no separate strip stealing height).
 *
 * Watermark renders absolutely-positioned over the video when present.
 * It is purely a host-side overlay; the outgoing WebRTC track is
 * unaffected (a watermark on the outgoing pixels would require canvas
 * compositing which is out-of-scope for this redesign).
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

    return (
      <Card className="overflow-hidden">
        <CardContent className="p-0">
          <div className="relative aspect-video bg-black">
            {/* Top-left: camera mode + mobile indicator */}
            <div className="absolute top-3 left-3 flex items-center gap-2 z-10">
              <Badge
                className={`text-xs border font-medium ${
                  cameraFacingMode === "environment"
                    ? "bg-blue-500/80 text-white border-blue-400"
                    : "bg-black/50 text-white border-white/20"
                }`}
              >
                <Camera className="w-3 h-3 mr-1" />
                {cameraFacingMode === "environment" ? "Rear Camera" : "Front Camera"}
              </Badge>
              {isMobile && (
                <Badge variant="outline" className="text-xs bg-black/50 text-white border-white/20">
                  <Smartphone className="w-3 h-3 mr-1" />
                  Mobile
                </Badge>
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
              <div className="absolute inset-0 flex items-center justify-center bg-muted">
                <VideoOff className="w-16 h-16 text-muted-foreground" />
              </div>
            )}

            {/* Branded watermark — purely host-preview; viewers do NOT see it */}
            {watermarkUrl && (
              <div className={`absolute z-10 ${wmPos[watermarkPosition]}`}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={watermarkUrl}
                  alt="Watermark preview"
                  className="h-10 w-auto opacity-80 drop-shadow-lg"
                />
              </div>
            )}

            {/* On-stage overlay — mirrors what viewers see */}
            <StreamOverlay
              active={overlay.active}
              message={overlay.message}
              background={overlay.background}
              imageUrl={overlay.imageUrl}
            />

            {/* Bottom controls bar */}
            <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent pt-8 pb-4 px-4">
              <div className="flex items-end justify-center gap-4">
                <ControlButton
                  label={isSwitching ? "Switching..." : cameraFacingMode === "environment" ? "Rear" : "Front"}
                  onClick={onRotateCamera}
                  disabled={!mediaInitialized || isSwitching}
                  active={cameraFacingMode === "environment"}
                  variant="primary"
                >
                  {isSwitching ? (
                    <RefreshCw className="w-6 h-6 text-white animate-spin" />
                  ) : (
                    <SwitchCamera className="w-6 h-6 text-white" />
                  )}
                </ControlButton>

                <ControlButton
                  label={videoEnabled ? "Camera" : "Off"}
                  onClick={onToggleVideo}
                  disabled={!mediaInitialized}
                  active={videoEnabled}
                  variant={videoEnabled ? "neutral" : "danger"}
                >
                  {videoEnabled ? (
                    <Video className="w-6 h-6 text-white" />
                  ) : (
                    <VideoOff className="w-6 h-6 text-white" />
                  )}
                </ControlButton>

                <ControlButton
                  label={audioEnabled ? "Mic" : "Muted"}
                  onClick={onToggleAudio}
                  disabled={!mediaInitialized}
                  active={audioEnabled}
                  variant={audioEnabled ? "neutral" : "danger"}
                >
                  {audioEnabled ? (
                    <Mic className="w-6 h-6 text-white" />
                  ) : (
                    <MicOff className="w-6 h-6 text-white" />
                  )}
                </ControlButton>

                <div className="flex flex-col items-center gap-1.5">
                  <div className="h-14 flex items-center bg-black/60 rounded-full px-3 gap-1.5 border border-white/20">
                    <button
                      type="button"
                      onClick={onToggleDataSaver}
                      disabled={isStreaming}
                      className="disabled:opacity-50"
                      aria-label="Toggle data saver"
                    >
                      <DataSaver className={`w-4 h-4 ${isDataSaver ? "text-orange-400" : "text-white"}`} />
                    </button>
                    <select
                      value={videoQuality}
                      onChange={(e) => onChangeQuality(e.target.value as "auto" | "high" | "medium" | "low")}
                      className="bg-transparent text-white text-xs border-none outline-none cursor-pointer disabled:opacity-50"
                      disabled={isStreaming}
                    >
                      <option value="auto" className="bg-gray-800">Auto</option>
                      <option value="high" className="bg-gray-800">1080p</option>
                      <option value="medium" className="bg-gray-800">720p</option>
                      <option value="low" className="bg-gray-800">480p</option>
                    </select>
                  </div>
                  <span
                    className="text-white text-xs font-medium"
                    style={{ textShadow: "0 1px 3px rgba(0,0,0,0.9)" }}
                  >
                    Quality
                  </span>
                </div>
              </div>
            </div>

            {/* Top-right: connection status */}
            <div className="absolute top-3 right-3 z-10">
              {isStreaming ? (
                <Badge className="bg-red-500 text-white gap-1 border-0">
                  <span className="w-1.5 h-1.5 rounded-full bg-white animate-ping" />
                  LIVE
                </Badge>
              ) : mediaInitialized ? (
                <Badge variant="outline" className="gap-1 bg-black/50 text-white border-white/20">
                  <CheckCircle2 className="w-3 h-3 text-green-400" />
                  Ready
                </Badge>
              ) : (
                <Badge variant="outline" className="gap-1 bg-black/50 text-white border-white/20">
                  <RefreshCw className="w-3 h-3 animate-spin" />
                  Starting...
                </Badge>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    );
  },
);

function ControlButton({
  children,
  label,
  onClick,
  disabled,
  active,
  variant,
}: {
  children: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  active: boolean;
  variant: "primary" | "neutral" | "danger";
}) {
  const cls =
    variant === "primary" && active
      ? "bg-blue-500/90 border-blue-300 hover:bg-blue-600/90"
      : variant === "danger"
        ? "bg-red-500/90 border-red-300 hover:bg-red-600/90"
        : "bg-white/20 border-white/40 hover:bg-white/30";
  return (
    <div className="flex flex-col items-center gap-1.5">
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        className={`w-14 h-14 rounded-full flex items-center justify-center border-2 transition-all shadow-lg disabled:opacity-50 ${cls}`}
      >
        {children}
      </button>
      <span
        className="text-white text-xs font-medium"
        style={{ textShadow: "0 1px 3px rgba(0,0,0,0.9)" }}
      >
        {label}
      </span>
    </div>
  );
}
