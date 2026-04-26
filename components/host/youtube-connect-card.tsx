"use client";

import { useEffect, useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import {
  Youtube,
  CheckCircle2,
  Link as LinkIcon,
  Unlink,
  AlertTriangle,
  Sparkles,
  ArrowUpRight,
} from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Host dashboard card — manage the YouTube channel connection.
 *
 * States it renders:
 *   1. Plan disallows youtube_upload     → upgrade CTA.
 *   2. Server not configured (GOOGLE_*)  → admin alert.
 *   3. Available + not connected         → "Connect YouTube" button.
 *   4. Connected                         → channel info + Disconnect.
 *
 * URL params:
 *   ?youtube=connected → success toast + refresh
 *   ?youtube=cancelled → info toast
 *   ?youtube=error&reason=… → error toast
 *
 * Disconnects open a confirm dialog because the action is destructive
 * (refresh token is irrecoverable; reconnect needs full consent again).
 */

interface ApiStatus {
  serverConfigured: boolean;
  planAllows: boolean;
  available: boolean;
  connected: null | {
    providerAccountId: string | null;
    providerAccountName: string | null;
    providerAccountAvatarUrl: string | null;
    connectedAt: string;
    scopes: string[];
  };
}

export function YoutubeConnectCard() {
  const [status, setStatus] = useState<ApiStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [disconnecting, setDisconnecting] = useState(false);

  async function refresh() {
    try {
      const res = await fetch("/api/host/integrations/youtube/status", {
        cache: "no-store",
      });
      const json = (await res.json()) as ApiStatus & { error?: string };
      if (!res.ok) throw new Error(json.error ?? "Failed");
      setStatus(json);
    } catch (e) {
      console.error("[youtube-connect] refresh failed:", e);
      setStatus({
        serverConfigured: false,
        planAllows: false,
        available: false,
        connected: null,
      });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  // Surface the OAuth callback's redirect status as a toast and refetch.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const yt = params.get("youtube");
    if (!yt) return;
    const reason = params.get("reason");
    if (yt === "connected") {
      toast.success("YouTube channel connected.");
      refresh();
    } else if (yt === "cancelled") {
      toast.info("YouTube connection cancelled.");
    } else if (yt === "error") {
      toast.error(
        reason
          ? `Couldn't connect YouTube: ${reason}`
          : "Couldn't connect YouTube.",
      );
    }
    params.delete("youtube");
    params.delete("reason");
    const next = params.toString();
    const url = window.location.pathname + (next ? `?${next}` : "");
    window.history.replaceState({}, "", url);
  }, []);

  async function handleDisconnect() {
    setDisconnecting(true);
    try {
      const res = await fetch("/api/integrations/youtube", { method: "DELETE" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Disconnect failed.");
      toast.success("YouTube disconnected.");
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Disconnect failed.");
    } finally {
      setDisconnecting(false);
    }
  }

  if (loading) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Youtube className="h-4 w-4 text-rose-500" />
            YouTube
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-sm text-muted-foreground">Loading…</div>
        </CardContent>
      </Card>
    );
  }
  if (!status) return null;

  // Plan disallows.
  if (!status.planAllows) {
    return (
      <Card className="border-primary/30">
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                <Youtube className="h-4 w-4 text-rose-500" />
                YouTube
              </CardTitle>
              <CardDescription className="mt-1">
                Auto-upload your stream recordings to your YouTube channel.
              </CardDescription>
            </div>
            <Badge variant="outline" className="text-muted-foreground">
              Upgrade
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex items-start gap-2.5 rounded-lg border border-primary/30 bg-primary/5 p-3">
            <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            <div className="min-w-0 flex-1 text-sm">
              <div className="font-medium text-foreground">
                YouTube upload is a paid feature
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Skip the manual export — your recordings publish to YouTube
                in one click after every stream.
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                window.location.hash = "subscription";
                document
                  .querySelector("[data-subscription-card]")
                  ?.scrollIntoView({ behavior: "smooth" });
              }}
            >
              See plans
              <ArrowUpRight className="ml-1 h-3 w-3" />
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Server not configured.
  if (!status.serverConfigured) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Youtube className="h-4 w-4 text-rose-500" />
            YouTube
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-start gap-2.5 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-amber-700 dark:text-amber-300">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <div className="text-xs">
              YouTube is in your plan but the server hasn't been configured
              with Google OAuth credentials. Ask the admin to set the
              <code className="mx-1 rounded bg-muted px-1 py-0.5 font-mono text-[10px] text-foreground">
                GOOGLE_*
              </code>
              secrets.
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  const c = status.connected;

  // Connected.
  if (c) {
    return (
      <Card className="border-emerald-500/30">
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                <Youtube className="h-4 w-4 text-rose-500" />
                YouTube
              </CardTitle>
              <CardDescription className="mt-1">
                Recordings will upload to this channel.
              </CardDescription>
            </div>
            <Badge className="border-0 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300">
              <CheckCircle2 className="mr-1 h-3 w-3" />
              Connected
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/30 p-3">
            {c.providerAccountAvatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={c.providerAccountAvatarUrl}
                alt=""
                className="h-10 w-10 shrink-0 rounded-full border border-border"
              />
            ) : (
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted">
                <Youtube className="h-5 w-5 text-muted-foreground" />
              </div>
            )}
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">
                {c.providerAccountName ?? "Connected channel"}
              </div>
              {c.providerAccountId ? (
                <a
                  href={`https://www.youtube.com/channel/${c.providerAccountId}`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs text-muted-foreground hover:underline"
                >
                  Open on YouTube
                  <ArrowUpRight className="ml-0.5 inline h-3 w-3" />
                </a>
              ) : null}
              <div className="mt-0.5 text-[11px] text-muted-foreground">
                Connected{" "}
                {new Date(c.connectedAt).toLocaleDateString(undefined, {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                })}
              </div>
            </div>
          </div>

          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                variant="outline"
                className="w-full text-muted-foreground hover:text-destructive"
                disabled={disconnecting}
              >
                <Unlink className="mr-2 h-4 w-4" />
                Disconnect
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Disconnect YouTube?</AlertDialogTitle>
                <AlertDialogDescription>
                  We'll revoke our access on Google's side and delete the
                  stored tokens. New stream recordings won't upload until you
                  reconnect. Existing uploaded videos on YouTube are not
                  affected.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={handleDisconnect}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  Disconnect
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </CardContent>
      </Card>
    );
  }

  // Available + not connected.
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <Youtube className="h-4 w-4 text-rose-500" />
              YouTube
            </CardTitle>
            <CardDescription className="mt-1">
              Connect a channel to publish your recordings in one click.
            </CardDescription>
          </div>
          <Badge variant="outline" className="text-muted-foreground">
            Not connected
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        <Button
          className={cn(
            "w-full",
            "bg-rose-600 text-white hover:bg-rose-700",
            "dark:bg-rose-600 dark:hover:bg-rose-700",
          )}
          onClick={() => {
            // Server endpoint redirects to Google. A plain navigation is
            // perfect here — Google requires a top-level redirect anyway.
            window.location.href = "/api/integrations/youtube/connect";
          }}
        >
          <LinkIcon className="mr-2 h-4 w-4" />
          Connect YouTube
        </Button>
        <p className="mt-2 text-center text-[11px] text-muted-foreground">
          You'll be sent to Google to grant upload access. Cancel any time.
        </p>
      </CardContent>
    </Card>
  );
}
