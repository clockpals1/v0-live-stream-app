"use client";

import {
  Youtube,
  Instagram,
  Twitter,
  CheckCircle2,
  AlertTriangle,
  Lock,
  ExternalLink,
  RefreshCw,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export interface YoutubeConnection {
  providerAccountId: string | null;
  providerAccountName: string | null;
  providerAccountAvatarUrl: string | null;
  connectedAt: string;
  tokenExpiresAt: string | null;
}

interface ConnectionsTabProps {
  youtube: YoutubeConnection | null;
  youtubeServerConfigured: boolean;
  canYoutube: boolean;
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

function ComingSoonCard({
  name,
  icon: Icon,
  description,
  iconClassName,
}: {
  name: string;
  icon: React.ComponentType<{ className?: string }>;
  description: string;
  iconClassName?: string;
}) {
  return (
    <Card className="opacity-60">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center justify-between text-sm">
          <span className="flex items-center gap-2">
            <Icon className={cn("h-4 w-4", iconClassName)} />
            {name}
          </span>
          <Badge variant="outline" className="text-[10px] text-muted-foreground">
            Coming soon
          </Badge>
        </CardTitle>
        <CardDescription className="text-xs">{description}</CardDescription>
      </CardHeader>
      <CardContent>
        <Button variant="outline" size="sm" className="w-full" disabled>
          <Lock className="mr-2 h-3.5 w-3.5" />
          Not yet available
        </Button>
      </CardContent>
    </Card>
  );
}

export function ConnectionsTab({ youtube, youtubeServerConfigured, canYoutube }: ConnectionsTabProps) {
  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        Connect your social accounts to enable publishing from the queue. OAuth tokens are
        stored securely and automatically refreshed.
      </p>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-2">
        {/* YouTube */}
        <Card className={cn(youtube ? "border-emerald-500/30" : "")}>
          <CardHeader className="pb-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <CardTitle className="flex items-center gap-2 text-sm">
                  <Youtube className="h-4 w-4 text-rose-500" />
                  YouTube
                </CardTitle>
                <CardDescription className="mt-1 text-xs">
                  Upload recordings and scheduled video content to your channel.
                </CardDescription>
              </div>
              {youtube ? (
                <Badge className="shrink-0 border-0 bg-emerald-500/15 text-[10px] text-emerald-700 dark:text-emerald-300">
                  <CheckCircle2 className="mr-1 h-3 w-3" />
                  Connected
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
              <Button
                size="sm"
                className="w-full bg-rose-600 text-white hover:bg-rose-700"
                onClick={() => { window.location.href = "/api/integrations/youtube/connect"; }}
              >
                Connect YouTube
              </Button>
            )}

            {youtube && (
              <Button
                variant="outline"
                size="sm"
                className="w-full text-xs text-muted-foreground"
                onClick={() => { window.location.href = "https://live.isunday.me/host/settings?tab=integrations"; }}
              >
                Manage in Settings
              </Button>
            )}
          </CardContent>
        </Card>

        {/* Instagram */}
        <ComingSoonCard
          name="Instagram / Reels"
          icon={Instagram}
          iconClassName="text-pink-500"
          description="Post captions, carousels, and short videos to your Instagram profile."
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-2">
        {/* TikTok */}
        <ComingSoonCard
          name="TikTok"
          icon={() => (
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
              <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-2.88 2.5 2.89 2.89 0 0 1-2.89-2.89 2.89 2.89 0 0 1 2.89-2.89c.28 0 .54.04.79.1V9.01a6.33 6.33 0 0 0-.79-.05 6.34 6.34 0 0 0-6.34 6.34 6.34 6.34 0 0 0 6.34 6.34 6.34 6.34 0 0 0 6.33-6.34V8.69a8.26 8.26 0 0 0 4.83 1.55V6.79a4.85 4.85 0 0 1-1.06-.1z"/>
            </svg>
          )}
          description="Schedule short-form video content to TikTok."
        />

        {/* Twitter/X */}
        <ComingSoonCard
          name="Twitter / X"
          icon={Twitter}
          iconClassName="text-sky-500"
          description="Thread drafts, scheduled tweets, and post-stream announcements."
        />
      </div>

      <div className="rounded-lg border border-border/60 bg-muted/20 px-4 py-3 text-xs text-muted-foreground">
        <strong className="text-foreground">Note on YouTube:</strong> The YouTube connection here is
        shared with the Studio Distribution Hub. Connecting or disconnecting in either place affects
        both surfaces. Token refresh happens automatically.
      </div>
    </div>
  );
}
