"use client";

import { useState, useTransition } from "react";
import {
  Zap,
  ListChecks,
  BarChart2,
  Video,
  CircleDollarSign,
  Plus,
  Trash2,
  AlertCircle,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Switch } from "@/components/ui/switch";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

// ── Types ─────────────────────────────────────────────────────────────────

type RuleType =
  | "daily_content_ideas"
  | "weekly_summary"
  | "post_stream_recap"
  | "affiliate_campaign";

export interface AutomationRule {
  id: string;
  rule_type: RuleType;
  label: string;
  enabled: boolean;
  schedule: string;
  config: Record<string, string>;
  last_run_at: string | null;
  next_run_at: string | null;
  run_count: number;
  created_at: string;
}

// ── Rule type metadata ────────────────────────────────────────────────────

const RULE_META: Record<
  RuleType,
  {
    label: string;
    description: string;
    icon: LucideIcon;
    scheduleLabel: string;
    color: string;
    configFields: Array<"niche" | "platform" | "tone" | "product_name" | "product_description">;
  }
> = {
  daily_content_ideas: {
    label: "Daily Content Ideas",
    description: "5 fresh ideas in your niche, every morning",
    icon: ListChecks,
    scheduleLabel: "Daily",
    color: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
    configFields: ["niche", "platform", "tone"],
  },
  weekly_summary: {
    label: "Weekly Performance Summary",
    description: "AI narrative of your last 7 days' stream performance",
    icon: BarChart2,
    scheduleLabel: "Weekly",
    color: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
    configFields: [],
  },
  post_stream_recap: {
    label: "Post-Stream Recap",
    description: "Auto recap and repurposing plan after each live ends",
    icon: Video,
    scheduleLabel: "After each live",
    color: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
    configFields: [],
  },
  affiliate_campaign: {
    label: "Affiliate Campaign Copy",
    description: "Weekly campaign copy for a configured product",
    icon: CircleDollarSign,
    scheduleLabel: "Weekly",
    color: "bg-violet-500/10 text-violet-600 dark:text-violet-400",
    configFields: ["product_name", "product_description", "niche", "tone"],
  },
};

const PLATFORMS = ["youtube", "tiktok", "instagram", "twitter", "generic"] as const;
const TONES = ["casual", "professional", "energetic", "inspirational"] as const;

// ── Helpers ───────────────────────────────────────────────────────────────

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return "Never";
  const diff = Date.now() - new Date(dateStr).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return "Just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function configSummary(rule: AutomationRule): string {
  const c = rule.config;
  const parts: string[] = [];
  if (c.niche) parts.push(c.niche);
  if (c.platform && c.platform !== "generic") parts.push(c.platform);
  if (c.tone) parts.push(c.tone);
  if (c.product_name) parts.push(c.product_name);
  return parts.join(" · ");
}

// ── Main component ────────────────────────────────────────────────────────

interface RulesManagerProps {
  initialRules: AutomationRule[];
}

export function RulesManager({ initialRules }: RulesManagerProps) {
  const [rules, setRules] = useState<AutomationRule[]>(initialRules);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  const handleToggle = (id: string, enabled: boolean) => {
    setRules((prev) => prev.map((r) => (r.id === id ? { ...r, enabled } : r)));
    startTransition(async () => {
      const res = await fetch(`/api/ai/rules/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      if (!res.ok) {
        setRules((prev) => prev.map((r) => (r.id === id ? { ...r, enabled: !enabled } : r)));
        toast.error("Failed to update rule");
      }
    });
  };

  const handleDelete = (id: string) => {
    startTransition(async () => {
      const res = await fetch(`/api/ai/rules/${id}`, { method: "DELETE" });
      if (res.ok) {
        setRules((prev) => prev.filter((r) => r.id !== id));
        toast.success("Rule deleted");
      } else {
        toast.error("Failed to delete rule");
      }
    });
  };

  const handleCreate = (rule: AutomationRule) => {
    setRules((prev) => [...prev, rule]);
    setDialogOpen(false);
    toast.success("Automation rule created");
  };

  const activeCount = rules.filter((r) => r.enabled).length;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h2 className="text-base font-semibold">Automation Rules</h2>
          {rules.length > 0 && (
            <Badge variant="secondary" className="text-[10px] h-4 px-1.5">
              {activeCount}/{rules.length} active
            </Badge>
          )}
        </div>
        <Button
          size="sm"
          variant="outline"
          className="h-8 gap-1.5"
          onClick={() => setDialogOpen(true)}
        >
          <Plus className="h-3.5 w-3.5" />
          New rule
        </Button>
      </div>

      {/* Rule list */}
      {rules.length === 0 ? (
        <EmptyState onAdd={() => setDialogOpen(true)} />
      ) : (
        <div className="space-y-2">
          {rules.map((rule) => (
            <RuleRow
              key={rule.id}
              rule={rule}
              onToggle={handleToggle}
              onDelete={handleDelete}
              disabled={isPending}
            />
          ))}
        </div>
      )}

      {/* Create dialog */}
      <CreateRuleDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onCreate={handleCreate}
      />
    </div>
  );
}

// ── RuleRow ───────────────────────────────────────────────────────────────

function RuleRow({
  rule,
  onToggle,
  onDelete,
  disabled,
}: {
  rule: AutomationRule;
  onToggle: (id: string, enabled: boolean) => void;
  onDelete: (id: string) => void;
  disabled: boolean;
}) {
  const meta = RULE_META[rule.rule_type];
  const Icon = meta.icon;
  const summary = configSummary(rule);

  return (
    <Card className={cn("transition-opacity", !rule.enabled && "opacity-60")}>
      <CardContent className="flex items-start gap-4 p-4">
        {/* Icon */}
        <div
          className={cn(
            "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg",
            meta.color,
          )}
        >
          <Icon className="h-4 w-4" />
        </div>

        {/* Info */}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-sm font-medium leading-snug">{rule.label}</span>
            <Badge variant="outline" className="h-4 px-1.5 text-[10px] font-normal">
              {meta.scheduleLabel}
            </Badge>
            {!rule.enabled && (
              <Badge variant="secondary" className="h-4 px-1.5 text-[10px] font-normal">
                Paused
              </Badge>
            )}
          </div>
          {summary && (
            <p className="mt-0.5 text-[11px] text-muted-foreground leading-snug">{summary}</p>
          )}
          <p className="mt-1 text-[11px] text-muted-foreground">
            {rule.run_count > 0 ? (
              <>
                {rule.run_count} run{rule.run_count !== 1 ? "s" : ""} ·{" "}
                Last: {timeAgo(rule.last_run_at)}
              </>
            ) : (
              "Not yet run · will fire on next cron cycle"
            )}
          </p>
        </div>

        {/* Actions */}
        <div className="flex shrink-0 items-center gap-2 pl-2">
          <Switch
            checked={rule.enabled}
            onCheckedChange={(v) => onToggle(rule.id, v)}
            disabled={disabled}
            aria-label={rule.enabled ? "Pause rule" : "Enable rule"}
          />
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
                disabled={disabled}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete rule?</AlertDialogTitle>
                <AlertDialogDescription>
                  &ldquo;{rule.label}&rdquo; will be permanently removed. Any already-generated
                  assets will remain in AI Studio.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => onDelete(rule.id)}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  Delete
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Empty state ───────────────────────────────────────────────────────────

function EmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="rounded-xl border border-dashed border-border px-8 py-14 text-center">
      <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-violet-500/10">
        <Zap className="h-5 w-5 text-violet-500" />
      </div>
      <h3 className="text-sm font-semibold">No automation rules yet</h3>
      <p className="mx-auto mt-1.5 max-w-xs text-sm text-muted-foreground">
        Set up recurring AI jobs and put your content on autopilot — ideas,
        summaries, campaign copy, and more.
      </p>
      <Button size="sm" className="mt-5 gap-1.5" onClick={onAdd}>
        <Plus className="h-3.5 w-3.5" />
        Create first rule
      </Button>
    </div>
  );
}

// ── Create dialog ─────────────────────────────────────────────────────────

const DEFAULT_FORM = {
  rule_type: "daily_content_ideas" as RuleType,
  niche: "",
  platform: "generic" as string,
  tone: "casual" as string,
  product_name: "",
  product_description: "",
};

function CreateRuleDialog({
  open,
  onOpenChange,
  onCreate,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCreate: (rule: AutomationRule) => void;
}) {
  const [form, setForm] = useState(DEFAULT_FORM);
  const [saving, setSaving] = useState(false);
  const [fieldError, setFieldError] = useState<string | null>(null);

  const meta = RULE_META[form.rule_type];
  const fields = meta.configFields;

  const handleSubmit = async () => {
    setFieldError(null);
    if (form.rule_type === "affiliate_campaign" && !form.product_name.trim()) {
      setFieldError("Product name is required for Affiliate Campaign.");
      return;
    }

    const config: Record<string, string> = {};
    if (fields.includes("niche") && form.niche.trim()) config.niche = form.niche.trim();
    if (fields.includes("platform")) config.platform = form.platform;
    if (fields.includes("tone")) config.tone = form.tone;
    if (fields.includes("product_name") && form.product_name.trim())
      config.product_name = form.product_name.trim();
    if (fields.includes("product_description") && form.product_description.trim())
      config.product_description = form.product_description.trim();

    const label =
      form.rule_type === "affiliate_campaign" && form.product_name.trim()
        ? `Affiliate — ${form.product_name.trim()}`
        : meta.label;

    setSaving(true);
    try {
      const res = await fetch("/api/ai/rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rule_type: form.rule_type, label, config }),
      });
      const json = await res.json();
      if (!res.ok) {
        setFieldError(json.error ?? "Failed to create rule");
        return;
      }
      setForm(DEFAULT_FORM);
      onCreate(json.rule as AutomationRule);
    } catch {
      setFieldError("Network error — please try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!saving) { onOpenChange(v); if (!v) { setForm(DEFAULT_FORM); setFieldError(null); } }
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Zap className="h-4 w-4 text-violet-500" />
            New automation rule
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-5 py-1">
          {/* Type selector */}
          <div className="space-y-2">
            <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Rule type
            </Label>
            <div className="grid gap-2 sm:grid-cols-2">
              {(Object.keys(RULE_META) as RuleType[]).map((type) => {
                const m = RULE_META[type];
                const TypeIcon = m.icon;
                return (
                  <button
                    key={type}
                    type="button"
                    onClick={() => setForm((f) => ({ ...f, rule_type: type }))}
                    className={cn(
                      "flex items-start gap-3 rounded-lg border p-3 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary",
                      form.rule_type === type
                        ? "border-primary bg-primary/5"
                        : "border-border hover:border-muted-foreground/40 hover:bg-muted/40",
                    )}
                  >
                    <div className={cn("mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md", m.color)}>
                      <TypeIcon className="h-3.5 w-3.5" />
                    </div>
                    <div className="min-w-0">
                      <div className="text-sm font-medium leading-snug">{m.label}</div>
                      <div className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
                        {m.description}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Config fields — show only when relevant */}
          {fields.length > 0 && (
            <div className="space-y-3 rounded-lg border border-border/60 bg-muted/30 p-4">
              <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                Configuration
              </p>

              {fields.includes("product_name") && (
                <div className="space-y-1">
                  <Label htmlFor="product_name" className="text-xs">
                    Product name <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    id="product_name"
                    placeholder="e.g. Protein X, VPN Pro, Course Name"
                    value={form.product_name}
                    onChange={(e) => setForm((f) => ({ ...f, product_name: e.target.value }))}
                    className="h-8 text-sm"
                  />
                </div>
              )}

              {fields.includes("product_description") && (
                <div className="space-y-1">
                  <Label htmlFor="product_desc" className="text-xs">
                    Product description <span className="text-muted-foreground">(optional)</span>
                  </Label>
                  <Textarea
                    id="product_desc"
                    placeholder="Brief description to help the AI write better copy"
                    value={form.product_description}
                    onChange={(e) => setForm((f) => ({ ...f, product_description: e.target.value }))}
                    className="min-h-[60px] resize-none text-sm"
                  />
                </div>
              )}

              {fields.includes("niche") && (
                <div className="space-y-1">
                  <Label htmlFor="niche" className="text-xs">
                    Niche / Topic <span className="text-muted-foreground">(optional)</span>
                  </Label>
                  <Input
                    id="niche"
                    placeholder="e.g. fitness, finance, gaming"
                    value={form.niche}
                    onChange={(e) => setForm((f) => ({ ...f, niche: e.target.value }))}
                    className="h-8 text-sm"
                  />
                </div>
              )}

              {fields.includes("platform") && (
                <div className="space-y-1">
                  <Label className="text-xs">Target platform</Label>
                  <Select
                    value={form.platform}
                    onValueChange={(v) => setForm((f) => ({ ...f, platform: v }))}
                  >
                    <SelectTrigger className="h-8 text-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {PLATFORMS.map((p) => (
                        <SelectItem key={p} value={p} className="text-sm capitalize">
                          {p === "generic" ? "Generic (any)" : p.charAt(0).toUpperCase() + p.slice(1)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {fields.includes("tone") && (
                <div className="space-y-1">
                  <Label className="text-xs">Tone</Label>
                  <Select
                    value={form.tone}
                    onValueChange={(v) => setForm((f) => ({ ...f, tone: v }))}
                  >
                    <SelectTrigger className="h-8 text-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {TONES.map((t) => (
                        <SelectItem key={t} value={t} className="text-sm capitalize">
                          {t.charAt(0).toUpperCase() + t.slice(1)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
          )}

          {fieldError && (
            <div className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              <AlertCircle className="h-3.5 w-3.5 shrink-0" />
              {fieldError}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button size="sm" onClick={handleSubmit} disabled={saving} className="gap-1.5">
            {saving ? "Creating…" : (
              <><Plus className="h-3.5 w-3.5" />Create rule</>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
