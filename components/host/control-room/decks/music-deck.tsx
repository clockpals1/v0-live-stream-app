"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Music2 } from "lucide-react";
import { OverlayMusic, type OverlayMusicHandle } from "@/components/host/overlay-music";

interface Props {
  streamId: string;
  innerRef: React.RefObject<OverlayMusicHandle | null>;
  currentUrl: string;
  micTrack: MediaStreamTrack | null;
  isStreaming: boolean;
  state: { active: boolean; volume: number; mixWithMic: boolean };
  onLiveAudioTrack: (track: MediaStreamTrack | null) => void;
  onUploaded: (url: string) => void;
  onCleared: () => void;
  onStateChange: (s: { active: boolean; volume: number; mixWithMic: boolean }) => void;
}

/**
 * Music deck — host-uploaded audio fed to viewers via the audio
 * sender swap inside useHostStream.setLiveAudioTrack(). The actual
 * upload + mixer + playback UI lives in the existing OverlayMusic
 * component; this wrapper just gives it a labelled card surface.
 */
export function MusicDeck({
  streamId,
  innerRef,
  currentUrl,
  micTrack,
  isStreaming,
  state,
  onLiveAudioTrack,
  onUploaded,
  onCleared,
  onStateChange,
}: Props) {
  return (
    <Card>
      <CardHeader className="pb-3 border-b">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
              <Music2 className="w-4 h-4 text-primary" />
            </div>
            <div className="min-w-0">
              <CardTitle className="text-sm font-semibold">Music</CardTitle>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                Background audio mixed with your mic and broadcast to viewers.
              </p>
            </div>
          </div>
          {state.active && (
            <Badge className="bg-green-500 text-white text-[10px] h-5 px-1.5 shrink-0">
              PLAYING LIVE
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <OverlayMusic
          ref={innerRef}
          streamId={streamId}
          currentUrl={currentUrl}
          micTrack={micTrack}
          isStreaming={isStreaming}
          initial={state}
          onLiveAudioTrack={onLiveAudioTrack}
          onUploaded={onUploaded}
          onCleared={onCleared}
          onStateChange={onStateChange}
        />
      </CardContent>
    </Card>
  );
}
