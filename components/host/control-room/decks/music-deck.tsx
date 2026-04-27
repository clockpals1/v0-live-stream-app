"use client";

import { Music2 } from "lucide-react";
import { OverlayMusic, type OverlayMusicHandle } from "@/components/host/overlay-music";
import { DeckHeader } from "@/components/host/control-room/deck-header";

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
    <div className="flex flex-col gap-3.5">
      <DeckHeader
        icon={Music2}
        title="Music"
        description="Background audio mixed with your mic and broadcast to viewers."
        status={
          state.active ? { label: "Playing live", tone: "live" } : undefined
        }
      />
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
    </div>
  );
}
