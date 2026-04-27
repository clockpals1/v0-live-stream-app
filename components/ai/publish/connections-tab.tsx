"use client";

import { useState } from "react";
import {
  Youtube,
  Instagram,
  Twitter,
  CheckCircle2,
  AlertTriangle,
  Lock,
  ExternalLink,
  RefreshCw,
  LogOut,
  Loader2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
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
import { cn } from "@/lib/utils";

export interface PlatformConnection {
  providerAccountId: string | null;
  providerAccountName: string | null;
  providerAccountAvatarUrl: string | null;
  connectedAt: string;
  tokenExpiresAt: string | null;
}

export type YoutubeConnection = PlatformConnection;

export interface ConnectionsTabProps {
  youtube: PlatformConnection | null;
  youtubeServerConfigured: boolean;
  canYoutube: boolean;
  instagram: PlatformConnection | null;
  instagramConfigured: boolean;
  tiktok: PlatformConnection | null;
  tiktokConfigured: boolean;
  twitter: PlatformConnection | null;
  twitterConfigured: boolean;
}

function tokenHealth(expiresAt: string | null): "ok" | "expiring" | "expired" {
  if (!expiresAt) return "expired";
  const diff = new Date(expiresAt).getTime() - Date.now();
  if (diff < 0) return "expired";
  if (diff < 24 * 60 * 60 * 1000) return "expiring";
  return "ok";
}

function ConnectedAccount({ connection }: { connection: YoutubeConnection }) {
  const health = tokenHealth(connection.tokenExpiresAt);
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/30 px-3 py-2.5">
      {connection.providerAccountAvatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={connection.providerAccountAvatarUrl}
          alt=""
          className="h-8 w-8 shrink-0 rounded-full border border-border"
        />
      ) : (
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted">
          <Youtube className="h-4 w-4 text-muted-foreground" />
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-sm font-medium">
            {connection.providerAccountName ?? "Connected channel"}
          </span>
          {health === "ok" && (
            <Badge className="h-4 border-0 bg-emerald-500/15 px-1.5 text-[10px] text-emerald-700 dark:text-emerald-300">
              Active
            </Badge>
          )}
          {health === "expiring" && (
            <Badge className="h-4 border-0 bg-amber-500/15 px-1.5 text-[10px] text-amber-700 dark:text-amber-300">
              Expiring soon
            </Badge>
          )}
          {health === "expired" && (
            <Badge className="h-4 border-0 bg-destructive/15 px-1.5 text-[10px] text-destructive">
              Token expired
            </Badge>
          )}
        </div>
        {connection.providerAccountId && (
          <a
            href={`https://www.youtube.com/channel/${connection.providerAccountId}`}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-0.5 text-[10px] text-muted-foreground hover:underline"
          >
            Open channel <ExternalLink className="h-2.5 w-2.5" />
          </a>
        )}
      </div>
      {(health === "expiring" || health === "expired") && (
        <Button
          size="sm"
          variant="outline"
          className="h-7 gap-1 text-xs"
          onClick={() => { window.location.href = "/api/integrations/youtube/connect"; }}
        >
          <RefreshCw className="h-3 w-3" />
          Reconnect
        </Button>
      )}
    </div>
  );
}

// ── Generic Platform Card ─────────────────────────────────────────────

function TikTokIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-2.88 2.5 2.89 2.89 0 0 1-2.89-2.89 2.89 2.89 0 0 1 2.89-2.89c.28 0 .54.04.79.1V9.01a6.33 6.33 0 0 0-.79-.05 6.34 6.34 0 0 0-6.34 6.34 6.34 6.34 0 0 0 6.34 6.34 6.34 6.34 0 0 0 6.33-6.34V8.69a8.26 8.26 0 0 0 4.83 1.55V6.79a4.85 4.85 0 0 1-1.06-.1z" />
    </svg>
  );
}

interface PlatformCardProps {
  name: string;
  provider: string;
  icon: React.ComponentType<{ className?: string }>;
  iconClassName?: string;
  description: string;
  connectUrl: string;
  disconnectUrl: string;
  serverConfigured: boolean;
  connection: PlatformConnection | null;
  connectButtonClassName?: string;
}

function PlatformCard({
  name, provider, icon: Icon, iconClassName, description,
  connectUrl, disconnectUrl, serverConfigured, connection, connectButtonClassName,
}: PlatformCardProps) {
  const [disconnecting, setDisconnecting] = useState(false);
  const [connected, setConnected] = useState(!!connection);
  const [account, setAccount] = useState(connection);

  const health = account ? tokenHealth(account.tokenExpiresAt) : "ok";

  const handleDisconnect = async () => {
    setDisconnecting(true);
    try {
      const res = await fetch(disconnectUrl, { method: "DELETE" });
      if (res.ok) {
        setConnected(false);
        setAccount(null);
        toast.success(`${name} disconnected.`);
      } else {
        const json = await res.json().catch(() => ({})) as { error?: string };
        toast.error(json.error ?? `Failed to disconnect ${name}`);
      }
    } catch {
      toast.error("Network error");
    } finally {
      setDisconnecting(false);
    }
  };

  return (
    <Card className={cn(connected ? "border-emerald-500/30" : "")}>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-sm">
              <Icon className={cn("h-4 w-4", iconClassName)} />
              {name}
            </CardTitle>
            <CardDescription className="mt-1 text-xs">{description}</CardDescription>
          </div>
          {connected ? (
            <Badge className="shrink-0 border-0 bg-emerald-500/15 text-[10px] text-emerald-700 dark:text-emerald-300">
              <CheckCircle2 className="mr-1 h-3 w-3" />Connected
            </Badge>
          ) : serverConfigured ? (
            <Badge variant="outline" className="shrink-0 text-[10px] text-muted-foreground">
              Not connected
            </Badge>
          ) : (
            <Badge variant="outline" className="shrink-0 text-[10px] text-muted-foreground">
              Coming soon
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Connected account info */}
        {connected && account && (
          <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/30 px-3 py-2.5">
            {account.providerAccountAvatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={account.providerAccountAvatarUrl} alt=""
                className="h-8 w-8 shrink-0 rounded-full border border-border" />
            ) : (
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted">
                <Icon className={cn("h-4 w-4", iconClassName)} />
              </div>
            )}
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span className="truncate text-sm font-medium">
                  {account.providerAccountName ?? "Connected account"}
                </span>
                {health !== "ok" && (
                  <Badge className={cn("h-4 border-0 px-1.5 text-[10px]",
                    health === "expiring"
                      ? "bg-amber-500/15 text-amber-700 dark:text-amber-300"
                      : "bg-destructive/15 text-destructive")}>
                    {health === "expiring" ? "Expiring" : "Expired"}
                  </Badge>
                )}
              </div>
              {account.providerAccountId && provider === "youtube" && (
                <a href={`https://www.youtube.com/channel/${account.providerAccountId}`}
                  target="_blank" rel="noreferrer"
                  className="flex items-center gap-0.5 text-[10px] text-muted-foreground hover:underline">
                  Open channel <ExternalLink className="h-2.5 w-2.5" />
                </a>
              )}
            </div>
            {health !== "ok" && (
              <Button size="sm" variant="outline" className="h-7 gap-1 text-xs shrink-0"
                onClick={() => { window.location.href = connectUrl; }}>
                <RefreshCw className="h-3 w-3" />Reconnect
              </Button>
            )}
          </div>
        )}

        {/* Not connected + server configured → real connect button */}
        {!connected && serverConfigured && (
          <Button size="sm" className={cn("w-full", connectButtonClassName)}
            onClick={() => { window.location.href = connectUrl; }}>
            Connect {name}
          </Button>
        )}

        {/* Not configured → show what secrets are needed */}
        {!connected && !serverConfigured && (
          <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
            <Lock className="mt-0.5 h-3 w-3 shrink-0" />
            <span>Requires server credentials. See the{" "}
              <a href="/docs/PUBLISHING_HUB_OAUTH_SETUP.md" target="_blank"
                className="underline hover:text-foreground">setup guide</a>{" "}
              to configure <code className="font-mono">{provider.toUpperCase()}_*</code> secrets.
            </span>
          </div>
        )}

        {/* Disconnect button */}
        {connected && (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="ghost" size="sm" className="w-full text-xs text-muted-foreground hover:text-destructive"
                disabled={disconnecting}>
                {disconnecting
                  ? <><Loader2 className="mr-1.5 h-3 w-3 animate-spin" />Disconnecting…</>
                  : <><LogOut className="mr-1.5 h-3 w-3" />Disconnect {name}</>}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Disconnect {name}?</AlertDialogTitle>
                <AlertDialogDescription>
                  Your {name} account will be unlinked and all stored tokens removed.
                  Scheduled posts to {name} will fail until you reconnect.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={handleDisconnect}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                  Disconnect
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </CardContent>
    </Card>
  );
}

export function ConnectionsTab({
  youtube, youtubeServerConfigured, canYoutube,
  instagram, instagramConfigured,
  tiktok, tiktokConfigured,
  twitter, twitterConfigured,
}: ConnectionsTabProps) {
  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        Connect your social accounts to enable publishing from the queue. OAuth tokens are
        stored securely and automatically refreshed.
      </p>

      <div className="grid gap-4 sm:grid-cols-2">
        {/* YouTube — special case: plan gating + Settings link */}
        <Card className={cn(youtube ? "border-emerald-500/30" : "")}>
          <CardHeader className="pb-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <CardTitle className="flex items-center gap-2 text-sm">
                  <Youtube className="h-4 w-4 text-rose-500" />
                  YouTube
                </CardTitle>
                <CardDescription className="mt-1 text-xs">
                  Upload recordings and schedule video content to your channel.
                </CardDescription>
              </div>
              {youtube ? (
                <Badge className="shrink-0 border-0 bg-emerald-500/15 text-[10px] text-emerald-700 dark:text-emerald-300">
                  <CheckCircle2 className="mr-1 h-3 w-3" />Connected
                </Badge>
              ) : (
                <Badge variant="outline" className="shrink-0 text-[10px] text-muted-foreground">
                  Not connected
                </Badge>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {youtube && <ConnectedAccount connection={youtube} />}
            {!youtube && !canYoutube && (
              <div className="rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-xs">
                YouTube publishing is a paid feature. Upgrade your plan to connect.
              </div>
            )}
            {!youtube && canYoutube && !youtubeServerConfigured && (
              <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
                <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                Server not configured. Ask admin to set GOOGLE_* secrets.
              </div>
            )}
            {!youtube && canYoutube && youtubeServerConfigured && (
              <Button size="sm" className="w-full bg-rose-600 text-white hover:bg-rose-700"
                onClick={() => { window.location.href = "/api/integrations/youtube/connect"; }}>
                Connect YouTube
              </Button>
            )}
            {youtube && (
              <Button variant="ghost" size="sm" className="w-full text-xs text-muted-foreground"
                onClick={() => { window.location.href = "https://live.isunday.me/host/settings?tab=integrations"; }}>
                Manage in Settings ↗
              </Button>
            )}
          </CardContent>
        </Card>

        <PlatformCard
          name="Instagram / Reels" provider="instagram"
          icon={Instagram} iconClassName="text-pink-500"
          description="Post captions, carousels, and Reels to your Instagram Business account."
          connectUrl="/api/integrations/instagram/connect"
          disconnectUrl="/api/integrations/instagram"
          serverConfigured={instagramConfigured}
          connection={instagram}
          connectButtonClassName="bg-gradient-to-r from-pink-500 to-violet-500 text-white hover:from-pink-600 hover:to-violet-600"
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <PlatformCard
          name="TikTok" provider="tiktok"
          icon={TikTokIcon}
          description="Schedule short-form video content to TikTok."
          connectUrl="/api/integrations/tiktok/connect"
          disconnectUrl="/api/integrations/tiktok"
          serverConfigured={tiktokConfigured}
          connection={tiktok}
        />

        <PlatformCard
          name="Twitter / X" provider="twitter"
          icon={Twitter} iconClassName="text-sky-500"
          description="Thread drafts, scheduled tweets, and post-stream announcements."
          connectUrl="/api/integrations/twitter/connect"
          disconnectUrl="/api/integrations/twitter"
          serverConfigured={twitterConfigured}
          connection={twitter}
          connectButtonClassName="bg-sky-500 text-white hover:bg-sky-600"
        />
      </div>

      <div className="rounded-lg border border-border/60 bg-muted/20 px-4 py-3 text-xs text-muted-foreground">
        <strong className="text-foreground">Note on YouTube:</strong> The YouTube connection is
        shared with the Studio Distribution Hub — connecting or disconnecting in either place
        affects both surfaces. All tokens are refreshed automatically before expiry.
      </div>
    </div>
  );
}
