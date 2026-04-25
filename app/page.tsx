"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Radio,
  Download,
  Share2,
  ArrowRight,
  PlayCircle,
  Wifi,
  ShieldCheck,
  Smartphone,
} from "lucide-react";

/**
 * Landing page — public homepage at "/".
 *
 * Design goals:
 *   - Mobile-first: every section stacks vertically on small screens with
 *     comfortable 44pt+ touch targets. The hero collapses cleanly without
 *     horizontal scroll on a 360px viewport.
 *   - Modern: subtle radial gradient + grid backdrop in the hero, glass
 *     header with backdrop-blur, hover-lift on feature cards.
 *   - Live-feel: pulsing red LIVE pill at the top of the hero (respects
 *     prefers-reduced-motion via Tailwind's motion-safe variant).
 *   - Zero new dependencies. Uses existing theme tokens (--primary,
 *     --accent, --live, --muted) from globals.css.
 *   - All routes preserved: /auth/login, /auth/signup, /watch/[roomCode].
 */
export default function HomePage() {
  const [roomCode, setRoomCode] = useState("");
  const router = useRouter();

  // Catch auth-email landings that fell back to the bare Site URL.
  // Supabase strips redirect_to silently if it doesn't match the allow list,
  // and dumps the user at "/?code=..." or "/?token_hash=...&type=...". Without
  // this guard, the user sees the marketing page with junk in the URL and no
  // way to complete password reset or signup confirmation. Forward to
  // /auth/post-auth which verifies the params and routes to the right page.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const hasAuthParams =
      params.get("code") || params.get("token_hash");
    if (hasAuthParams) {
      router.replace(`/auth/post-auth?${params.toString()}`);
    }
  }, [router]);

  const handleJoin = (e: React.FormEvent) => {
    e.preventDefault();
    const code = roomCode.trim();
    if (code) router.push(`/watch/${code}`);
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* ── Sticky glass header ──────────────────────────────────────────── */}
      <header className="sticky top-0 z-40 border-b border-border/60 bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:py-4">
          <Link href="/" className="flex items-center gap-2 min-w-0">
            <div className="grid h-9 w-9 flex-none place-items-center rounded-xl bg-primary shadow-sm shadow-primary/30">
              <Radio className="h-4.5 w-4.5 text-primary-foreground" />
            </div>
            <span className="truncate text-base font-bold tracking-tight sm:text-lg">
              Isunday Stream Live
            </span>
          </Link>
          <div className="flex items-center gap-2">
            <Button asChild variant="ghost" size="sm" className="hidden sm:inline-flex">
              <Link href="/auth/signup">Become a host</Link>
            </Button>
            <Button asChild size="sm">
              <Link href="/auth/login">Host login</Link>
            </Button>
          </div>
        </div>
      </header>

      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden">
        {/* Soft brand glow + subtle grid backdrop. Both are CSS-only so they
            scale crisply on any viewport and add no JS / image weight. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 -z-10"
          style={{
            background:
              "radial-gradient(60% 60% at 50% 0%, color-mix(in oklch, var(--primary) 18%, transparent) 0%, transparent 70%), radial-gradient(40% 40% at 100% 100%, color-mix(in oklch, var(--accent) 14%, transparent) 0%, transparent 70%)",
          }}
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 -z-10 opacity-[0.05] [mask-image:radial-gradient(60%_60%_at_50%_30%,#000,transparent)]"
          style={{
            backgroundImage:
              "linear-gradient(to right, currentColor 1px, transparent 1px), linear-gradient(to bottom, currentColor 1px, transparent 1px)",
            backgroundSize: "32px 32px",
          }}
        />

        <div className="mx-auto max-w-5xl px-4 py-14 text-center sm:py-20">
          {/* Pulsing LIVE pill */}
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-[var(--live)]/30 bg-[var(--live)]/10 px-3 py-1.5 text-[12px] font-semibold uppercase tracking-wider text-[var(--live)]">
            <span className="relative flex h-2 w-2">
              <span className="motion-safe:absolute motion-safe:inline-flex motion-safe:h-full motion-safe:w-full motion-safe:animate-ping motion-safe:rounded-full motion-safe:bg-[var(--live)] motion-safe:opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-[var(--live)]" />
            </span>
            Live streaming, made effortless
          </div>

          <h1 className="text-balance text-4xl font-extrabold leading-[1.05] tracking-tight sm:text-5xl md:text-6xl lg:text-7xl">
            Broadcast your event{" "}
            <span className="bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
              from anywhere
            </span>
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-pretty text-base text-muted-foreground sm:text-lg">
            Stream straight from your phone with one tap. Real-time chat,
            multi-host control, automatic recording, and a viewer link
            anyone can open in a browser.
          </p>

          {/* Primary actions — stacked on mobile, side-by-side from sm: */}
          <div className="mx-auto mt-8 flex max-w-md flex-col items-stretch gap-3 sm:max-w-none sm:flex-row sm:justify-center">
            <Button asChild size="lg" className="h-12 px-6 text-base">
              <Link href="/auth/signup">
                <PlayCircle className="mr-2 h-5 w-5" />
                Start your stream
              </Link>
            </Button>
            <Button
              asChild
              variant="outline"
              size="lg"
              className="h-12 px-6 text-base"
            >
              <Link href="/auth/login">
                Already a host? Log in
              </Link>
            </Button>
          </div>

          {/* Join-as-viewer card. Pinned beneath the hero CTAs so the most
              common public action — pasting a room code — is one tap away
              even on a small phone. */}
          <div className="mx-auto mt-10 max-w-md rounded-2xl border border-border bg-card p-4 text-left shadow-sm sm:mt-14">
            <div className="mb-3 flex items-center justify-between">
              <p className="text-sm font-semibold">Got a room code?</p>
              <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                Watch a stream
              </span>
            </div>
            <form
              onSubmit={handleJoin}
              className="flex items-center gap-2"
              aria-label="Join a stream by room code"
            >
              <Input
                inputMode="text"
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                placeholder="ENTER-CODE"
                value={roomCode}
                onChange={(e) => setRoomCode(e.target.value)}
                className="h-11 flex-1 font-mono text-base tracking-widest uppercase"
                aria-label="Room code"
              />
              <Button
                type="submit"
                size="lg"
                className="h-11 px-4"
                disabled={!roomCode.trim()}
              >
                Join
                <ArrowRight className="ml-1.5 h-4 w-4" />
              </Button>
            </form>
            <p className="mt-2 text-[11px] text-muted-foreground">
              No account needed to watch — just open the link the host shared.
            </p>
          </div>

          {/* Trust strip */}
          <ul className="mx-auto mt-10 grid max-w-2xl grid-cols-2 gap-3 text-left sm:grid-cols-4 sm:gap-4">
            {[
              { Icon: Smartphone, label: "Works on phones" },
              { Icon: Wifi, label: "Low-latency WebRTC" },
              { Icon: ShieldCheck, label: "Private rooms" },
              { Icon: Download, label: "Auto-recorded" },
            ].map(({ Icon, label }) => (
              <li
                key={label}
                className="flex items-center gap-2 rounded-lg border border-border/60 bg-card/60 px-3 py-2 text-xs font-medium text-muted-foreground"
              >
                <Icon className="h-4 w-4 flex-none text-primary" />
                <span className="truncate">{label}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>


      {/* ── How it works ─────────────────────────────────────────────────── */}
      <section className="px-4 py-16 sm:py-20">
        <div className="mx-auto max-w-5xl">
          <div className="mx-auto mb-10 max-w-2xl text-center sm:mb-14">
            <h2 className="text-balance text-3xl font-bold tracking-tight sm:text-4xl">
              Three steps to live
            </h2>
            <p className="mt-3 text-muted-foreground">
              From sign-up to broadcast in under a minute.
            </p>
          </div>

          {/* Vertical timeline on mobile, horizontal cards on tablet+. The
              connecting line on desktop is drawn with an absolutely-positioned
              gradient bar; on mobile we just stack. */}
          <ol className="relative grid grid-cols-1 gap-6 md:grid-cols-3 md:gap-4">
            <div
              aria-hidden
              className="pointer-events-none absolute left-6 top-6 hidden h-[2px] w-[calc(100%-3rem)] -translate-y-1/2 bg-gradient-to-r from-primary/40 via-accent/40 to-primary/0 md:block"
            />
            {[
              {
                title: "Create a stream",
                body: "Log in as a host and spin up a stream with a title and a private room code.",
              },
              {
                title: "Share the link",
                body: "Copy your viewer link or QR — anyone with it can watch from any device.",
              },
              {
                title: "Go live",
                body: "Tap Go Live and start broadcasting. Recording starts automatically.",
              },
            ].map((step, i) => (
              <li
                key={step.title}
                className="relative flex gap-4 rounded-2xl border border-border bg-card p-5 md:flex-col md:gap-3 md:p-6"
              >
                <div className="grid h-12 w-12 flex-none place-items-center rounded-full bg-primary text-base font-bold text-primary-foreground shadow-sm shadow-primary/30">
                  {i + 1}
                </div>
                <div className="min-w-0">
                  <h3 className="text-base font-semibold sm:text-lg">{step.title}</h3>
                  <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                    {step.body}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* ── Final CTA ────────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden px-4 py-16 sm:py-20">
        <div
          aria-hidden
          className="absolute inset-0 -z-10 bg-gradient-to-br from-primary via-primary to-accent"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 -z-10 opacity-25 mix-blend-overlay"
          style={{
            backgroundImage:
              "radial-gradient(50% 60% at 0% 0%, rgba(255,255,255,0.6), transparent 70%), radial-gradient(40% 50% at 100% 100%, rgba(0,0,0,0.5), transparent 70%)",
          }}
        />
        <div className="mx-auto max-w-3xl text-center">
          <h2 className="text-balance text-3xl font-extrabold tracking-tight text-primary-foreground sm:text-4xl">
            Ready when you are.
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-pretty text-primary-foreground/85">
            Create your host account and your first stream is live in minutes.
            No credit card, no studio gear — just a phone and a story.
          </p>
          <div className="mt-7 flex flex-col items-stretch justify-center gap-3 sm:flex-row sm:items-center">
            <Button asChild size="lg" variant="secondary" className="h-12 px-6 text-base">
              <Link href="/auth/signup">
                <Share2 className="mr-2 h-5 w-5" />
                Become a host
              </Link>
            </Button>
            <Button
              asChild
              size="lg"
              variant="ghost"
              className="h-12 px-6 text-base text-primary-foreground hover:bg-white/10 hover:text-primary-foreground"
            >
              <Link href="/auth/login">I already have an account</Link>
            </Button>
          </div>
        </div>
      </section>

      {/* ── Footer ───────────────────────────────────────────────────────── */}
      <footer className="border-t border-border bg-background px-4 py-8">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 text-center sm:flex-row sm:text-left">
          <div className="flex items-center gap-2">
            <div className="grid h-8 w-8 place-items-center rounded-lg bg-primary">
              <Radio className="h-4 w-4 text-primary-foreground" />
            </div>
            <span className="font-bold">Isunday Stream Live</span>
          </div>
          <p className="text-xs text-muted-foreground sm:text-sm">
            © {new Date().getFullYear()} Isunday Stream Live
          </p>
        </div>
      </footer>
    </div>
  );
}
