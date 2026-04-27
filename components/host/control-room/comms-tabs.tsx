"use client";

import { forwardRef } from "react";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { Camera, Film, Lock, MessageCircle, type LucideIcon } from "lucide-react";
import { SURFACE } from "@/lib/control-room/styles";

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

interface TabMeta {
  key: string;
  label: string;
  icon: LucideIcon;
  badge?: string | number | null;
  show: boolean;
}

/**
 * Comms tabs — sticky right-rail of the control room. Custom tab
 * buttons (instead of shadcn TabsTrigger styling) so each tab gets a
 * proper icon + label + count tuple, and the active state is a soft
 * gradient pill rather than a default underline.
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
  const tabs: TabMeta[] = [
    {
      key: "chat",
      label: "Chat",
      icon: MessageCircle,
      badge: unreadCount > 0 ? unreadCount : messageCount > 0 ? messageCount : null,
      show: true,
    },
    { key: "private", label: "Private", icon: Lock, show: true },
    { key: "cameras", label: "Cameras", icon: Camera, show: showCameras },
    {
      key: "replay",
      label: "Replay",
      icon: Film,
      badge: replayCount > 0 ? replayCount : null,
      show: showReplay,
    },
  ];

  return (
    <section
      ref={ref}
      className={`${SURFACE.panel} flex flex-col overflow-hidden h-[calc(100vh-7rem)] xl:sticky xl:top-20 xl:self-start`}
    >
      <Tabs
        value={activeTab}
        onValueChange={onTabChange}
        className="flex flex-col h-full"
      >
        <div className="px-2.5 pt-2.5 pb-0">
          <div className="flex items-center gap-1 p-1 bg-muted/50 rounded-lg ring-1 ring-border/60">
            {tabs
              .filter((t) => t.show)
              .map((t) => {
                const isActive = activeTab === t.key;
                const Icon = t.icon;
                const isUnread = t.key === "chat" && unreadCount > 0;
                return (
                  <button
                    key={t.key}
                    type="button"
                    onClick={() => onTabChange(t.key)}
                    className={`relative flex-1 inline-flex items-center justify-center gap-1 h-8 px-1.5 rounded-md text-[11px] font-medium transition-all ${
                      isActive
                        ? "bg-background text-foreground shadow-sm ring-1 ring-border/70"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <Icon className="w-3.5 h-3.5" />
                    <span className="hidden xs:inline lg:inline">{t.label}</span>
                    {t.badge != null && (
                      <span
                        className={`ml-0.5 inline-flex items-center justify-center min-w-[16px] h-4 px-1 rounded-full text-[9px] font-semibold leading-none ${
                          isUnread
                            ? "bg-red-500 text-white"
                            : "bg-foreground/10 text-foreground/70"
                        }`}
                      >
                        {typeof t.badge === "number" && t.badge > 9 ? "9+" : t.badge}
                      </span>
                    )}
                  </button>
                );
              })}
          </div>
        </div>

        <TabsContent
          value="chat"
          className="flex-1 min-h-0 flex flex-col mt-0 overflow-hidden data-[state=active]:flex"
        >
          {chatPane}
        </TabsContent>
        <TabsContent
          value="private"
          className="flex-1 overflow-hidden mt-0 px-3 pb-3 pt-2 data-[state=active]:flex data-[state=active]:flex-col"
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
    </section>
  );
});
