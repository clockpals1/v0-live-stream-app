"use client";

import Link from "next/link";
import { useState } from "react";
import type { User } from "@supabase/supabase-js";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { SubscriptionCard } from "@/components/billing/subscription-card";
import { YoutubeConnectCard } from "@/components/host/youtube-connect-card";
import {
  ArrowLeft,
  CreditCard,
  Plug,
  User as UserIcon,
  Bell,
  Mail,
  Save,
  Radio,
  Youtube,
  Cloud,
} from "lucide-react";

/**
 * Host settings content — tabbed page that gathers everything that
 * isn't a stream into one focused screen.
 *
 * Tabs:
 *   - subscription: SubscriptionCard (plan + Stripe portal/upgrade)
 *   - integrations: YoutubeConnectCard + (later) other providers
 *   - profile:      display name + email (read-only for now)
 *   - notifications:placeholder, surfaced as "coming soon"
 *
 * The component is intentionally thin — it composes already-built
 * cards from /components/billing/* and /components/host/* so each
 * concern keeps its own state machine. The Profile tab is the only
 * one with local state here because there's no dedicated component
 * for it yet; it's a small inline form.
 */

interface Host {
  id: string;
  email: string | null;
  display_name: string | null;
  is_admin?: boolean | null;
  role?: string | null;
  plan_slug?: string | null;
}

interface Props {
  user: User;
  host: Host;
}

export function SettingsContent({ user, host }: Props) {
  const [tab, setTab] = useState<"subscription" | "integrations" | "profile" | "notifications">(
    "subscription",
  );

  return (
    <div className="min-h-screen bg-background">
      {/* ─── Header ─────────────────────────────────────────────── */}
      <header className="border-b border-border">
        <div className="container mx-auto flex items-center justify-between px-4 py-4">
          <Link href="/host/dashboard" className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary">
              <Radio className="h-4 w-4 text-primary-foreground" />
            </div>
            <span className="font-bold text-foreground">Isunday Stream Live</span>
          </Link>
          <Button variant="ghost" size="sm" asChild>
            <Link href="/host/dashboard">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to dashboard
            </Link>
          </Button>
        </div>
      </header>

      <main className="container mx-auto max-w-5xl px-4 py-8">
        {/* ─── Page heading ───────────────────────────────────── */}
        <div className="mb-6">
          <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Manage your subscription, integrations, and profile.
          </p>
        </div>

        <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
          {/* On mobile we let the list scroll horizontally; on desktop
              we constrain its width so it doesn't stretch awkwardly. */}
          <TabsList className="mb-6 h-auto w-full justify-start gap-1 overflow-x-auto bg-muted/50 p-1 sm:w-auto">
            <TabsTrigger value="subscription" className="gap-1.5">
              <CreditCard className="h-3.5 w-3.5" />
              Subscription
            </TabsTrigger>
            <TabsTrigger value="integrations" className="gap-1.5">
              <Plug className="h-3.5 w-3.5" />
              Integrations
            </TabsTrigger>
            <TabsTrigger value="profile" className="gap-1.5">
              <UserIcon className="h-3.5 w-3.5" />
              Profile
            </TabsTrigger>
            <TabsTrigger value="notifications" className="gap-1.5">
              <Bell className="h-3.5 w-3.5" />
              Notifications
            </TabsTrigger>
          </TabsList>

          {/* ─── Subscription ──────────────────────────────────── */}
          <TabsContent value="subscription" className="space-y-4">
            <SubscriptionCard />
            <p className="text-center text-xs text-muted-foreground">
              Billing is handled by Stripe. Invoices and receipts arrive at{" "}
              <span className="font-medium text-foreground">{host.email}</span>.
            </p>
          </TabsContent>

          {/* ─── Integrations ──────────────────────────────────── */}
          <TabsContent value="integrations" className="space-y-4">
            <div className="grid gap-4 lg:grid-cols-2">
              <YoutubeConnectCard />

              {/* Cloud archive info card — informational; the actual upload
                  flow lives on the post-stream dialog. */}
              <Card>
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <CardTitle className="flex items-center gap-2 text-base">
                        <Cloud className="h-4 w-4 text-sky-500" />
                        Cloud archive
                      </CardTitle>
                      <CardDescription className="mt-1">
                        Permanent recording storage in our private bucket.
                      </CardDescription>
                    </div>
                    <Badge variant="outline" className="text-muted-foreground">
                      Per-stream
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground">
                    Saving to the cloud is offered as a choice on the
                    post-stream dialog after each broadcast. You can still
                    download a local copy any time.
                  </p>
                </CardContent>
              </Card>
            </div>

            {/* "More integrations" hint — sets the expectation that this
                page grows. Twitch, Vimeo, Mux, etc. are obvious next
                candidates. */}
            <Card className="border-dashed">
              <CardContent className="flex items-center gap-3 py-4">
                <div className="flex h-9 w-9 items-center justify-center rounded-md bg-muted">
                  <Plug className="h-4 w-4 text-muted-foreground" />
                </div>
                <div className="flex-1 text-sm">
                  <div className="font-medium">More integrations coming</div>
                  <p className="text-xs text-muted-foreground">
                    Twitch, Vimeo, and webhook destinations are on the roadmap.
                  </p>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ─── Profile ──────────────────────────────────────── */}
          <TabsContent value="profile">
            <ProfileForm host={host} userEmail={user.email ?? null} />
          </TabsContent>

          {/* ─── Notifications ────────────────────────────────── */}
          <TabsContent value="notifications">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Bell className="h-4 w-4" />
                  Notifications
                </CardTitle>
                <CardDescription>
                  Choose what you'd like to be emailed about.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="rounded-lg border border-dashed border-border bg-muted/30 p-6 text-center">
                  <Bell className="mx-auto h-6 w-6 text-muted-foreground" />
                  <p className="mt-2 text-sm font-medium">Coming soon</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Granular email preferences (new follower, payment receipt,
                    upload finished, …) will land here.
                  </p>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// Profile form
// ────────────────────────────────────────────────────────────────────

function ProfileForm({
  host,
  userEmail,
}: {
  host: Host;
  userEmail: string | null;
}) {
  const [displayName, setDisplayName] = useState(host.display_name ?? "");
  const [saving, setSaving] = useState(false);
  const initialName = host.display_name ?? "";
  const dirty = displayName.trim() !== initialName.trim();

  async function save() {
    if (!dirty) return;
    setSaving(true);
    try {
      const res = await fetch("/api/host/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayName: displayName.trim() }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Save failed.");
      toast.success("Profile updated.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <UserIcon className="h-4 w-4" />
          Profile
        </CardTitle>
        <CardDescription>
          How you appear to viewers across your streams.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="space-y-2">
          <Label htmlFor="display-name">Display name</Label>
          <Input
            id="display-name"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            maxLength={80}
            placeholder="Your public name"
          />
          <p className="text-xs text-muted-foreground">
            Shown in chat, on stream pages, and in Insider Circle emails.
          </p>
        </div>

        <div className="space-y-2">
          <Label className="flex items-center gap-1.5 text-muted-foreground">
            <Mail className="h-3.5 w-3.5" />
            Email
          </Label>
          <Input value={userEmail ?? ""} readOnly disabled />
          <p className="text-xs text-muted-foreground">
            Tied to your account. Contact support to change it.
          </p>
        </div>

        <div className="flex items-center justify-end gap-2 pt-2">
          <Button
            variant="ghost"
            onClick={() => setDisplayName(initialName)}
            disabled={!dirty || saving}
          >
            Discard
          </Button>
          <Button onClick={save} disabled={!dirty || saving}>
            <Save className="mr-2 h-4 w-4" />
            {saving ? "Saving…" : "Save changes"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// Tiny convenience export so callers can hint at the YouTube tab
// without needing to know URL fragments.
export const SETTINGS_TABS = {
  subscription: "subscription",
  integrations: "integrations",
  profile: "profile",
  notifications: "notifications",
} as const;

// Re-export YouTube icon from this module for the dashboard nav so
// downstream files don't need to import from lucide-react directly.
export { Youtube };
