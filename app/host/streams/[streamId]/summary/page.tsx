import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
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
  ArrowLeft,
  Cloud,
  Youtube,
  CheckCircle2,
  AlertTriangle,
  Clock,
  Users,
  Radio,
  ExternalLink,
  Copy,
} from "lucide-react";
import { CopyButton } from "@/components/host/summary-copy-button";
import { DeleteArchiveButton } from "@/components/host/delete-archive-button";

/**
 * /host/streams/[streamId]/summary
 *
 * Permanent post-stream recap. Anything the post-stream dialog showed
 * the host once at end-of-stream is queryable here later — useful when
 * the host closes the dialog by accident, or wants to link a
 * collaborator to the cloud archive / YouTube video.
 *
 * Server component because every section can be rendered from a
 * single round-trip:
 *   - streams row (title, dates, viewer counts, recording_url, youtube_video_id)
 *   - stream_archives rows (cloud copies + status)
 *
 * Access is enforced by ownership: the calling host must own the
 * stream OR be an admin. We use the admin client to read both tables
 * because RLS on stream_archives only exposes own-host rows by default
 * — same effective rule, just simpler than re-stating policies here.
 */
export default async function StreamSummaryPage({
  params,
}: {
  params: Promise<{ streamId: string }>;
}) {
  const { streamId } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  let admin;
  try {
    admin = createAdminClient();
  } catch {
    // Without service role we cannot reliably enforce ownership across
    // tables; bounce to dashboard rather than render an inconsistent page.
    redirect("/host/dashboard");
  }

  const { data: host } = await admin
    .from("hosts")
    .select("id, role, is_admin")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!host) redirect("/host/dashboard");

  const { data: stream } = await admin
    .from("streams")
    .select(
      "id, title, host_id, status, room_code, created_at, started_at, ended_at, recording_url, youtube_video_id",
    )
    .eq("id", streamId)
    .maybeSingle();

  if (!stream) notFound();
  const isAdmin = host.role === "admin" || host.is_admin === true;
  if (!isAdmin && stream.host_id !== host.id) {
    redirect("/host/dashboard");
  }

  // Soft-deleted archives are filtered out at query time so the host
  // never sees a tombstone row. Admins also don't see them by default;
  // a separate /admin/archives view can be added later if support needs
  // to inspect deleted history.
  const { data: archives } = await admin
    .from("stream_archives")
    .select(
      "id, provider, status, content_type, byte_size, public_url, created_at, completed_at, failure_reason, delete_after_at",
    )
    .eq("stream_id", streamId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false });

  // Best-effort viewer count — the schema differs across deployments
  // (some have viewers, some have a peak_viewer_count column). Wrap in
  // try and fall through if the table or column is missing.
  let peakViewers: number | null = null;
  try {
    const { count } = await admin
      .from("viewers")
      .select("*", { count: "exact", head: true })
      .eq("stream_id", streamId);
    peakViewers = typeof count === "number" ? count : null;
  } catch {
    /* viewer counting is decorative; skip on schema drift */
  }

  const startedAt = stream.started_at ? new Date(stream.started_at) : null;
  const endedAt = stream.ended_at ? new Date(stream.ended_at) : null;
  const durationMs =
    startedAt && endedAt ? endedAt.getTime() - startedAt.getTime() : null;
  const durationLabel = durationMs ? formatDuration(durationMs) : "—";

  const youtubeUrl = stream.youtube_video_id
    ? `https://www.youtube.com/watch?v=${stream.youtube_video_id}`
    : null;

  return (
    <div className="min-h-screen bg-background">
      {/* ─── Header ────────────────────────────────────────────── */}
      <header className="border-b border-border">
        <div className="container mx-auto flex items-center justify-between px-4 py-4">
          <Link href="/host/dashboard" className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary">
              <Radio className="h-4 w-4 text-primary-foreground" />
            </div>
            <span className="font-bold">Isunday Stream Live</span>
          </Link>
          <Button variant="ghost" size="sm" asChild>
            <Link href="/host/dashboard">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to dashboard
            </Link>
          </Button>
        </div>
      </header>

      <main className="container mx-auto max-w-4xl px-4 py-8">
        {/* ─── Title & status ─────────────────────────────────── */}
        <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground">
              Stream summary
            </div>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight">
              {stream.title || "Untitled stream"}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Room <span className="font-mono">{stream.room_code}</span>{" "}
              <span className="mx-1">·</span>
              {endedAt
                ? `Ended ${endedAt.toLocaleString()}`
                : startedAt
                  ? `Started ${startedAt.toLocaleString()}`
                  : `Created ${new Date(stream.created_at).toLocaleString()}`}
            </p>
          </div>
          <StatusBadge status={stream.status} />
        </div>

        {/* ─── Stat row ───────────────────────────────────────── */}
        <div className="mb-6 grid gap-3 sm:grid-cols-3">
          <Stat
            icon={<Clock className="h-4 w-4 text-muted-foreground" />}
            label="Duration"
            value={durationLabel}
          />
          <Stat
            icon={<Users className="h-4 w-4 text-muted-foreground" />}
            label="Unique viewers"
            value={peakViewers != null ? peakViewers.toLocaleString() : "—"}
          />
          <Stat
            icon={<Cloud className="h-4 w-4 text-muted-foreground" />}
            label="Cloud copies"
            value={
              archives ? archives.filter((a) => a.status === "ready").length : 0
            }
          />
        </div>

        {/* ─── Cloud archive ──────────────────────────────────── */}
        <Card className="mb-4">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Cloud className="h-4 w-4 text-sky-500" />
              Cloud archive
            </CardTitle>
            <CardDescription>
              Permanent copies stored in our private bucket.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {!archives || archives.length === 0 ? (
              <EmptyState
                title="No cloud archive yet"
                description="You can save a permanent copy from the post-stream dialog the next time you finish a stream."
              />
            ) : (
              <ul className="divide-y divide-border rounded-lg border border-border">
                {archives.map((a) => (
                  <li
                    key={a.id}
                    className="flex flex-wrap items-center gap-3 px-4 py-3"
                  >
                    <ArchiveStatusPill status={a.status} />
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        {a.provider}
                        {" · "}
                        {a.byte_size != null
                          ? `${(a.byte_size / (1024 * 1024)).toFixed(1)} MB`
                          : "size n/a"}
                        {" · "}
                        {a.content_type}
                      </div>
                      {a.public_url ? (
                        <div className="mt-1 flex items-center gap-1.5">
                          <code className="min-w-0 truncate rounded bg-muted px-1.5 py-0.5 font-mono text-[10px]">
                            {a.public_url}
                          </code>
                          <CopyButton text={a.public_url} />
                          <Button
                            variant="ghost"
                            size="sm"
                            asChild
                            className="h-6 px-1.5"
                          >
                            <a
                              href={a.public_url}
                              target="_blank"
                              rel="noreferrer"
                            >
                              <ExternalLink className="h-3 w-3" />
                            </a>
                          </Button>
                        </div>
                      ) : a.status === "failed" ? (
                        <div className="mt-1 text-xs text-destructive">
                          {a.failure_reason ?? "Upload failed."}
                        </div>
                      ) : (
                        <div className="mt-1 text-xs text-muted-foreground">
                          {a.status === "ready"
                            ? "Stored privately — no public URL."
                            : "In progress…"}
                        </div>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <div className="text-right text-[11px] text-muted-foreground">
                        {a.completed_at
                          ? new Date(a.completed_at).toLocaleDateString()
                          : new Date(a.created_at).toLocaleDateString()}
                        {a.delete_after_at && a.status === "ready" && (
                          <div
                            className="text-[10px] text-amber-600 dark:text-amber-400"
                            title={`Auto-deleted on ${new Date(a.delete_after_at).toLocaleString()}`}
                          >
                            Expires {new Date(a.delete_after_at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
                          </div>
                        )}
                      </div>
                      {a.status === "ready" || a.status === "failed" ? (
                        <DeleteArchiveButton
                          streamId={streamId}
                          archiveId={a.id}
                        />
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* ─── YouTube ────────────────────────────────────────── */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Youtube className="h-4 w-4 text-rose-500" />
              YouTube
            </CardTitle>
            <CardDescription>
              Linked YouTube video for this broadcast.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {youtubeUrl ? (
              <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-muted/30 px-4 py-3">
                <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Watch URL (private by default)
                  </div>
                  <div className="mt-1 flex items-center gap-1.5">
                    <code className="min-w-0 truncate rounded bg-background px-1.5 py-0.5 font-mono text-[11px]">
                      {youtubeUrl}
                    </code>
                    <CopyButton text={youtubeUrl} />
                  </div>
                </div>
                <Button asChild size="sm">
                  <a href={youtubeUrl} target="_blank" rel="noreferrer">
                    Open
                    <ExternalLink className="ml-1.5 h-3 w-3" />
                  </a>
                </Button>
              </div>
            ) : (
              <EmptyState
                title="Not on YouTube yet"
                description="Connect a channel under Settings → Integrations, then upload from the post-stream dialog after your next stream."
                action={
                  <Button variant="outline" size="sm" asChild>
                    <Link href="/host/settings">Open settings</Link>
                  </Button>
                }
              />
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// Sub-components
// ────────────────────────────────────────────────────────────────────

function Stat({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-border bg-muted/30 px-4 py-3">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {icon}
        {label}
      </div>
      <div className="mt-1 text-xl font-semibold tracking-tight">{value}</div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; className: string }> = {
    live: {
      label: "Live",
      className: "bg-rose-500/15 text-rose-600 dark:text-rose-300",
    },
    ended: {
      label: "Ended",
      className: "bg-muted text-muted-foreground",
    },
    waiting: {
      label: "Waiting",
      className: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
    },
    scheduled: {
      label: "Scheduled",
      className: "bg-sky-500/15 text-sky-600 dark:text-sky-300",
    },
  };
  const m = map[status] ?? { label: status, className: "bg-muted" };
  return <Badge className={`border-0 ${m.className}`}>{m.label}</Badge>;
}

function ArchiveStatusPill({ status }: { status: string }) {
  if (status === "ready") {
    return (
      <Badge className="border-0 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300">
        <CheckCircle2 className="mr-1 h-3 w-3" />
        Ready
      </Badge>
    );
  }
  if (status === "failed") {
    return (
      <Badge className="border-0 bg-rose-500/15 text-rose-700 dark:text-rose-300">
        <AlertTriangle className="mr-1 h-3 w-3" />
        Failed
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="text-muted-foreground">
      <Clock className="mr-1 h-3 w-3" />
      {status}
    </Badge>
  );
}

function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border bg-muted/30 px-6 py-8 text-center">
      <div className="text-sm font-medium">{title}</div>
      <p className="max-w-md text-xs text-muted-foreground">{description}</p>
      {action}
    </div>
  );
}

function formatDuration(ms: number) {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}
