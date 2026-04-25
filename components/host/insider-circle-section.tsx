"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Sparkles,
  Mail,
  Search,
  Send,
  Eye,
  Code2,
  Wand2,
  Loader2,
  Bold,
  Italic,
  Link as LinkIcon,
  Heading2,
  List,
  Quote,
  RefreshCw,
  Users,
  CheckCircle2,
  AlertTriangle,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";

/**
 * Insider Circle dashboard section.
 *
 * Lives below the streams grid in the host dashboard. Lets the host:
 *   - See the size of their list and a clean list of who's on it.
 *   - Filter by email substring.
 *   - Compose a rich-HTML broadcast and send it to all active subscribers.
 *
 * The composer is dependency-light: a contentEditable visual editor with
 * a small toolbar (B / I / H2 / Link / List / Quote), plus an HTML mode
 * (textarea) and a Preview tab that renders the current value back into
 * a styled card. Server-side sanitization is the source of truth — this
 * editor doesn't try to be a content firewall.
 */

interface Subscriber {
  id: string;
  email: string;
  source_room_code: string | null;
  is_active: boolean;
  created_at: string;
  unsubscribed_at: string | null;
}

interface Props {
  /** The host's display name, used in the empty-state copy. */
  hostName: string;
}

export function InsiderCircleSection({ hostName }: Props) {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [subscribers, setSubscribers] = useState<Subscriber[]>([]);
  const [filter, setFilter] = useState("");
  const [composerOpen, setComposerOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    try {
      const res = await fetch("/api/insider/subscribers", { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) {
        setError(json?.error || "Couldn't load subscribers.");
        return;
      }
      setError(null);
      setSubscribers(json.subscribers ?? []);
    } catch {
      setError("Network error loading subscribers.");
    }
  };

  useEffect(() => {
    (async () => {
      setLoading(true);
      await load();
      setLoading(false);
    })();
  }, []);

  const handleRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const active = useMemo(
    () => subscribers.filter((s) => s.is_active),
    [subscribers],
  );
  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return subscribers;
    return subscribers.filter((s) => s.email.toLowerCase().includes(q));
  }, [subscribers, filter]);

  return (
    <section className="mt-10">
      {/* Section header */}
      <div className="flex items-end justify-between gap-3 mb-4 flex-wrap">
        <div>
          <div className="text-[11px] uppercase tracking-[0.14em] font-semibold text-muted-foreground">
            Audience
          </div>
          <h2 className="text-xl font-semibold text-foreground mt-0.5">
            Insider Circle
          </h2>
          <p className="text-sm text-muted-foreground">
            Your private list of viewers who want updates straight from you.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={handleRefresh} disabled={refreshing}>
            <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${refreshing ? "animate-spin" : ""}`} />
            Refresh
          </Button>
          <Dialog open={composerOpen} onOpenChange={setComposerOpen}>
            <DialogTrigger asChild>
              <Button size="sm" className="gap-1.5" disabled={active.length === 0}>
                <Send className="w-3.5 h-3.5" />
                Compose broadcast
              </Button>
            </DialogTrigger>
            <ComposerDialog
              recipientCount={active.length}
              hostName={hostName}
              onSent={() => {
                setComposerOpen(false);
                handleRefresh();
              }}
            />
          </Dialog>
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
        <StatCard
          icon={<Users className="w-4 h-4 text-primary" />}
          label="Active subscribers"
          value={active.length}
          tone="primary"
        />
        <StatCard
          icon={<Mail className="w-4 h-4 text-foreground" />}
          label="Total ever joined"
          value={subscribers.length}
        />
        <StatCard
          icon={<CheckCircle2 className="w-4 h-4 text-green-600" />}
          label="Unsubscribed"
          value={subscribers.length - active.length}
        />
      </div>

      {/* Subscriber list card */}
      <Card>
        <CardHeader className="pb-3 border-b">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-8 h-8 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
                <Sparkles className="w-4 h-4 text-primary" />
              </div>
              <div className="min-w-0">
                <CardTitle className="text-sm font-semibold">Subscribers</CardTitle>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  Viewers who joined from your live stream pages.
                </p>
              </div>
            </div>
            <div className="relative flex-1 max-w-xs min-w-[180px]">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
              <Input
                placeholder="Search email…"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                className="pl-8 h-8 text-sm"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
              <Loader2 className="w-5 h-5 animate-spin mx-auto mb-2" />
              Loading your list…
            </div>
          ) : error ? (
            <div className="py-10 px-6 text-center text-sm">
              <AlertTriangle className="w-5 h-5 text-amber-500 mx-auto mb-2" />
              <p className="text-foreground">{error}</p>
            </div>
          ) : subscribers.length === 0 ? (
            <EmptyState />
          ) : filtered.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">
              No matches for &quot;{filter}&quot;.
            </div>
          ) : (
            <ScrollArea className="max-h-[420px]">
              <ul className="divide-y divide-border">
                {filtered.map((s) => (
                  <li key={s.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="truncate font-mono text-[13px] text-foreground">
                          {s.email}
                        </span>
                        {!s.is_active && (
                          <Badge variant="outline" className="text-[10px] h-4 px-1.5 border-muted-foreground/40">
                            unsubscribed
                          </Badge>
                        )}
                      </div>
                      <div className="text-[11px] text-muted-foreground mt-0.5 flex items-center gap-2 flex-wrap">
                        <span>Joined {formatDate(s.created_at)}</span>
                        {s.source_room_code && (
                          <>
                            <span>·</span>
                            <span>
                              From <code className="font-mono">{s.source_room_code}</code>
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </ScrollArea>
          )}
        </CardContent>
      </Card>
    </section>
  );
}

function StatCard({
  icon,
  label,
  value,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  tone?: "primary";
}) {
  return (
    <Card className={tone === "primary" ? "border-primary/30 bg-primary/5" : undefined}>
      <CardContent className="p-4">
        <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-muted-foreground font-medium">
          {icon}
          <span>{label}</span>
        </div>
        <div className="text-2xl font-semibold text-foreground mt-1.5 tabular-nums">
          {value.toLocaleString()}
        </div>
      </CardContent>
    </Card>
  );
}

function EmptyState() {
  return (
    <div className="py-12 px-6 text-center">
      <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4">
        <Sparkles className="w-5 h-5 text-primary" />
      </div>
      <h3 className="text-sm font-semibold text-foreground">
        No subscribers yet
      </h3>
      <p className="text-[13px] text-muted-foreground mt-1.5 max-w-sm mx-auto">
        A subscribe form appears on every live stream page automatically.
        When viewers join your Insider Circle, they&apos;ll show up here.
      </p>
    </div>
  );
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: d.getFullYear() === new Date().getFullYear() ? undefined : "numeric",
    });
  } catch {
    return "—";
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Composer dialog
// ──────────────────────────────────────────────────────────────────────────

const STARTER_HTML = `<p>Hi there,</p>
<p>Thanks for being part of the Insider Circle. Here&apos;s what&apos;s coming up:</p>
<ul>
  <li>Next live session: <strong>(date / time)</strong></li>
  <li>(Topic or special guest)</li>
</ul>
<p>See you there.</p>`;

function ComposerDialog({
  recipientCount,
  hostName,
  onSent,
}: {
  recipientCount: number;
  hostName: string;
  onSent: () => void;
}) {
  const [subject, setSubject] = useState("");
  const [html, setHtml] = useState(STARTER_HTML);
  const [tab, setTab] = useState<"visual" | "html" | "preview">("visual");
  const [sending, setSending] = useState(false);
  const editorRef = useRef<HTMLDivElement | null>(null);

  // Sync the visual editor's contentEditable with `html` only when the
  // editor is mounted and the user is NOT actively typing into it. The
  // refs flag avoids cursor jumps mid-keystroke.
  const visualMountedRef = useRef(false);
  useEffect(() => {
    if (tab !== "visual") return;
    const el = editorRef.current;
    if (!el) return;
    if (!visualMountedRef.current) {
      el.innerHTML = html;
      visualMountedRef.current = true;
    }
  }, [tab, html]);

  // When the user switches tabs, capture the latest content from the
  // active editor into `html` so the other tabs see it.
  const captureFromVisual = () => {
    if (editorRef.current) {
      setHtml(editorRef.current.innerHTML);
    }
  };

  const exec = (cmd: string, arg?: string) => {
    // execCommand is deprecated but still implemented in every major
    // browser, including Safari. For an internal-tools rich editor it
    // remains the smallest-footprint correct choice.
    document.execCommand(cmd, false, arg);
    captureFromVisual();
    editorRef.current?.focus();
  };

  const handleLink = () => {
    const url = window.prompt("Link URL (https://…):", "https://");
    if (!url) return;
    exec("createLink", url);
  };

  const handleSend = async () => {
    if (!subject.trim()) {
      toast.error("Please enter a subject.");
      return;
    }
    // Pull latest HTML from whichever editor is active.
    const finalHtml = tab === "visual" && editorRef.current ? editorRef.current.innerHTML : html;
    if (finalHtml.trim().length < 10) {
      toast.error("Message body is empty.");
      return;
    }

    setSending(true);
    try {
      const res = await fetch("/api/insider/broadcast", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subject: subject.trim(), html_body: finalHtml }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(json?.error || "Couldn't send the broadcast.");
        return;
      }
      const sent = json.sent_count ?? 0;
      const failed = json.failed_count ?? 0;
      if (failed === 0) {
        toast.success(`Sent to ${sent} subscriber${sent === 1 ? "" : "s"}.`);
      } else {
        toast.warning(`Sent ${sent}, failed ${failed}. Check the logs.`);
      }
      onSent();
    } catch {
      toast.error("Network error. Please try again.");
    } finally {
      setSending(false);
    }
  };

  return (
    <DialogContent className="max-w-3xl">
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-primary" />
          Compose Insider Circle update
        </DialogTitle>
        <DialogDescription>
          Will send to <strong>{recipientCount.toLocaleString()}</strong> active
          subscriber{recipientCount === 1 ? "" : "s"}. Every email gets a
          one-click unsubscribe footer automatically.
        </DialogDescription>
      </DialogHeader>

      <div className="flex flex-col gap-4">
        {/* Subject */}
        <div className="flex flex-col gap-1.5">
          <label className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">
            Subject
          </label>
          <Input
            placeholder="A short, inviting line — what will subscribers see in their inbox?"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            maxLength={200}
          />
        </div>

        {/* Editor tabs */}
        <Tabs
          value={tab}
          onValueChange={(v) => {
            // Capture from current editor before switching tabs.
            if (tab === "visual") captureFromVisual();
            visualMountedRef.current = false; // allow re-sync on next mount
            setTab(v as typeof tab);
          }}
          className="flex flex-col gap-2"
        >
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <TabsList className="grid grid-cols-3 w-full max-w-xs">
              <TabsTrigger value="visual" className="text-xs gap-1">
                <Wand2 className="w-3 h-3" />
                Visual
              </TabsTrigger>
              <TabsTrigger value="html" className="text-xs gap-1">
                <Code2 className="w-3 h-3" />
                HTML
              </TabsTrigger>
              <TabsTrigger value="preview" className="text-xs gap-1">
                <Eye className="w-3 h-3" />
                Preview
              </TabsTrigger>
            </TabsList>
            {tab === "visual" && (
              <div className="flex items-center gap-1">
                <ToolbarButton onClick={() => exec("bold")} label="Bold">
                  <Bold className="w-3.5 h-3.5" />
                </ToolbarButton>
                <ToolbarButton onClick={() => exec("italic")} label="Italic">
                  <Italic className="w-3.5 h-3.5" />
                </ToolbarButton>
                <ToolbarButton onClick={() => exec("formatBlock", "<h2>")} label="Heading">
                  <Heading2 className="w-3.5 h-3.5" />
                </ToolbarButton>
                <ToolbarButton onClick={() => exec("insertUnorderedList")} label="List">
                  <List className="w-3.5 h-3.5" />
                </ToolbarButton>
                <ToolbarButton onClick={() => exec("formatBlock", "<blockquote>")} label="Quote">
                  <Quote className="w-3.5 h-3.5" />
                </ToolbarButton>
                <ToolbarButton onClick={handleLink} label="Link">
                  <LinkIcon className="w-3.5 h-3.5" />
                </ToolbarButton>
              </div>
            )}
          </div>

          <TabsContent value="visual" className="mt-0">
            <div
              ref={editorRef}
              contentEditable
              suppressContentEditableWarning
              onInput={captureFromVisual}
              className="min-h-[260px] max-h-[420px] overflow-y-auto rounded-md border border-input bg-background px-4 py-3 text-sm leading-relaxed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&_h2]:text-base [&_h2]:font-semibold [&_h2]:mt-3 [&_h2]:mb-1.5 [&_p]:my-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_blockquote]:border-l-2 [&_blockquote]:border-muted-foreground/30 [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground [&_a]:text-primary [&_a]:underline"
            />
          </TabsContent>

          <TabsContent value="html" className="mt-0">
            <textarea
              value={html}
              onChange={(e) => setHtml(e.target.value)}
              spellCheck={false}
              className="w-full min-h-[260px] max-h-[420px] rounded-md border border-input bg-background px-3 py-2 font-mono text-xs leading-relaxed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <p className="text-[11px] text-muted-foreground mt-1.5">
              Server sanitizes this on send. Disallowed tags (<code>script</code>,{" "}
              <code>iframe</code>, event handlers) are stripped. Inline styles
              are kept for email-client compatibility.
            </p>
          </TabsContent>

          <TabsContent value="preview" className="mt-0">
            <div className="rounded-md border border-border bg-[#f4f4f5] p-4 sm:p-6">
              <div className="bg-white rounded-lg shadow-sm max-w-[600px] mx-auto overflow-hidden">
                <div className="px-6 py-4 border-b border-border">
                  <div className="text-[10px] uppercase tracking-[0.14em] font-semibold text-muted-foreground">
                    Insider Circle
                  </div>
                  <div className="text-base font-semibold mt-0.5">{hostName}</div>
                </div>
                <div
                  className="px-6 py-5 text-sm leading-relaxed text-foreground/90 [&_h2]:text-base [&_h2]:font-semibold [&_h2]:mt-3 [&_h2]:mb-1.5 [&_p]:my-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_blockquote]:border-l-2 [&_blockquote]:border-muted-foreground/30 [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground [&_a]:text-primary [&_a]:underline"
                  dangerouslySetInnerHTML={{ __html: html }}
                />
                <div className="px-6 py-4 border-t border-border text-[11px] text-muted-foreground">
                  You&apos;re getting this because you joined {hostName}&apos;s
                  Insider Circle. <span className="underline">Unsubscribe instantly</span>
                </div>
              </div>
            </div>
            <p className="text-[11px] text-muted-foreground mt-2">
              This is a preview of the unsanitized draft. Final email content is
              re-sanitized server-side just before send.
            </p>
          </TabsContent>
        </Tabs>
      </div>

      <DialogFooter>
        <Button variant="ghost" onClick={() => onSent()} disabled={sending}>
          Cancel
        </Button>
        <Button onClick={handleSend} disabled={sending || !subject.trim()} className="gap-1.5">
          {sending ? (
            <>
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              Sending…
            </>
          ) : (
            <>
              <Send className="w-3.5 h-3.5" />
              Send to {recipientCount.toLocaleString()}{" "}
              {recipientCount === 1 ? "subscriber" : "subscribers"}
            </>
          )}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

function ToolbarButton({
  onClick,
  label,
  children,
}: {
  onClick: () => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className="h-7 w-7 rounded-md border border-border bg-background hover:bg-muted text-foreground flex items-center justify-center transition-colors"
    >
      {children}
    </button>
  );
}
