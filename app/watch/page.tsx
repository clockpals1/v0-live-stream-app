import type { ElementType, ReactNode } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { StreamCard } from "@/components/discover/stream-card";
import { ReplayCard } from "@/components/discover/replay-card";
import { JoinForm } from "@/components/discover/join-form";
import {
  Radio,
  Calendar,
  PlaySquare,
  Users,
  Tv2,
} from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * /watch — Public discovery hub.
 *
 * Server component. Queries four RLS-permitted datasets:
 *   1. Live & waiting streams
 *   2. Subscribed feeds  (streams from hosts tracked in viewers table — no auth needed)
 *   3. Upcoming scheduled events (next 7 days)
 *   4. Replay shelf (published replay_publications)
 *
 * No auth required. All queries run against public RLS policies.
 */
export const dynamic = "force-dynamic";

type HostMap = Record<string, string>; // host_id → display name

async function fetchDiscoveryData() {
  const supabase = await createClient();
  const now = new Date().toISOString();
  const in7 = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  const [liveResult, upcomingResult, replayResult] = await Promise.all([
    // Live + waiting
    supabase
      .from("streams")
      .select("id, room_code, title, status, viewer_count, started_at, host_id")
      .in("status", ["live", "waiting"])
      .order("viewer_count", { ascending: false })
      .limit(12),

    // Scheduled in the next 7 days
    supabase
      .from("streams")
      .select("id, room_code, title, status, scheduled_at, description, host_id")
      .eq("status", "scheduled")
      .gt("scheduled_at", now)
      .lt("scheduled_at", in7)
      .order("scheduled_at", { ascending: true })
      .limit(8),

    // Published replays
    supabase
      .from("replay_publications")
      .select(
        "id, slug, title, description, thumbnail_url, published_at, view_count, like_count, host_id"
      )
      .eq("is_published", true)
      .order("published_at", { ascending: false })
      .limit(12),
  ]);

  const live = liveResult.data ?? [];
  const upcoming = upcomingResult.data ?? [];
  const replays = replayResult.data ?? [];

  // Resolve host display names in one query
  const allHostIds = Array.from(
    new Set([
      ...live.map((s) => s.host_id),
      ...upcoming.map((s) => s.host_id),
      ...replays.map((r) => r.host_id),
    ].filter(Boolean) as string[])
  );

  const hosts: HostMap = {};
  if (allHostIds.length > 0) {
    const { data: hostRows } = await supabase
      .from("hosts")
      .select("id, display_name, email")
      .in("id", allHostIds);
    for (const h of hostRows ?? []) {
      hosts[h.id] = h.display_name || h.email || "Host";
    }
  }

  return { live, upcoming, replays, hosts };
}

// ─── Section wrapper ──────────────────────────────────────────────────────────

function Section({
  icon: Icon,
  title,
  count,
  children,
  emptyMessage,
}: {
  icon: ElementType;
  title: string;
  count: number;
  children: ReactNode;
  emptyMessage: string;
}) {
  return (
    <section className="space-y-4">
      <div className="flex items-center gap-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10">
          <Icon className="h-4 w-4 text-primary" />
        </div>
        <h2 className="text-base font-semibold">{title}</h2>
        {count > 0 && (
          <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
            {count}
          </span>
        )}
      </div>

      {count === 0 ? (
        <div className="flex h-24 items-center justify-center rounded-xl border border-dashed border-border text-sm text-muted-foreground">
          {emptyMessage}
        </div>
      ) : (
        children
      )}
    </section>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function WatchDiscoveryPage() {
  const { live, upcoming, replays, hosts } = await fetchDiscoveryData();

  const liveCount = live.length;
  const upcomingCount = upcoming.length;
  const replayCount = replays.length;
  const hasAnyContent = liveCount + upcomingCount + replayCount > 0;

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-30 border-b border-border/60 bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3">
          <Link href="/" className="flex items-center gap-2 min-w-0">
            <div className="grid h-8 w-8 flex-none place-items-center rounded-xl bg-primary">
              <Radio className="h-4 w-4 text-primary-foreground" />
            </div>
            <span className="truncate text-sm font-bold tracking-tight sm:text-base">
              Isunday Stream Live
            </span>
          </Link>
          <div className="flex items-center gap-2">
            <Button asChild variant="ghost" size="sm" className="hidden sm:inline-flex gap-1.5">
              <Link href="/auth/login">
                Host login
              </Link>
            </Button>
            <Button asChild size="sm">
              <Link href="/auth/signup">Go Live</Link>
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-8 space-y-12">

        {/* ── Hero: watch a stream by code ───────────────────────────────── */}
        <div className="rounded-2xl bg-gradient-to-br from-primary/10 via-background to-accent/5 border border-border p-6 sm:p-8">
          <div className="max-w-lg">
            <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-60" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-primary" />
              </span>
              Watch live, on your terms
            </div>
            <h1 className="mt-3 text-2xl font-bold tracking-tight sm:text-3xl">
              Discover streams &amp; replays
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Jump into a live stream with a room code, or browse what's on below.
            </p>
            <JoinForm />
          </div>
        </div>

        {!hasAnyContent && (
          <div className="flex flex-col items-center justify-center py-20 text-center gap-4">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted">
              <Tv2 className="h-7 w-7 text-muted-foreground" />
            </div>
            <div>
              <p className="font-semibold">Nothing live right now</p>
              <p className="text-sm text-muted-foreground mt-1">
                Check back later or{" "}
                <Link href="/auth/signup" className="text-primary hover:underline">
                  start your own stream
                </Link>
                .
              </p>
            </div>
          </div>
        )}

        {/* ── Live Now ───────────────────────────────────────────────────── */}
        <Section
          icon={Radio}
          title="Live Now"
          count={liveCount}
          emptyMessage="No streams live right now — check back soon."
        >
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {live.map((s) => (
              <StreamCard
                key={s.id}
                stream={{
                  ...s,
                  status: s.status as "live" | "waiting",
                  hostName: s.host_id ? hosts[s.host_id] : undefined,
                }}
              />
            ))}
          </div>
        </Section>

        {/* ── Upcoming Events ────────────────────────────────────────────── */}
        <Section
          icon={Calendar}
          title="Upcoming Events"
          count={upcomingCount}
          emptyMessage="No scheduled streams in the next 7 days."
        >
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {upcoming.map((s) => (
              <StreamCard
                key={s.id}
                variant="compact"
                stream={{
                  ...s,
                  status: "scheduled",
                  hostName: s.host_id ? hosts[s.host_id] : undefined,
                }}
              />
            ))}
          </div>
        </Section>

        {/* ── Replay Shelf ───────────────────────────────────────────────── */}
        <Section
          icon={PlaySquare}
          title="Replay Shelf"
          count={replayCount}
          emptyMessage="No replays published yet."
        >
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {replays.map((r) => (
              <ReplayCard
                key={r.id}
                replay={{
                  ...r,
                  description: r.description ?? null,
                  thumbnail_url: r.thumbnail_url ?? null,
                  published_at: r.published_at ?? null,
                  hostName: hosts[r.host_id] ?? undefined,
                }}
              />
            ))}
          </div>
        </Section>

        {/* ── CTA footer ─────────────────────────────────────────────────── */}
        <div className="flex flex-col items-center gap-3 border-t border-border pt-10 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
            <Users className="h-5 w-5 text-primary" />
          </div>
          <p className="font-semibold">Want to stream?</p>
          <p className="text-sm text-muted-foreground max-w-xs">
            Create a free host account and go live from your phone in under a minute.
          </p>
          <Button asChild className="mt-1">
            <Link href="/auth/signup">Become a host</Link>
          </Button>
        </div>
      </main>
    </div>
  );
}
