"use client";

import type { MutableRefObject } from "react";
import { SlideshowPanel } from "@/components/host/slideshow-panel";

interface Props {
  streamId: string;
  chatChannelRef: MutableRefObject<unknown>;
}

/**
 * Media deck — slideshow + future media surfaces (clip player, b-roll,
 * etc.). Today it just hosts the existing SlideshowPanel; the wrapper
 * exists so adding a second module later means dropping it in here
 * rather than adding another tab to the producer deck.
 */
export function MediaDeck({ streamId, chatChannelRef }: Props) {
  return (
    <SlideshowPanel
      streamId={streamId}
      chatChannelRef={chatChannelRef as MutableRefObject<unknown>}
    />
  );
}
