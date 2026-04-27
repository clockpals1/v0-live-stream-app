"use client";

import { useState, useTransition } from "react";
import {
  Youtube,
  Plus,
  Trash2,
  Send,
  Clock,
  CheckCircle2,
  XCircle,
  Loader2,
  AlertCircle,
  ExternalLink,
  Calendar,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { pushArchiveToYoutube } from "@/lib/distribution/youtube-push";
import type { QueueItem } from "./hub-view";

// ── Status display ─────────────────────────────────────────────────────

const STATUS_META: Record<string, { label: string; color: string; icon: React.ComponentType<{ className?: string }> }> = {
  draft:      { label: "Draft",      color: "text-muted-foreground border-border",                  icon: Clock },
  approved:   { label: "Approved",   color: "text-blue-600 border-blue-500/40 bg-blue-500/5",       icon: CheckCircle2 },
  scheduled:  { label: "Scheduled",  color: "text-violet-600 border-violet-500/40 bg-violet-500/5", icon: Calendar },
  publishing: { label: "Publishing", color: "text-amber-600 border-amber-500/40 bg-amber-500/5",    icon: Loader2 },
  published:  { label: "Published",  color: "text-emerald-600 border-emerald-500/40 bg-emerald-500/5", icon: CheckCircle2 },
  failed:     { label: "Failed",     color: "text-destructive border-destructive/40 bg-destructive/10", icon: XCircle },
};

function StatusBadge({ status }: { status: string }) {
  const meta = STATUS_META[status] ?? STATUS_META.draft;
  const Icon = meta.icon;
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium", meta.color)}>
      <Icon className={cn("h-3 w-3", status === "publishing" && "animate-spin")} />
      {meta.label}
    </span>
  );
}

function platformIcon(platform: string) {
  if (platform === "youtube") return <Youtube className="h-3.5 w-3.5 text-rose-500" />;
  return <Send className="h-3.5 w-3.5 text-muted-foreground" />;
}

function fmtDate(iso: string | null) {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

// ── Push state for YouTube publish-now ────────────────────────────────
type PushPhase = "idle" | "init" | "download" | "upload" | "done" | "error";
interface PushState { phase: PushPhase; pct: number; error: string | null }

// ── Queue item row ────────────────────────────────────────────────────

function QueueRow({
  item,
  onDelete,
  onStatusChange,
}: {
  item: QueueItem;
  onDelete: (id: string) => void;
  onStatusChange: (id: string, status: string, extra?: Partial<QueueItem>) => void;
}) {
  const [push, setPush] = useState<PushState>({ phase: "idle", pct: 0, error: null });
  const [pending, startTransition] = useTransition();

  const canDelete = ["draft", "approved", "failed"].includes(item.status);
  const canPublishNow = item.platform === "youtube" && item.archive_id && item.status !== "published" && item.status !== "publishing";

  const handlePublishNow = async () => {
    if (!item.archive_id) return;
    const meta = item.platform_meta as Record<string, string>;
    setPush({ phase: "init", pct: 0, error: null });
    onStatusChange(item.id, "publishing");

    const result = await pushArchiveToYoutube({
      archiveId: item.archive_id,
      title: meta.title ?? item.title,
      description: meta.description ?? item.body ?? "",
      privacyStatus: (meta.privacy as "private" | "unlisted" | "public") ?? "private",
      tags: meta.tags ? (meta.tags as unknown as string[]) : undefined,
      onDownloadProgress: (f) => setPush({ phase: "download", pct: Math.round(f * 50), error: null }),
      onUploadProgress: (f) => setPush({ phase: "upload", pct: 50 + Math.round(f * 50), error: null }),
    });

    if (result.status === "pushed") {
      setPush({ phase: "done", pct: 100, error: null });
      onStatusChange(item.id, "published", { published_at: new Date().toISOString() });
      startTransition(() => {
        fetch(`/api/ai/publish/queue/${item.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "published", published_at: new Date().toISOString() }),
        }).catch(() => {});
      });
      toast.success("Pushed to YouTube. Check YouTube Studio for processing status.");
    } else {
      setPush({ phase: "error", pct: 0, error: result.message });
      onStatusChange(item.id, "failed", { last_error: result.message });
      startTransition(() => {
        fetch(`/api/ai/publish/queue/${item.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "failed", last_error: result.message }),
        }).catch(() => {});
      });
      toast.error(`Publish failed: ${result.message}`);
    }
  };

  const isPushing = push.phase === "download" || push.phase === "upload" || push.phase === "init";

  return (
    <Card className={cn("transition-opacity", item.status === "published" && "opacity-70")}>
      <CardContent className="flex items-start gap-3 p-4">
        <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-muted">
          {platformIcon(item.platform)}
        </div>

        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-sm font-medium leading-snug">{item.title}</span>
            <StatusBadge status={item.status} />
          </div>

          <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
            <span className="capitalize">{item.platform}</span>
            {item.scheduled_for && (
              <span className="flex items-center gap-0.5">
                <Calendar className="h-3 w-3" />
                {fmtDate(item.scheduled_for)}
              </span>
            )}
            {item.published_at && (
              <span className="flex items-center gap-0.5 text-emerald-600 dark:text-emerald-400">
                <CheckCircle2 className="h-3 w-3" />
                {fmtDate(item.published_at)}
              </span>
            )}
            {item.platform_post_url && (
              <a href={item.platform_post_url} target="_blank" rel="noreferrer"
                className="flex items-center gap-0.5 hover:text-foreground hover:underline">
                View post <ExternalLink className="h-2.5 w-2.5" />
              </a>
            )}
          </div>

          {item.last_error && item.status === "failed" && (
            <p className="text-[11px] text-destructive flex items-center gap-1">
              <AlertCircle className="h-3 w-3 shrink-0" />
              {item.last_error}
            </p>
          )}

          {isPushing && (
            <div className="space-y-0.5 pt-1">
              <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                <span>{push.phase === "download" ? "Downloading…" : push.phase === "upload" ? "Uploading to YouTube…" : "Starting…"}</span>
                <span>{push.pct}%</span>
              </div>
              <Progress value={push.pct} className="h-1" />
            </div>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-1.5 pl-2">
          {canPublishNow && !isPushing && item.status !== "published" && (
            <Button size="sm" variant="outline" className="h-7 gap-1 text-xs"
              onClick={handlePublishNow} disabled={pending}>
              <Youtube className="h-3 w-3 text-rose-500" />
              Publish
            </Button>
          )}

          {canDelete && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive" disabled={pending}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Remove from queue?</AlertDialogTitle>
                  <AlertDialogDescription>
                    &ldquo;{item.title}&rdquo; will be removed. This cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={() => onDelete(item.id)}
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                    Remove
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </div>
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
            <Input type="datetime-local" value={form.scheduled_for} onChange={(e) => set("scheduled_for", e.target.value)} className="h-8 text-sm" />
          </div>
          {err && (
            <div className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              <AlertCircle className="h-3.5 w-3.5 shrink-0" /> {err}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button size="sm" onClick={handleSave} disabled={saving} className="gap-1.5">
            {saving ? <><Loader2 className="h-3.5 w-3.5 animate-spin" />Saving…</> : <><Plus className="h-3.5 w-3.5" />Add to queue</>}
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
    toast.success("Added to queue");
  };

  const visible = filter === "all" ? items : items.filter((i) => i.status === filter);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-1">
          {STATUS_FILTERS.map((f) => (
            <button key={f} onClick={() => setFilter(f)}
              className={cn("rounded-full px-3 py-1 text-xs font-medium capitalize transition-colors",
                filter === f ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground")}>
              {f}
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
        <div className="space-y-2">
          {visible.map((item) => (
            <QueueRow key={item.id} item={item} onDelete={handleDelete} onStatusChange={handleStatusChange} />
          ))}
        </div>
      )}

      <CreateDialog open={dialogOpen} onOpenChange={setDialogOpen} onCreate={handleCreate} youtubeConnected={youtubeConnected} />
    </div>
  );
}
