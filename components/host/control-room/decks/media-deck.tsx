"use client";

import type { MutableRefObject } from "react";
import { Image as ImageIcon } from "lucide-react";
import { SlideshowPanel } from "@/components/host/slideshow-panel";
import { VideoClipPanel } from "@/components/host/video-clip-panel";
import { DeckHeader } from "@/components/host/control-room/deck-header";

interface Props {
  streamId: string;
  chatChannelRef: MutableRefObject<unknown>;
  /**
   * Forwarded to the video-clip panel so it can ask the parent to
   * mute / restore the host's outgoing mic when "Mute mic while
   * playing" is enabled.
   */
  onClipActiveChange?: (active: boolean, muteMic: boolean) => void;
}

/**
 * Media deck — host's roll-cart for non-camera content.
 *
 * Two stackable cards:
 *   - Image slideshow : cycle still images (host upload OR paste URL)
 *   - Short video clip: roll a short mp4/webm with optional mic mute
 *
 * Both reuse the existing chat broadcast channel (no extra subscription
 * cost) and persist their state to the streams row so a page reload
 * doesn't kill an in-progress segment.
 */
export function MediaDeck({
  streamId,
  chatChannelRef,
  onClipActiveChange,
}: Props) {
  return (
    <div className="flex flex-col gap-3.5">
      <DeckHeader
        icon={ImageIcon}
        title="Media"
        description="Slideshow images and short video clips you can roll over your live stream."
      />
      <SlideshowPanel
        streamId={streamId}
        chatChannelRef={chatChannelRef as MutableRefObject<unknown>}
      />
      <VideoClipPanel
        streamId={streamId}
        chatChannelRef={chatChannelRef as MutableRefObject<unknown>}
        onClipActiveChange={onClipActiveChange}
      />
    </div>
  );
}
