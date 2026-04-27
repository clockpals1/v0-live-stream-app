"use client";

import { Button } from "@/components/ui/button";
import {
  Circle,
  Download,
  Film,
  Pause,
  Play,
  RefreshCw,
  Square,
  Video,
  VideoOff,
} from "lucide-react";
import { MAX_VIEWERS } from "@/lib/webrtc/config";
import { SURFACE, TYPO } from "@/lib/control-room/styles";

interface Props {
  streamTitle: string;
  roomCode: string;
  status: "waiting" | "live" | "ended";
  isStreaming: boolean;
  isPaused: boolean;
  controlRoomMode: boolean;
  isHostOnAir: boolean;
  mediaInitialized: boolean;
  hasRecording: boolean;
  showRestart: boolean;
  showOpenReplay: boolean;
  replayCount: number;
  onStart: () => void;
  onPause: () => void;
  onResume: () => void;
  onEnd: () => void;
  onRestart: () => void;
  onGoOnAir: () => void;
  onGoOffAir: () => void;
  onDownloadRecording: () => void;
  onJumpToReplay: () => void;
  onBackToDashboard: () => void;
}

/**
 * Stage Actions row — sits directly under the program preview.
 *
 * Visual goal: feel like a piece of equipment docked under the
 * monitor, NOT a generic button strip.
 *
 *   - Distinct surface treatment (panel ladder).
 *   - Show context (title + room) on the left in a typographic stack.
 *   - Action buttons grouped by purpose: "stage" (on-air toggle),
 *     "broadcast" (pause/resume/end). The primary action — Go Live or
 *     End Stream — is always the right-most button so muscle memory
 *     applies regardless of state.
 */
export function StageActions({
  streamTitle,
  roomCode,
  status,
  isStreaming,
  isPaused,
  controlRoomMode,
  isHostOnAir,
  mediaInitialized,
  hasRecording,
  showRestart,
  showOpenReplay,
  replayCount,
  onStart,
  onPause,
  onResume,
  onEnd,
  onRestart,
  onGoOnAir,
  onGoOffAir,
  onDownloadRecording,
  onJumpToReplay,
  onBackToDashboard,
}: Props) {
  return (
    <div className={`${SURFACE.panel} px-4 py-3 sm:py-3.5`}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="text-[15px] sm:text-base font-semibold text-foreground tracking-tight truncate">
              {streamTitle}
            </h1>
          </div>
          <div className="flex items-center gap-1.5 mt-0.5">
            <span className={TYPO.label}>Up to {MAX_VIEWERS} viewers</span>
            <span className="text-[10px] text-muted-foreground/50">·</span>
            <span className={TYPO.label}>Room</span>
            <code className="text-[10px] font-mono text-foreground/80 bg-muted/60 px-1.5 py-0.5 rounded">
              {roomCode}
            </code>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap shrink-0">
          {status === "ended" ? (
            <>
              {showRestart && (
                <Button onClick={onRestart} className="h-9">
                  <RefreshCw className="w-4 h-4 mr-2" />
                  Restart Stream
                </Button>
              )}
              {hasRecording && (
                <Button variant="outline" onClick={onDownloadRecording} className="h-9">
                  <Download className="w-4 h-4 mr-2" />
                  Download
                </Button>
              )}
              {showOpenReplay && (
                <Button variant="secondary" onClick={onJumpToReplay} className="h-9 gap-2">
                  <Film className="w-4 h-4" />
                  Open Replay
                  <span className="inline-flex h-5 min-w-[20px] px-1.5 items-center justify-center rounded-full text-[10px] font-semibold bg-primary/15 text-primary">
                    {replayCount}
                  </span>
                </Button>
              )}
              <Button variant="outline" onClick={onBackToDashboard} className="h-9">
                Back to Dashboard
              </Button>
            </>
          ) : isStreaming ? (
            <>
              {/* Stage cluster — controls THE HOST'S camera, not the broadcast */}
              {controlRoomMode &&
                (isHostOnAir ? (
                  <Button
                    variant="outline"
                    onClick={onGoOffAir}
                    className="h-9"
                    title="Stop publishing your camera to viewers"
                  >
                    <VideoOff className="w-4 h-4 mr-2" />
                    Off-Air
                  </Button>
                ) : (
                  <Button
                    onClick={onGoOnAir}
                    className="h-9 bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm shadow-emerald-600/25"
                    title="Publish your camera so viewers can see you"
                  >
                    <Video className="w-4 h-4 mr-2" />
                    Go On-Air
                  </Button>
                ))}

              {/* Visual divider between stage and broadcast clusters */}
              <span className="hidden sm:block w-px h-6 bg-gradient-to-b from-transparent via-border to-transparent mx-0.5" />

              {/* Broadcast cluster — controls the LIVE state itself */}
              {isPaused ? (
                <Button onClick={onResume} className="h-9">
                  <Play className="w-4 h-4 mr-2" />
                  Resume
                </Button>
              ) : (
                <Button variant="outline" onClick={onPause} className="h-9">
                  <Pause className="w-4 h-4 mr-2" />
                  Pause
                </Button>
              )}
              <Button variant="destructive" onClick={onEnd} className="h-9">
                <Square className="w-4 h-4 mr-2 fill-current" />
                End Stream
              </Button>
            </>
          ) : (
            <Button
              onClick={onStart}
              disabled={!mediaInitialized}
              className="h-10 px-5 text-sm font-semibold gap-2 bg-gradient-to-r from-red-500 to-rose-500 hover:from-red-500 hover:to-rose-600 text-white shadow-md shadow-red-500/30 ring-1 ring-red-300/30"
            >
              <Circle className="w-3.5 h-3.5 fill-current" />
              Go Live
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
