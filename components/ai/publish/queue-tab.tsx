"use client";

import { useState, useEffect, useTransition } from "react";
import {
  Youtube, Plus, Trash2, Send, Clock, CheckCircle2, XCircle,
  Loader2, AlertCircle, ExternalLink, Calendar, RefreshCw,
  CalendarClock, X, Info, Radio,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader,
  AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { pushArchiveToYoutube } from "@/lib/distribution/youtube-push";
import type { QueueItem } from "./hub-view";

// ── Countdown hook ──────────────────────────────────────────────────────
function useCountdown(iso: string | null) {
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    if (!iso) return;
    const tick = () => {
      const d = new Date(iso).getTime() - Date.now();
      if (d <= 0) { setText("now"); return; }
      const h = Math.floor(d / 3600000), m = Math.floor((d % 3600000) / 60000), s = Math.floor((d % 60000) / 1000);
      setText(h > 0 ? `${h}h ${m}m` : m > 0 ? `${m}m ${s}s` : `${s}s`);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [iso]);
  return text;
}

// ── Helpers ─────────────────────────────────────────────────────────────
const STATUS_META: Record<string, { label: string; color: string; icon: React.ComponentType<{ className?: string }> }> = {
  draft:      { label: "Draft",      color: "text-muted-foreground border-border",                        icon: Clock },
  approved:   { label: "Approved",   color: "text-blue-600 border-blue-500/40 bg-blue-500/5",             icon: CheckCircle2 },
  scheduled:  { label: "Scheduled",  color: "text-violet-600 border-violet-500/40 bg-violet-500/5",       icon: Calendar },
  publishing: { label: "Publishing", color: "text-amber-600 border-amber-500/40 bg-amber-500/5",          icon: Loader2 },
  published:  { label: "Published",  color: "text-emerald-600 border-emerald-500/40 bg-emerald-500/5",    icon: CheckCircle2 },
  failed:     { label: "Failed",     color: "text-destructive border-destructive/40 bg-destructive/10",   icon: XCircle },
};

function StatusBadge({ status }: { status: string }) {
  const m = STATUS_META[status] ?? STATUS_META.draft;
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium", m.color)}>
      <m.icon className={cn("h-3 w-3", status === "publishing" && "animate-spin")} />
      {m.label}
    </span>
  );
}

const STEPS = ["draft", "scheduled", "publishing", "published"] as const;
function PipelineTrack({ status }: { status: string }) {
  const cur = STEPS.indexOf(status as typeof STEPS[number]);
  const failed = status === "failed";
  return (
    <div className="flex items-center my-2">
      {STEPS.map((s, i) => {
        const done = !failed && cur > i;
        const active = !failed && cur === i;
        return (
          <div key={s} className="flex items-center flex-1 min-w-0">
            <div className="flex flex-col items-center gap-0.5 shrink-0">
              <div className={cn("flex h-5 w-5 items-center justify-center rounded-full border text-[9px] font-bold",
                failed && i >= cur ? "border-destructive/40 bg-destructive/10 text-destructive" :
                done ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-600" :
                active ? "border-primary/60 bg-primary/10 text-primary" :
                "border-border/40 bg-muted/30 text-muted-foreground/40")}>
                {failed && i === cur ? <XCircle className="h-2.5 w-2.5" /> :
                  done ? <CheckCircle2 className="h-2.5 w-2.5" /> :
                  active ? <Radio className="h-2.5 w-2.5" /> : i + 1}
              </div>
              <span className={cn("text-[9px] font-medium capitalize",
                done ? "text-emerald-600" : active ? "text-primary" : "text-muted-foreground/40")}>
                {s}
              </span>
            </div>
            {i < STEPS.length - 1 && <div className={cn("h-px flex-1 mb-3.5 mx-1", done ? "bg-emerald-500/40" : "bg-border/40")} />}
          </div>
        );
      })}
    </div>
  );
}

function platformIcon(p: string) {
  return p === "youtube" ? <Youtube className="h-3.5 w-3.5 text-rose-500" /> : <Send className="h-3.5 w-3.5 text-muted-foreground" />;
}
function fmtDate(iso: string | null) {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}
function toDatetimeLocal(iso: string) {
  const d = new Date(iso), pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// ── Push state ──────────────────────────────────────────────────────────
type PushPhase = "idle"|"init"|"download"|"upload"|"done"|"error";
interface PushState { phase: PushPhase; pct: number; error: string|null }

// ── QueueRow ────────────────────────────────────────────────────────────
function QueueRow({ item, onDelete, onStatusChange }: {
  item: QueueItem;
  onDelete: (id: string) => void;
  onStatusChange: (id: string, status: string, extra?: Partial<QueueItem>) => void;
}) {
  const [push, setPush] = useState<PushState>({ phase: "idle", pct: 0, error: null });
  const [, startTransition] = useTransition();
  const [scheduleDraft, setScheduleDraft] = useState(item.scheduled_for ? toDatetimeLocal(item.scheduled_for) : "");
  const [savingSched, setSavingSched] = useState(false);
  const countdown = useCountdown(item.status === "scheduled" ? item.scheduled_for : null);

  const canDelete = ["draft", "approved", "failed"].includes(item.status);
  const canPublishNow = item.platform === "youtube" && !!item.archive_id && item.status !== "published" && item.status !== "publishing";
  const isPushing = ["init","download","upload"].includes(push.phase);

  const handlePublishNow = async () => {
    if (!item.archive_id) return;
    const meta = item.platform_meta as Record<string, string>;
    setPush({ phase: "init", pct: 0, error: null });
    onStatusChange(item.id, "publishing");
    const result = await pushArchiveToYoutube({
      archiveId: item.archive_id,
      title: meta.title ?? item.title,
      description: meta.description ?? item.body ?? "",
      privacyStatus: (meta.privacy as "private"|"unlisted"|"public") ?? "private",
      tags: meta.tags ? (meta.tags as unknown as string[]) : undefined,
      onDownloadProgress: (f) => setPush({ phase: "download", pct: Math.round(f*50), error: null }),
      onUploadProgress: (f) => setPush({ phase: "upload", pct: 50+Math.round(f*50), error: null }),
    });
    const publishedAt = new Date().toISOString();
    if (result.status === "pushed") {
      setPush({ phase: "done", pct: 100, error: null });
      onStatusChange(item.id, "published", { published_at: publishedAt });
      startTransition(() => { fetch(`/api/ai/publish/queue/${item.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "published", published_at: publishedAt }) }).catch(() => {}); });
      toast.success("Pushed to YouTube — check YouTube Studio for processing.");
    } else {
      setPush({ phase: "error", pct: 0, error: result.message });
      onStatusChange(item.id, "failed", { last_error: result.message });
      startTransition(() => { fetch(`/api/ai/publish/queue/${item.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "failed", last_error: result.message }) }).catch(() => {}); });
      toast.error(`Publish failed: ${result.message}`);
    }
  };

  const handleSchedule = async () => {
    if (!scheduleDraft) return;
    const scheduled_for = new Date(scheduleDraft).toISOString();
    setSavingSched(true);
    try {
      const res = await fetch(`/api/ai/publish/queue/${item.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "scheduled", scheduled_for }) });
      if (!res.ok) { toast.error("Failed to schedule"); return; }
      onStatusChange(item.id, "scheduled", { scheduled_for });
      toast.success("Scheduled — the system will auto-publish at this time.");
    } finally { setSavingSched(false); }
  };

  const handleUnschedule = async () => {
    const res = await fetch(`/api/ai/publish/queue/${item.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "draft", scheduled_for: null }) });
    if (!res.ok) { toast.error("Failed to unschedule"); return; }
    onStatusChange(item.id, "draft", { scheduled_for: null });
    toast.success("Moved back to Draft");
  };

  const handleRetry = async () => {
    const res = await fetch(`/api/ai/publish/queue/${item.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "draft", last_error: null }) });
    if (!res.ok) { toast.error("Failed"); return; }
    onStatusChange(item.id, "draft", { last_error: null });
    toast.success("Reset to Draft — schedule or publish again");
  };

  return (
    <Card className={cn("overflow-hidden transition-all", item.status === "published" && "opacity-75", item.status === "failed" && "border-destructive/30")}>
      <CardContent className="p-4">
        {/* Header row */}
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-muted">{platformIcon(item.platform)}</div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="truncate max-w-xs text-sm font-medium">{item.title}</span>
              <StatusBadge status={item.status} />
              {item.status === "scheduled" && countdown && (
                <span className="flex items-center gap-1 text-[10px] font-medium text-violet-600 dark:text-violet-400">
                  <CalendarClock className="h-3 w-3" />publishes in {countdown}
                </span>
              )}
              {item.status === "published" && item.published_at && (
                <span className="text-[10px] text-emerald-600 dark:text-emerald-400">· {fmtDate(item.published_at)}</span>
              )}
            </div>
            <p className="mt-0.5 text-[11px] text-muted-foreground capitalize">{item.platform}</p>
          </div>
          <div className="flex shrink-0 items-center gap-1 pl-2">
            {item.platform_post_url && (
              <a href={item.platform_post_url} target="_blank" rel="noreferrer">
                <Button variant="ghost" size="sm" className="h-7 gap-1 text-[11px]"><ExternalLink className="h-3 w-3" />View</Button>
              </a>
            )}
            {canDelete && (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"><Trash2 className="h-3.5 w-3.5" /></Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Remove from queue?</AlertDialogTitle>
                    <AlertDialogDescription>&ldquo;{item.title}&rdquo; will be permanently removed.</AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={() => onDelete(item.id)} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Remove</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
          </div>
        </div>

        {/* Pipeline track */}
        <PipelineTrack status={item.status} />

        {/* DRAFT actions */}
        {item.status === "draft" && (
          <div className="space-y-2 border-t border-border/40 pt-3">
            <p className="text-[11px] text-muted-foreground">Schedule for auto-publish, or push to YouTube now if your channel is connected.</p>
            <div className="flex flex-wrap items-center gap-2">
              <input type="datetime-local" value={scheduleDraft} onChange={(e) => setScheduleDraft(e.target.value)} min={new Date().toISOString().slice(0,16)}
                className="h-8 rounded-md border border-border bg-background px-2 text-[12px] focus:outline-none focus:ring-1 focus:ring-primary/30" />
              <Button size="sm" variant="outline" className="h-8 gap-1 text-xs" onClick={handleSchedule} disabled={!scheduleDraft || savingSched}>
                {savingSched ? <Loader2 className="h-3 w-3 animate-spin" /> : <CalendarClock className="h-3 w-3" />}Schedule
              </Button>
              {canPublishNow && !isPushing && (
                <Button size="sm" className="h-8 gap-1 text-xs" onClick={handlePublishNow}>
                  <Youtube className="h-3 w-3" />Publish Now
                </Button>
              )}
              {!item.archive_id && item.platform === "youtube" && (
                <span className="flex items-center gap-1 text-[10px] text-amber-600 dark:text-amber-400">
                  <Info className="h-3 w-3 shrink-0" />No linked recording — connect an archive for auto-upload
                </span>
              )}
            </div>
          </div>
        )}

        {/* SCHEDULED actions */}
        {item.status === "scheduled" && (
          <div className="space-y-2 border-t border-border/40 pt-3">
            <div className="flex items-start gap-2 rounded-lg border border-violet-200/60 bg-violet-50/40 px-3 py-2 dark:border-violet-800/40 dark:bg-violet-950/20">
              <CalendarClock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-violet-600 dark:text-violet-400" />
              <p className="text-[11px] text-violet-700 dark:text-violet-300">
                <strong>Scheduled for {fmtDate(item.scheduled_for)}.</strong> The system will auto-upload to YouTube at this time via the hourly cron.
                {countdown && countdown !== "now" && <span className="ml-1">({countdown} remaining)</span>}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <input type="datetime-local" value={scheduleDraft || (item.scheduled_for ? toDatetimeLocal(item.scheduled_for) : "")}
                onChange={(e) => setScheduleDraft(e.target.value)} min={new Date().toISOString().slice(0,16)}
                className="h-7 rounded-md border border-border bg-background px-2 text-[11px] focus:outline-none focus:ring-1 focus:ring-primary/30" />
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={handleSchedule} disabled={!scheduleDraft || savingSched}>
                {savingSched ? <Loader2 className="h-3 w-3 animate-spin" /> : "Update"}
              </Button>
              <Button size="sm" variant="ghost" className="h-7 text-xs text-muted-foreground" onClick={handleUnschedule}>
                <X className="h-3 w-3 mr-1" />Unschedule
              </Button>
              {canPublishNow && !isPushing && (
                <Button size="sm" className="h-7 gap-1 text-xs" onClick={handlePublishNow}>
                  <Youtube className="h-3 w-3" />Publish Now
                </Button>
              )}
            </div>
          </div>
        )}

        {/* PUBLISHING progress */}
        {(item.status === "publishing" || isPushing) && (
          <div className="space-y-1.5 border-t border-border/40 pt-3">
            <div className="flex items-center justify-between text-[10px] text-muted-foreground">
              <span>{push.phase === "download" ? "Fetching video…" : push.phase === "upload" ? "Uploading to YouTube…" : "Connecting…"}</span>
              {push.pct > 0 && <span>{push.pct}%</span>}
            </div>
            <Progress value={push.pct || 15} className="h-1.5" />
            <p className="text-[10px] text-muted-foreground">Keep this tab open. Large files may take several minutes.</p>
          </div>
        )}

        {/* FAILED actions */}
        {item.status === "failed" && (
          <div className="space-y-2 border-t border-destructive/20 pt-3">
            {item.last_error && (
              <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2">
                <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />
                <p className="text-[11px] text-destructive leading-snug">{item.last_error}</p>
              </div>
            )}
            <div className="flex gap-2">
              <Button size="sm" variant="outline" className="h-7 gap-1 text-xs border-destructive/40 text-destructive hover:bg-destructive/10" onClick={handleRetry}>
                <RefreshCw className="h-3 w-3" />Retry
              </Button>
              {canPublishNow && !isPushing && (
                <Button size="sm" className="h-7 gap-1 text-xs" onClick={handlePublishNow}>
                  <Youtube className="h-3 w-3" />Publish Now
                </Button>
              )}
            </div>
          </div>
        )}

        {/* PUBLISHED strip */}
        {item.status === "published" && item.platform_post_url && (
          <div className="flex items-center gap-2 border-t border-emerald-500/20 pt-3 text-[11px] text-emerald-600 dark:text-emerald-400">
            <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
            <span>Successfully published to YouTube</span>
            <a href={item.platform_post_url} target="_blank" rel="noreferrer" className="ml-auto flex items-center gap-0.5 hover:underline">
              View on YouTube <ExternalLink className="h-2.5 w-2.5" />
            </a>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Create dialog ─────────────────────────────────────────────────────

const BLANK = {
  title: "", body: "", platform: "youtube" as string,
  scheduled_for: "", privacy: "private" as string, description: "",
};

function CreateDialog({ open, onOpenChange, onCreate, youtubeConnected }: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCreate: (item: QueueItem) => void;
  youtubeConnected: boolean;
}) {
  const [form, setForm] = useState(BLANK);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const set = (k: keyof typeof BLANK, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const handleSave = async () => {
    setErr(null);
    if (!form.title.trim()) { setErr("Title is required"); return; }

    const platform_meta: Record<string, string> = {};
    if (form.platform === "youtube") {
      platform_meta.title = form.title.trim();
      if (form.description.trim()) platform_meta.description = form.description.trim();
      platform_meta.privacy = form.privacy;
    }

    setSaving(true);
    try {
      const res = await fetch("/api/ai/publish/queue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: form.title.trim(),
          body: form.body.trim() || null,
          platform: form.platform,
          platform_meta,
          scheduled_for: form.scheduled_for || null,
        }),
      });
      const json = await res.json();
      if (!res.ok) { setErr(json.error ?? "Failed to create item"); return; }
      setForm(BLANK);
      onCreate(json.item as QueueItem);
    } catch { setErr("Network error"); }
    finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!saving) { onOpenChange(v); if (!v) { setForm(BLANK); setErr(null); } } }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Plus className="h-4 w-4 text-sky-500" />
            Add to queue
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-1">
          <div className="space-y-1">
            <Label className="text-xs">Title <span className="text-destructive">*</span></Label>
            <Input value={form.title} onChange={(e) => set("title", e.target.value)} placeholder="Post title" className="h-8 text-sm" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Platform</Label>
            <Select value={form.platform} onValueChange={(v) => set("platform", v)}>
              <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="youtube" className="text-sm">
                  <span className="flex items-center gap-2"><Youtube className="h-3.5 w-3.5 text-rose-500" />YouTube</span>
                </SelectItem>
                <SelectItem value="instagram" className="text-sm" disabled>Instagram (coming soon)</SelectItem>
                <SelectItem value="tiktok" className="text-sm" disabled>TikTok (coming soon)</SelectItem>
                <SelectItem value="twitter" className="text-sm" disabled>Twitter/X (coming soon)</SelectItem>
              </SelectContent>
            </Select>
            {form.platform === "youtube" && !youtubeConnected && (
              <p className="text-[11px] text-amber-600 dark:text-amber-400">
                YouTube is not connected. Connect it in the Connections tab first.
              </p>
            )}
          </div>
          {form.platform === "youtube" && (
            <>
              <div className="space-y-1">
                <Label className="text-xs">Description <span className="text-muted-foreground">(optional)</span></Label>
                <Textarea value={form.description} onChange={(e) => set("description", e.target.value)}
                  placeholder="Video description…" className="min-h-[60px] resize-none text-sm" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Privacy</Label>
                <Select value={form.privacy} onValueChange={(v) => set("privacy", v)}>
                  <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="private" className="text-sm">Private</SelectItem>
                    <SelectItem value="unlisted" className="text-sm">Unlisted</SelectItem>
                    <SelectItem value="public" className="text-sm">Public</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </>
          )}
          <div className="space-y-1">
            <Label className="text-xs">Schedule for <span className="text-muted-foreground">(optional — leave blank to save as draft)</span></Label>
            <Input type="datetime-local" value={form.scheduled_for} min={new Date().toISOString().slice(0,16)} onChange={(e) => set("scheduled_for", e.target.value)} className="h-8 text-sm" />
          </div>
          {form.scheduled_for && (
            <div className="flex items-start gap-2 rounded-lg border border-violet-200/60 bg-violet-50/40 px-3 py-2 dark:border-violet-800/40 dark:bg-violet-950/20">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-violet-600 dark:text-violet-400" />
              <p className="text-[11px] text-violet-700 dark:text-violet-300">The system will auto-publish this at the scheduled time via the hourly cron. YouTube must be connected and a linked archive recording must exist for automatic upload to work.</p>
            </div>
          )}
          {err && (
            <div className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              <AlertCircle className="h-3.5 w-3.5 shrink-0" /> {err}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button size="sm" onClick={handleSave} disabled={saving} className="gap-1.5">
            {saving ? <><Loader2 className="h-3.5 w-3.5 animate-spin" />Saving…</> : form.scheduled_for ? <><CalendarClock className="h-3.5 w-3.5" />Schedule post</> : <><Plus className="h-3.5 w-3.5" />Add as Draft</>}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Queue Tab ─────────────────────────────────────────────────────────

const STATUS_FILTERS = ["all", "draft", "scheduled", "published", "failed"] as const;
type StatusFilter = typeof STATUS_FILTERS[number];

export function QueueTab({ initialItems, youtubeConnected }: { initialItems: QueueItem[]; youtubeConnected: boolean }) {
  const [items, setItems] = useState<QueueItem[]>(initialItems);
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [, startTransition] = useTransition();

  const counts: Record<StatusFilter, number> = {
    all: items.length,
    draft: items.filter((i) => i.status === "draft").length,
    scheduled: items.filter((i) => i.status === "scheduled").length,
    published: items.filter((i) => i.status === "published").length,
    failed: items.filter((i) => i.status === "failed").length,
  };

  const handleDelete = (id: string) => {
    startTransition(async () => {
      const res = await fetch(`/api/ai/publish/queue/${id}`, { method: "DELETE" });
      if (res.ok || res.status === 204) {
        setItems((p) => p.filter((i) => i.id !== id));
        toast.success("Removed from queue");
      } else toast.error("Failed to remove item");
    });
  };

  const handleStatusChange = (id: string, status: string, extra?: Partial<QueueItem>) => {
    setItems((p) => p.map((i) => i.id === id ? { ...i, status, ...extra } : i));
  };

  const handleCreate = (item: QueueItem) => {
    setItems((p) => [item, ...p]);
    setDialogOpen(false);
    toast.success(item.status === "scheduled" ? "Scheduled — will auto-publish at the set time" : "Saved as Draft — schedule or publish manually from the queue");
  };

  const visible = filter === "all" ? items : items.filter((i) => i.status === filter);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1">
          {STATUS_FILTERS.map((f) => (
            <button key={f} onClick={() => setFilter(f)}
              className={cn("flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium capitalize transition-colors",
                filter === f ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground")}>
              {f}
              {counts[f] > 0 && (
                <span className={cn("rounded-full px-1 text-[9px] tabular-nums",
                  filter === f ? "bg-white/20" : "bg-muted")}>{counts[f]}</span>
              )}
            </button>
          ))}
        </div>
        <Button size="sm" variant="outline" className="h-8 gap-1.5" onClick={() => setDialogOpen(true)}>
          <Plus className="h-3.5 w-3.5" /> New post
        </Button>
      </div>

      {visible.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border px-8 py-12 text-center">
          <Send className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
          <p className="text-sm font-medium">
            {filter === "all" ? "No items in queue" : `No ${filter} items`}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {filter === "all" ? "Add a post to start building your publishing pipeline." : `Switch to 'all' to see every item.`}
          </p>
          {filter === "all" && (
            <Button size="sm" variant="outline" className="mt-4 gap-1.5" onClick={() => setDialogOpen(true)}>
              <Plus className="h-3.5 w-3.5" /> Add first post
            </Button>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {visible.map((item) => (
            <QueueRow key={item.id} item={item} onDelete={handleDelete} onStatusChange={handleStatusChange} />
          ))}
        </div>
      )}

      <CreateDialog open={dialogOpen} onOpenChange={setDialogOpen} onCreate={handleCreate} youtubeConnected={youtubeConnected} />
    </div>
  );
}
