"use client";

import type { MutableRefObject } from "react";
import { Image as ImageIcon } from "lucide-react";
import { SlideshowPanel } from "@/components/host/slideshow-panel";
import { DeckHeader } from "@/components/host/control-room/deck-header";

interface Props {
  streamId: string;
  chatChannelRef: MutableRefObject<unknown>;
}

export function MediaDeck({ streamId, chatChannelRef }: Props) {
  return (
    <div className="flex flex-col gap-3.5">
      <DeckHeader
        icon={ImageIcon}
        title="Media"
        description="Slideshow images shown over your stream during scenes."
      />
      <SlideshowPanel
        streamId={streamId}
        chatChannelRef={chatChannelRef as MutableRefObject<unknown>}
      />
    </div>
  );
}
