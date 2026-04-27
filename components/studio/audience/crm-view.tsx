"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  Users,
  Mail,
  Send,
  Search,
  Download,
  RefreshCw,
  Sparkles,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Loader2,
  Eye,
  Code2,
  Wand2,
  Bold,
  Italic,
  Heading2,
  List,
  Quote,
  Link as LinkIcon,
  UserPlus,
  Clock,
  Star,
  TrendingDown,
  Calendar,
  ChevronRight,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────

interface Subscriber {
  id: string;
  email: string;
  source_room_code: string | null;
  is_active: boolean;
  created_at: string;
  unsubscribed_at: string | null;
}

interface Broadcast {
  id: string;
  subject: string;
  recipient_count: number;
  sent_count: number | null;
  failed_count: number | null;
  status: "sending" | "sent" | "partial" | "failed" | "scheduled";
  sent_at: string | null;
  created_at: string;
}

type Segment = "all" | "new_this_week" | "top_fans" | "lapsed";

// ─── Helpers ──────────────────────────────────────────────────────────

function fmt(iso: string): string {
  try {
    const d = new Date(iso);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffDays = Math.floor(diffMs / 86400000);
    if (diffDays === 0) return "Today";
    if (diffDays === 1) return "Yesterday";
    if (diffDays < 7) return `${diffDays}d ago`;
    return d.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: d.getFullYear() !== now.getFullYear() ? "numeric" : undefined,
    });
  } catch {
    return "—";
  }
}

function computeSegment(sub: Subscriber, now: number): Segment[] {
  const tags: Segment[] = [];
  const age = now - new Date(sub.created_at).getTime();
  const weekMs = 7 * 24 * 60 * 60 * 1000;
  const ninetyDaysMs = 90 * 24 * 60 * 60 * 1000;
  if (!sub.is_active) {
    tags.push("lapsed");
  } else {
    tags.push("all");
    if (age < weekMs) tags.push("new_this_week");
    if (age >= ninetyDaysMs) tags.push("top_fans");
  }
  return tags;
}

// ─── Segment pills definition ─────────────────────────────────────────

const SEGMENTS: { key: Segment; label: string; icon: React.ReactNode; color: string }[] = [
  { key: "all", label: "All active", icon: <Users className="h-3 w-3" />, color: "bg-primary/10 text-primary border-primary/20" },
  { key: "new_this_week", label: "New this week", icon: <UserPlus className="h-3 w-3" />, color: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20" },
  { key: "top_fans", label: "Top fans", icon: <Star className="h-3 w-3" />, color: "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20" },
  { key: "lapsed", label: "Lapsed", icon: <TrendingDown className="h-3 w-3" />, color: "bg-muted text-muted-foreground border-border" },
];

// ─── Stat card ────────────────────────────────────────────────────────

function StatCard({ icon, label, value, sub, accent }: {
  icon: React.ReactNode;
  label: string;
  value: number;
  sub?: string;
  accent?: string;
}) {
  return (
    <Card className={cn("transition-colors", accent)}>
      <CardContent className="p-4">
        <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
          {icon}
          {label}
        </div>
        <div className="mt-1.5 text-2xl font-semibold tabular-nums">{value.toLocaleString()}</div>
        {sub && <div className="mt-0.5 text-[11px] text-muted-foreground">{sub}</div>}
      </CardContent>
    </Card>
  );
}

// ─── Broadcast status badge ───────────────────────────────────────────

function BroadcastStatusBadge({ status }: { status: Broadcast["status"] }) {
  const map: Record<Broadcast["status"], { label: string; cls: string }> = {
    sent: { label: "Sent", cls: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" },
    partial: { label: "Partial", cls: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400" },
    failed: { label: "Failed", cls: "border-destructive/30 bg-destructive/10 text-destructive" },
    sending: { label: "Sending…", cls: "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-400" },
    scheduled: { label: "Scheduled", cls: "border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-400" },
  };
  const { label, cls } = map[status] ?? { label: status, cls: "" };
  return <Badge variant="outline" className={cn("text-[10px]", cls)}>{label}</Badge>;
}

// ─── Broadcast composer dialog ────────────────────────────────────────

const STARTER_HTML = `<p>Hi there,</p>\n<p>Thanks for being part of the Insider Circle. Here's what's coming up:</p>\n<ul>\n  <li>Next live session: <strong>(date / time)</strong></li>\n  <li>(Topic or special guest)</li>\n</ul>\n<p>See you there.</p>`;

function ComposerDialog({
  recipientCount,
  hostName,
  open,
  onOpenChange,
  onSent,
}: {
  recipientCount: number;
  hostName: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSent: () => void;
}) {
  const [subject, setSubject] = useState("");
  const [html, setHtml] = useState(STARTER_HTML);
  const [tab, setTab] = useState<"visual" | "html" | "preview">("visual");
  const [sending, setSending] = useState(false);
  const editorRef = useRef<HTMLDivElement | null>(null);
  const visualMountedRef = useRef(false);

  useEffect(() => {
    if (!open) { setSubject(""); setHtml(STARTER_HTML); setTab("visual"); visualMountedRef.current = false; }
  }, [open]);

  useEffect(() => {
    if (tab !== "visual") return;
    const el = editorRef.current;
    if (!el || visualMountedRef.current) return;
    el.innerHTML = html;
    visualMountedRef.current = true;
  }, [tab, html]);

  const captureFromVisual = useCallback(() => {
    if (editorRef.current) setHtml(editorRef.current.innerHTML);
  }, []);

  const exec = (cmd: string, arg?: string) => {
    document.execCommand(cmd, false, arg);
    captureFromVisual();
    editorRef.current?.focus();
  };

  const handleSend = async () => {
    if (!subject.trim()) { toast.error("Please add a subject."); return; }
    const finalHtml = tab === "visual" && editorRef.current ? editorRef.current.innerHTML : html;
    if (finalHtml.trim().length < 10) { toast.error("Message body is empty."); return; }
    setSending(true);
    try {
      const res = await fetch("/api/insider/broadcast", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subject: subject.trim(), html_body: finalHtml }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) { toast.error(json?.error ?? "Couldn't send the broadcast."); return; }
      const sent = json.sent_count ?? 0;
      const failed = json.failed_count ?? 0;
      if (failed === 0) toast.success(`Sent to ${sent.toLocaleString()} subscriber${sent === 1 ? "" : "s"}.`);
      else toast.warning(`Sent ${sent}, failed ${failed}. Check logs.`);
      onSent();
      onOpenChange(false);
    } catch { toast.error("Network error. Try again."); }
    finally { setSending(false); }
  };

  const ToolbarBtn = ({ onClick, label, children }: { onClick: () => void; label: string; children: React.ReactNode }) => (
    <button type="button" title={label} onClick={onClick}
      className="flex h-7 w-7 items-center justify-center rounded border border-border bg-background text-foreground hover:bg-muted">
      {children}
    </button>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            Compose broadcast
          </DialogTitle>
          <DialogDescription>
            Sending to <strong>{recipientCount.toLocaleString()}</strong> active subscriber{recipientCount !== 1 ? "s" : ""}. Every email gets a one-click unsubscribe footer.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="bc-subject">Subject</Label>
            <Input id="bc-subject" value={subject} onChange={(e) => setSubject(e.target.value)}
              maxLength={200} placeholder="What will subscribers see in their inbox?" />
          </div>

          <Tabs value={tab} onValueChange={(v) => { if (tab === "visual") captureFromVisual(); visualMountedRef.current = false; setTab(v as typeof tab); }}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <TabsList className="grid w-full max-w-xs grid-cols-3">
                <TabsTrigger value="visual" className="gap-1 text-xs"><Wand2 className="h-3 w-3" />Visual</TabsTrigger>
                <TabsTrigger value="html" className="gap-1 text-xs"><Code2 className="h-3 w-3" />HTML</TabsTrigger>
                <TabsTrigger value="preview" className="gap-1 text-xs"><Eye className="h-3 w-3" />Preview</TabsTrigger>
              </TabsList>
              {tab === "visual" && (
                <div className="flex items-center gap-1">
                  <ToolbarBtn onClick={() => exec("bold")} label="Bold"><Bold className="h-3.5 w-3.5" /></ToolbarBtn>
                  <ToolbarBtn onClick={() => exec("italic")} label="Italic"><Italic className="h-3.5 w-3.5" /></ToolbarBtn>
                  <ToolbarBtn onClick={() => exec("formatBlock", "<h2>")} label="Heading"><Heading2 className="h-3.5 w-3.5" /></ToolbarBtn>
                  <ToolbarBtn onClick={() => exec("insertUnorderedList")} label="List"><List className="h-3.5 w-3.5" /></ToolbarBtn>
                  <ToolbarBtn onClick={() => exec("formatBlock", "<blockquote>")} label="Quote"><Quote className="h-3.5 w-3.5" /></ToolbarBtn>
                  <ToolbarBtn onClick={() => { const url = window.prompt("URL:", "https://"); if (url) exec("createLink", url); }} label="Link">
                    <LinkIcon className="h-3.5 w-3.5" />
                  </ToolbarBtn>
                </div>
              )}
            </div>

            <TabsContent value="visual" className="mt-2">
              <div ref={editorRef} contentEditable suppressContentEditableWarning onInput={captureFromVisual}
                className="min-h-[240px] max-h-[380px] overflow-y-auto rounded-md border border-input bg-background px-4 py-3 text-sm leading-relaxed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&_h2]:mb-1.5 [&_h2]:mt-3 [&_h2]:text-base [&_h2]:font-semibold [&_p]:my-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_blockquote]:border-l-2 [&_blockquote]:border-muted-foreground/30 [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground [&_a]:text-primary [&_a]:underline" />
            </TabsContent>
            <TabsContent value="html" className="mt-2">
              <textarea value={html} onChange={(e) => setHtml(e.target.value)} spellCheck={false}
                className="w-full min-h-[240px] max-h-[380px] rounded-md border border-input bg-background px-3 py-2 font-mono text-xs leading-relaxed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
            </TabsContent>
            <TabsContent value="preview" className="mt-2">
              <div className="rounded-md border border-border bg-[#f4f4f5] p-4">
                <div className="mx-auto max-w-[560px] overflow-hidden rounded-lg bg-white shadow-sm">
                  <div className="border-b border-border px-6 py-4">
                    <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Insider Circle</div>
                    <div className="mt-0.5 text-base font-semibold">{hostName}</div>
                    <div className="mt-0.5 text-sm text-muted-foreground">{subject || "(Subject)"}</div>
                  </div>
                  <div className="px-6 py-5 text-sm leading-relaxed [&_h2]:mb-1.5 [&_h2]:mt-3 [&_h2]:text-base [&_h2]:font-semibold [&_p]:my-2 [&_ul]:list-disc [&_ul]:pl-5 [&_blockquote]:border-l-2 [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground [&_a]:text-primary [&_a]:underline"
                    dangerouslySetInnerHTML={{ __html: html }} />
                  <div className="border-t border-border px-6 py-4 text-[11px] text-muted-foreground">
                    You're getting this because you joined {hostName}'s Insider Circle.{" "}
                    <span className="underline">Unsubscribe</span>
                  </div>
                </div>
              </div>
            </TabsContent>
          </Tabs>
        </div>

        <DialogFooter>
          <Button variant="ghost" disabled={sending} onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={sending || !subject.trim()} onClick={handleSend} className="gap-1.5">
            {sending ? <><Loader2 className="h-3.5 w-3.5 animate-spin" />Sending…</> : <><Send className="h-3.5 w-3.5" />Send to {recipientCount.toLocaleString()}</>}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main CRM View ────────────────────────────────────────────────────

export function AudienceCrmView({ hostName }: { hostName: string }) {
  const [subs, setSubs] = useState<Subscriber[]>([]);
  const [broadcasts, setBroadcasts] = useState<Broadcast[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [composerOpen, setComposerOpen] = useState(false);
  const [segment, setSegment] = useState<Segment>("all");
  const [search, setSearch] = useState("");
  const [exporting, setExporting] = useState(false);

  const loadAll = useCallback(async () => {
    try {
      const [subRes, bcRes] = await Promise.all([
        fetch("/api/insider/subscribers", { cache: "no-store" }),
        fetch("/api/insider/broadcasts", { cache: "no-store" }),
      ]);
      const subJson = await subRes.json();
      const bcJson = await bcRes.json();
      if (subRes.ok) setSubs(subJson.subscribers ?? []);
      if (bcRes.ok) setBroadcasts(bcJson.broadcasts ?? []);
    } catch (e) {
      console.error("[audience/crm] load failed:", e);
    }
  }, []);

  useEffect(() => {
    (async () => { setLoading(true); await loadAll(); setLoading(false); })();
  }, [loadAll]);

  const handleRefresh = async () => { setRefreshing(true); await loadAll(); setRefreshing(false); };

  const now = useMemo(() => Date.now(), []);

  const active = useMemo(() => subs.filter((s) => s.is_active), [subs]);
  const newThisWeek = useMemo(() => active.filter((s) => now - new Date(s.created_at).getTime() < 7 * 86400000), [active, now]);
  const topFans = useMemo(() => active.filter((s) => now - new Date(s.created_at).getTime() >= 90 * 86400000), [active, now]);
  const lapsed = useMemo(() => subs.filter((s) => !s.is_active), [subs]);

  const segmented = useMemo(() => {
    switch (segment) {
      case "new_this_week": return newThisWeek;
      case "top_fans": return topFans;
      case "lapsed": return lapsed;
      default: return active;
    }
  }, [segment, active, newThisWeek, topFans, lapsed]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return segmented;
    return segmented.filter((s) => s.email.toLowerCase().includes(q));
  }, [segmented, search]);

  const segmentCounts: Record<Segment, number> = {
    all: active.length,
    new_this_week: newThisWeek.length,
    top_fans: topFans.length,
    lapsed: lapsed.length,
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      const res = await fetch("/api/insider/subscribers/export");
      if (!res.ok) { toast.error("Export failed."); return; }
      const blob = await res.blob();
      const cd = res.headers.get("Content-Disposition") ?? "";
      const match = cd.match(/filename="([^"]+)"/);
      const filename = match?.[1] ?? "subscribers.csv";
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = filename; a.click();
      URL.revokeObjectURL(url);
      toast.success("CSV exported.");
    } catch { toast.error("Export failed."); }
    finally { setExporting(false); }
  };

  return (
    <div className="space-y-8">
      {/* ─── Stats bar ──────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard icon={<Users className="h-3.5 w-3.5 text-primary" />} label="Active" value={active.length} accent="border-primary/20 bg-primary/5" />
        <StatCard icon={<UserPlus className="h-3.5 w-3.5 text-emerald-600" />} label="New this week" value={newThisWeek.length} />
        <StatCard icon={<Star className="h-3.5 w-3.5 text-amber-500" />} label="Top fans" sub="90+ days" value={topFans.length} />
        <StatCard icon={<TrendingDown className="h-3.5 w-3.5 text-muted-foreground" />} label="Lapsed" value={lapsed.length} />
      </div>

      {/* ─── Main tabs ──────────────────────────────────────────── */}
      <Tabs defaultValue="subscribers">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <TabsList>
            <TabsTrigger value="subscribers" className="gap-1.5 text-xs">
              <Users className="h-3.5 w-3.5" />
              Subscribers
            </TabsTrigger>
            <TabsTrigger value="broadcasts" className="gap-1.5 text-xs">
              <Mail className="h-3.5 w-3.5" />
              Broadcasts
              {broadcasts.length > 0 && (
                <Badge variant="secondary" className="ml-0.5 h-4 px-1 text-[10px]">{broadcasts.length}</Badge>
              )}
            </TabsTrigger>
          </TabsList>

          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={handleRefresh} disabled={refreshing}>
              <RefreshCw className={cn("mr-1.5 h-3.5 w-3.5", refreshing && "animate-spin")} />
              Refresh
            </Button>
            <Button variant="outline" size="sm" onClick={handleExport} disabled={exporting}>
              <Download className="mr-1.5 h-3.5 w-3.5" />
              {exporting ? "Exporting…" : "Export CSV"}
            </Button>
            <Button size="sm" className="gap-1.5" disabled={active.length === 0}
              onClick={() => setComposerOpen(true)}>
              <Send className="h-3.5 w-3.5" />
              Compose
            </Button>
          </div>
        </div>

        {/* ─── Subscribers tab ──────────────────────────────────── */}
        <TabsContent value="subscribers" className="mt-4 space-y-4">
          {/* Segment pills */}
          <div className="flex flex-wrap gap-2">
            {SEGMENTS.map((seg) => (
              <button key={seg.key} type="button"
                onClick={() => setSegment(seg.key)}
                className={cn(
                  "flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                  segment === seg.key ? seg.color : "border-border bg-background text-muted-foreground hover:bg-muted",
                )}>
                {seg.icon}
                {seg.label}
                <span className="ml-0.5 tabular-nums text-[10px] opacity-70">
                  {segmentCounts[seg.key]}
                </span>
              </button>
            ))}
          </div>

          {/* Search */}
          <div className="relative max-w-sm">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input placeholder="Search email…" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-8 h-8 text-sm" />
          </div>

          {/* Subscriber table */}
          <Card>
            <CardHeader className="border-b pb-3">
              <CardTitle className="flex items-center gap-2 text-sm font-semibold">
                <Sparkles className="h-3.5 w-3.5 text-primary" />
                {SEGMENTS.find((s) => s.key === segment)?.label ?? "All active"}
                <span className="ml-1 text-muted-foreground font-normal">({filtered.length})</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {loading ? (
                <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading subscribers…
                </div>
              ) : filtered.length === 0 ? (
                <div className="py-12 text-center text-sm text-muted-foreground">
                  {search ? `No matches for "${search}"` : "No subscribers in this segment yet."}
                </div>
              ) : (
                <ScrollArea className="max-h-[480px]">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 z-10 bg-card">
                      <tr className="border-b text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                        <th className="px-4 py-2 text-left">Email</th>
                        <th className="px-4 py-2 text-left">Joined</th>
                        <th className="px-4 py-2 text-left">Source</th>
                        <th className="px-4 py-2 text-left">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {filtered.map((s) => {
                        const tags = computeSegment(s, now);
                        return (
                          <tr key={s.id} className="group hover:bg-muted/40">
                            <td className="px-4 py-2.5">
                              <div className="flex items-center gap-2 min-w-0">
                                <span className="truncate font-mono text-[13px]">{s.email}</span>
                                {tags.includes("new_this_week") && (
                                  <Badge variant="outline" className="hidden text-[9px] border-emerald-500/30 text-emerald-600 dark:text-emerald-400 group-hover:inline-flex">New</Badge>
                                )}
                                {tags.includes("top_fans") && (
                                  <Badge variant="outline" className="hidden text-[9px] border-amber-500/30 text-amber-600 dark:text-amber-400 group-hover:inline-flex">Fan</Badge>
                                )}
                              </div>
                            </td>
                            <td className="px-4 py-2.5 text-xs text-muted-foreground whitespace-nowrap">{fmt(s.created_at)}</td>
                            <td className="px-4 py-2.5 text-xs text-muted-foreground">
                              {s.source_room_code ? (
                                <code className="rounded bg-muted px-1 py-0.5 text-[11px]">{s.source_room_code}</code>
                              ) : "—"}
                            </td>
                            <td className="px-4 py-2.5">
                              {s.is_active ? (
                                <span className="flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400">
                                  <CheckCircle2 className="h-3 w-3" />Active
                                </span>
                              ) : (
                                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                                  <XCircle className="h-3 w-3" />Lapsed
                                </span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </ScrollArea>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ─── Broadcasts tab ───────────────────────────────────── */}
        <TabsContent value="broadcasts" className="mt-4">
          <Card>
            <CardHeader className="border-b pb-3">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-sm font-semibold">Broadcast history</CardTitle>
                  <CardDescription className="text-xs">Every email campaign you've sent to your Insider Circle.</CardDescription>
                </div>
                <Button size="sm" className="gap-1.5" disabled={active.length === 0}
                  onClick={() => setComposerOpen(true)}>
                  <Send className="h-3.5 w-3.5" />
                  New broadcast
                </Button>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {loading ? (
                <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading…
                </div>
              ) : broadcasts.length === 0 ? (
                <div className="py-12 text-center">
                  <Mail className="mx-auto h-8 w-8 text-muted-foreground/40" />
                  <p className="mt-3 text-sm text-muted-foreground">No broadcasts sent yet.</p>
                  <p className="mt-1 text-xs text-muted-foreground">Hit "Compose" to send your first email to subscribers.</p>
                </div>
              ) : (
                <ScrollArea className="max-h-[480px]">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 z-10 bg-card">
                      <tr className="border-b text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                        <th className="px-4 py-2 text-left">Subject</th>
                        <th className="px-4 py-2 text-left">Recipients</th>
                        <th className="px-4 py-2 text-left">Sent</th>
                        <th className="px-4 py-2 text-left">Status</th>
                        <th className="px-4 py-2 text-left">Date</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {broadcasts.map((b) => (
                        <tr key={b.id} className="hover:bg-muted/40">
                          <td className="max-w-[240px] px-4 py-2.5">
                            <span className="block truncate font-medium">{b.subject}</span>
                          </td>
                          <td className="px-4 py-2.5 text-xs tabular-nums text-muted-foreground">
                            {b.recipient_count.toLocaleString()}
                          </td>
                          <td className="px-4 py-2.5 text-xs tabular-nums text-muted-foreground">
                            {b.sent_count?.toLocaleString() ?? "—"}
                            {(b.failed_count ?? 0) > 0 && (
                              <span className="ml-1 text-destructive">({b.failed_count} failed)</span>
                            )}
                          </td>
                          <td className="px-4 py-2.5">
                            <BroadcastStatusBadge status={b.status} />
                          </td>
                          <td className="px-4 py-2.5 text-xs text-muted-foreground whitespace-nowrap">
                            <span className="flex items-center gap-1">
                              <Calendar className="h-3 w-3" />
                              {fmt(b.sent_at ?? b.created_at)}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </ScrollArea>
              )}
            </CardContent>
          </Card>

          {/* Scheduling info banner */}
          <div className="mt-4 flex items-start gap-3 rounded-xl border border-violet-500/20 bg-violet-500/5 px-4 py-3">
            <Clock className="mt-0.5 h-4 w-4 shrink-0 text-violet-600 dark:text-violet-400" />
            <div>
              <p className="text-sm font-medium text-violet-700 dark:text-violet-300">Send-time scheduling</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Scheduled broadcasts are coming in a future update. For now, all emails send immediately
                when you click <strong>Send</strong>.
              </p>
            </div>
            <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-violet-400" />
          </div>
        </TabsContent>
      </Tabs>

      {/* ─── Export note ────────────────────────────────────────── */}
      <div className="flex items-start gap-3 rounded-xl border border-border bg-muted/30 px-5 py-4">
        <Download className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        <div>
          <p className="text-sm font-medium">CSV export &amp; compliance</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Exports include all subscribers (active and lapsed) with join date, unsubscribe date, and source stream — ready for GDPR data requests or external CRMs.
            Every email sent via the broadcast tool automatically includes a one-click unsubscribe footer.
          </p>
        </div>
      </div>

      {/* ─── Composer dialog ────────────────────────────────────── */}
      <ComposerDialog
        recipientCount={active.length}
        hostName={hostName}
        open={composerOpen}
        onOpenChange={setComposerOpen}
        onSent={handleRefresh}
      />
    </div>
  );
}
