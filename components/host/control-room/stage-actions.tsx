"use client";

import { Card, CardContent } from "@/components/ui/card";
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
 * Single Stage-Actions card. Picks one of three button rows based on
 * stream status: waiting (start), live (on-air toggle + pause/end),
 * ended (restart/download/replay/back). Title + room appear on the
 * left so the host always has show context next to the action.
 */
export function StageActions({
  streamTitle,
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
  roomCode,
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
    <Card className="-mt-4 rounded-t-none border-t-0">
      <CardContent className="p-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-lg sm:text-xl font-semibold text-foreground truncate">
            {streamTitle}
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Up to {MAX_VIEWERS} viewers · Room <code className="font-mono">{roomCode}</code>
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap shrink-0">
          {status === "ended" ? (
            <>
              {showRestart && (
                <Button onClick={onRestart}>
                  <RefreshCw className="w-4 h-4 mr-2" />
                  Restart Stream
                </Button>
              )}
              {hasRecording && (
                <Button variant="outline" onClick={onDownloadRecording}>
                  <Download className="w-4 h-4 mr-2" />
                  Download Recording
                </Button>
              )}
              {showOpenReplay && (
                <Button variant="secondary" onClick={onJumpToReplay}>
                  <Film className="w-4 h-4 mr-2" />
                  Open Replay ({replayCount})
                </Button>
              )}
              <Button variant="outline" onClick={onBackToDashboard}>
                Back to Dashboard
              </Button>
            </>
          ) : isStreaming ? (
            <div className="flex items-center gap-2 flex-wrap">
              {controlRoomMode &&
                (isHostOnAir ? (
                  <Button
                    variant="outline"
                    onClick={onGoOffAir}
                    title="Stop publishing your camera to viewers"
                  >
                    <VideoOff className="w-4 h-4 mr-2" />
                    Stop My Camera
                  </Button>
                ) : (
                  <Button
                    variant="default"
                    onClick={onGoOnAir}
                    className="bg-green-600 hover:bg-green-700"
                    title="Publish your camera so viewers can see you"
                  >
                    <Video className="w-4 h-4 mr-2" />
                    Go On-Air
                  </Button>
                ))}
              {isPaused ? (
                <Button variant="default" onClick={onResume}>
                  <Play className="w-4 h-4 mr-2" />
                  Resume
                </Button>
              ) : (
                <Button variant="outline" onClick={onPause}>
                  <Pause className="w-4 h-4 mr-2" />
                  Pause
                </Button>
              )}
              <Button variant="destructive" onClick={onEnd}>
                <Square className="w-4 h-4 mr-2" />
                End Stream
              </Button>
            </div>
          ) : (
            <Button
              onClick={onStart}
              disabled={!mediaInitialized}
              size="lg"
              className="bg-red-500 hover:bg-red-600 text-white gap-2 shadow-md shadow-red-500/20"
            >
              <Circle className="w-4 h-4 fill-current" />
              Go Live
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
