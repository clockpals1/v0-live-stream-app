"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import { playNotificationSound } from "@/lib/utils/notification";
import {
  Bell,
  BellOff,
  Users,
  CreditCard,
  Radio,
  Archive,
  Video,
  PlaySquare,
  Info,
  CheckCheck,
  ArrowUpRight,
  Inbox,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";

// ─── Types ──────────────────────────────────────────────────────────

type NotifType = "info" | "success" | "warning" | "error";
type NotifCategory =
  | "subscriber"
  | "payment"
  | "stream"
  | "archive"
  | "cohost"
  | "replay"
  | "general";

interface HostNotification {
  id: string;
  type: NotifType;
  category: NotifCategory;
  title: string;
  body: string | null;
  link: string | null;
  read: boolean;
  created_at: string;
}

// ─── Icon + colour helpers ───────────────────────────────────────────

const CATEGORY_ICON: Record<NotifCategory, React.ElementType> = {
  subscriber: Users,
  payment: CreditCard,
  stream: Radio,
  archive: Archive,
  cohost: Video,
  replay: PlaySquare,
  general: Info,
};

const TYPE_DOT: Record<NotifType, string> = {
  success: "bg-green-500",
  info: "bg-blue-500",
  warning: "bg-amber-500",
  error: "bg-red-500",
};

const CATEGORY_ICON_BG: Record<NotifCategory, string> = {
  subscriber: "bg-purple-500/10 text-purple-500",
  payment: "bg-green-500/10 text-green-500",
  stream: "bg-red-500/10 text-red-500",
  archive: "bg-sky-500/10 text-sky-500",
  cohost: "bg-indigo-500/10 text-indigo-500",
  replay: "bg-orange-500/10 text-orange-500",
  general: "bg-muted text-muted-foreground",
};

// ─── Component ──────────────────────────────────────────────────────

interface NotificationBellProps {
  hostId: string;
}

export function NotificationBell({ hostId }: NotificationBellProps) {
  const supabase = createClient();
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState<HostNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [markingRead, setMarkingRead] = useState(false);

  const fetchNotifications = useCallback(async () => {
    try {
      const res = await fetch("/api/host/notifications");
      if (!res.ok) return;
      const json = await res.json();
      setNotifications(json.notifications ?? []);
      setUnreadCount(json.unread_count ?? 0);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchNotifications();
  }, [fetchNotifications]);

  // ── Real-time: new notifications pushed from the server ──────────
  useEffect(() => {
    const channel = supabase
      .channel(`host-notifs-${hostId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "host_notifications",
          filter: `host_id=eq.${hostId}`,
        },
        (payload: { new: Record<string, unknown> }) => {
          const newNotif = payload.new as unknown as HostNotification;
          setNotifications((prev) => [newNotif, ...prev].slice(0, 40));
          setUnreadCount((c) => c + 1);
          playNotificationSound();
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [hostId, supabase]);

  const markAllRead = async () => {
    if (unreadCount === 0) return;
    setMarkingRead(true);
    try {
      await fetch("/api/host/notifications/read-all", { method: "PATCH" });
      setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
      setUnreadCount(0);
    } finally {
      setMarkingRead(false);
    }
  };

  const handleOpen = (next: boolean) => {
    setOpen(next);
    if (next && unreadCount > 0) {
      // Optimistically mark as read on open
      markAllRead();
    }
  };

  return (
    <Popover open={open} onOpenChange={handleOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="relative h-8 w-8 p-0"
          aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ""}`}
        >
          <Bell className="h-4 w-4" />
          {unreadCount > 0 && (
            <span className="absolute top-0.5 right-0.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-primary px-0.5 text-[9px] font-bold text-primary-foreground">
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
          )}
        </Button>
      </PopoverTrigger>

      <PopoverContent
        align="end"
        sideOffset={8}
        className="w-[360px] p-0 shadow-lg"
      >
        {/* ── Header ─────────────────────────────────────────────── */}
        <div className="flex items-center justify-between border-b border-border/60 px-4 py-3">
          <div className="flex items-center gap-2">
            <Bell className="h-4 w-4 text-foreground" />
            <span className="font-semibold text-sm">Notifications</span>
            {unreadCount > 0 && (
              <Badge className="h-4 px-1.5 text-[10px] bg-primary text-primary-foreground">
                {unreadCount}
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-1">
            {unreadCount > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
                onClick={markAllRead}
                disabled={markingRead}
              >
                <CheckCheck className="h-3 w-3 mr-1" />
                Mark all read
              </Button>
            )}
            <Button variant="ghost" size="sm" className="h-7 px-2" asChild>
              <Link href="/host/settings?tab=notifications">
                <ArrowUpRight className="h-3.5 w-3.5 text-muted-foreground" />
              </Link>
            </Button>
          </div>
        </div>

        {/* ── Feed ───────────────────────────────────────────────── */}
        <div className="max-h-[420px] overflow-y-auto">
          {loading ? (
            <div className="flex flex-col gap-3 p-4">
              {[1, 2, 3].map((i) => (
                <div key={i} className="flex gap-3 animate-pulse">
                  <div className="h-8 w-8 shrink-0 rounded-lg bg-muted" />
                  <div className="flex-1 space-y-1.5">
                    <div className="h-3 w-3/4 rounded bg-muted" />
                    <div className="h-2.5 w-1/2 rounded bg-muted" />
                  </div>
                </div>
              ))}
            </div>
          ) : notifications.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center px-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted mb-3">
                <Inbox className="h-5 w-5 text-muted-foreground" />
              </div>
              <p className="text-sm font-medium">All caught up</p>
              <p className="text-xs text-muted-foreground mt-1">
                New events like subscribers, payments, and stream updates will appear here.
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-border/40">
              {notifications.map((notif) => {
                const Icon = CATEGORY_ICON[notif.category] ?? Info;
                const iconBg = CATEGORY_ICON_BG[notif.category];
                const dot = TYPE_DOT[notif.type];
                const timeAgo = formatDistanceToNow(new Date(notif.created_at), {
                  addSuffix: true,
                });

                const inner = (
                  <div
                    className={cn(
                      "flex gap-3 px-4 py-3 transition-colors",
                      notif.read
                        ? "hover:bg-muted/40"
                        : "bg-primary/3 hover:bg-primary/5",
                    )}
                  >
                    {/* Icon */}
                    <div
                      className={cn(
                        "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg",
                        iconBg,
                      )}
                    >
                      <Icon className="h-4 w-4" />
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <p
                          className={cn(
                            "text-sm leading-snug",
                            !notif.read && "font-medium",
                          )}
                        >
                          {notif.title}
                        </p>
                        {/* Unread dot */}
                        {!notif.read && (
                          <span
                            className={cn(
                              "mt-1.5 h-2 w-2 shrink-0 rounded-full",
                              dot,
                            )}
                          />
                        )}
                      </div>
                      {notif.body && (
                        <p className="mt-0.5 text-xs text-muted-foreground line-clamp-2">
                          {notif.body}
                        </p>
                      )}
                      <p className="mt-1 text-[10px] text-muted-foreground/70">
                        {timeAgo}
                      </p>
                    </div>
                  </div>
                );

                return (
                  <li key={notif.id}>
                    {notif.link ? (
                      <Link href={notif.link} onClick={() => setOpen(false)}>
                        {inner}
                      </Link>
                    ) : (
                      inner
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* ── Footer ─────────────────────────────────────────────── */}
        {notifications.length > 0 && (
          <div className="border-t border-border/60 px-4 py-2.5 flex items-center justify-between">
            <span className="text-[11px] text-muted-foreground">
              Showing last {notifications.length} notification{notifications.length !== 1 ? "s" : ""}
            </span>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-[11px] gap-1 text-muted-foreground hover:text-foreground"
              asChild
            >
              <Link href="/host/settings?tab=notifications" onClick={() => setOpen(false)}>
                <BellOff className="h-3 w-3" />
                Preferences
              </Link>
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
