"use client";

import { forwardRef } from "react";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Camera, Film, Lock, MessageCircle } from "lucide-react";

interface Props {
  activeTab: string;
  onTabChange: (v: string) => void;
  unreadCount: number;
  messageCount: number;
  showCameras: boolean;
  showReplay: boolean;
  replayCount: number;
  chatPane: React.ReactNode;
  privatePane: React.ReactNode;
  camerasPane?: React.ReactNode;
  replayPane?: React.ReactNode;
}

/**
 * Comms tabs — sticky right-rail of the control room. Hosts:
 *   - Chat       (public room chat, with unread indicator)
 *   - Private    (DM panel)
 *   - Cameras    (DirectorPanel for switching co-hosts on-air)
 *   - Replay     (per-section recordings with Save to Cloud)
 *
 * The card itself is forwarded so the parent can scrollIntoView() it
 * when the post-stream CTA jumps the host to the Replay tab on
 * narrow viewports where the rail sits below the player.
 */
export const CommsTabs = forwardRef<HTMLDivElement, Props>(function CommsTabs(
  {
    activeTab,
    onTabChange,
    unreadCount,
    messageCount,
    showCameras,
    showReplay,
    replayCount,
    chatPane,
    privatePane,
    camerasPane,
    replayPane,
  },
  ref,
) {
  return (
    <Card
      ref={ref}
      className="flex flex-col overflow-hidden h-[calc(100vh-7rem)] xl:sticky xl:top-20 xl:self-start"
    >
      <Tabs
        value={activeTab}
        onValueChange={onTabChange}
        className="flex flex-col h-full"
      >
        <div className="px-3 pt-3 pb-0 border-b border-border">
          <TabsList className="w-full">
            <TabsTrigger value="chat" className="flex-1 text-xs gap-1">
              <MessageCircle className="w-3.5 h-3.5" />
              Chat
              {unreadCount > 0 ? (
                <span className="ml-0.5 min-w-[16px] h-4 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center px-1 leading-none">
                  {unreadCount > 9 ? "9+" : unreadCount}
                </span>
              ) : messageCount > 0 ? (
                <span className="text-muted-foreground">({messageCount})</span>
              ) : null}
            </TabsTrigger>
            <TabsTrigger value="private" className="flex-1 text-xs gap-1">
              <Lock className="w-3.5 h-3.5" />
              Private
            </TabsTrigger>
            {showCameras && (
              <TabsTrigger value="cameras" className="flex-1 text-xs gap-1">
                <Camera className="w-3.5 h-3.5" />
                Cameras
              </TabsTrigger>
            )}
            {showReplay && (
              <TabsTrigger value="replay" className="flex-1 text-xs gap-1">
                <Film className="w-3.5 h-3.5" />
                Replay
                {replayCount > 0 && (
                  <span className="text-muted-foreground">({replayCount})</span>
                )}
              </TabsTrigger>
            )}
          </TabsList>
        </div>

        <TabsContent
          value="chat"
          className="flex-1 min-h-0 flex flex-col mt-0 overflow-hidden data-[state=active]:flex"
        >
          {chatPane}
        </TabsContent>
        <TabsContent
          value="private"
          className="flex-1 overflow-hidden mt-0 data-[state=active]:flex data-[state=active]:flex-col"
        >
          {privatePane}
        </TabsContent>
        {showCameras && (
          <TabsContent
            value="cameras"
            className="flex-1 overflow-hidden mt-0 data-[state=active]:flex data-[state=active]:flex-col"
          >
            {camerasPane}
          </TabsContent>
        )}
        {showReplay && (
          <TabsContent
            value="replay"
            className="flex-1 overflow-hidden mt-0 data-[state=active]:flex data-[state=active]:flex-col"
          >
            {replayPane}
          </TabsContent>
        )}
      </Tabs>
    </Card>
  );
});
