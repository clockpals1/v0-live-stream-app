"use client";

import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Activity,
  Image as ImageIcon,
  Megaphone,
  Music2,
  Sparkles,
  Tv,
} from "lucide-react";

interface Props {
  overlayDeck: React.ReactNode;
  tickerDeck: React.ReactNode;
  musicDeck: React.ReactNode;
  mediaDeck: React.ReactNode;
  brandingDeck: React.ReactNode;
  healthDeck: React.ReactNode;
}

/**
 * Producer Deck — horizontal tabs over the producer modules. Replaces
 * the previous "scroll past 6 cards stacked vertically" layout. The
 * host picks a tool, configures it, and switches to the next without
 * leaving the program preview behind.
 *
 * Tabs are uncontrolled at this level — none of these decks have any
 * cross-deck state. The control-room state hook is the source of truth
 * for everything they read from.
 */
export function ProducerDeck({
  overlayDeck,
  tickerDeck,
  musicDeck,
  mediaDeck,
  brandingDeck,
  healthDeck,
}: Props) {
  const [tab, setTab] = useState("overlay");
  return (
    <Card>
      <CardContent className="p-3 sm:p-4">
        <Tabs value={tab} onValueChange={setTab} className="w-full">
          <TabsList className="grid grid-cols-3 sm:grid-cols-6 w-full mb-3">
            <TabsTrigger value="overlay" className="text-xs gap-1.5">
              <Megaphone className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Overlay</span>
            </TabsTrigger>
            <TabsTrigger value="ticker" className="text-xs gap-1.5">
              <Tv className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Ticker</span>
            </TabsTrigger>
            <TabsTrigger value="music" className="text-xs gap-1.5">
              <Music2 className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Music</span>
            </TabsTrigger>
            <TabsTrigger value="media" className="text-xs gap-1.5">
              <ImageIcon className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Media</span>
            </TabsTrigger>
            <TabsTrigger value="branding" className="text-xs gap-1.5">
              <Sparkles className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Branding</span>
            </TabsTrigger>
            <TabsTrigger value="health" className="text-xs gap-1.5">
              <Activity className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Health</span>
            </TabsTrigger>
          </TabsList>
          <TabsContent value="overlay" className="mt-0">{overlayDeck}</TabsContent>
          <TabsContent value="ticker" className="mt-0">{tickerDeck}</TabsContent>
          <TabsContent value="music" className="mt-0">{musicDeck}</TabsContent>
          <TabsContent value="media" className="mt-0">{mediaDeck}</TabsContent>
          <TabsContent value="branding" className="mt-0">{brandingDeck}</TabsContent>
          <TabsContent value="health" className="mt-0">{healthDeck}</TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
