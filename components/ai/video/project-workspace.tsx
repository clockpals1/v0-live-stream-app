"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Clapperboard, ArrowLeft, Check, Pencil, Save, X,
  Send, ChevronRight, Film, Mic, Eye, Cpu, Globe,
  Clock, Camera, AlignLeft, MousePointerClick, Type,
  StickyNote, Copy, RefreshCw, Loader2, BadgeCheck,
  CircleDot, Lock, AlertCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDistanceToNow } from "date-fns";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface VideoScene {
  id: string;
  order: number;
  duration: number;
  type: "hook" | "setup" | "main" | "cta" | "outro";
  script: string;
  visual_prompt: string;
  shot_type: "close-up" | "mid-shot" | "wide";
  on_screen_text: string;
  notes: string;
}

export interface VideoProject {
  id: string;
  title: string;
  platform: string;
  video_length: string;
  status: string;
  hook: string | null;
  concept: string | null;
  script_body: string | null;
  cta: string | null;
  caption: string | null;
  scenes: VideoScene[];
  voiceover_status: string;
  render_status: string;
  preview_url: string | null;
  render_url: string | null;
  publish_queue_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const STATUS_META: Record<string, { label: string; color: string; bg: string }> = {
  script_ready:      { label: "Script Ready",       color: "text-emerald-700 dark:text-emerald-300", bg: "bg-emerald-500/15" },
  scenes_generated:  { label: "Scenes Set",         color: "text-sky-700 dark:text-sky-300",         bg: "bg-sky-500/15" },
  visuals_pending:   { label: "Visuals Pending",    color: "text-amber-700 dark:text-amber-300",     bg: "bg-amber-500/15" },
  voiceover_pending: { label: "Voiceover Pending",  color: "text-orange-700 dark:text-orange-300",   bg: "bg-orange-500/15" },
  preview_ready:     { label: "Preview Ready",      color: "text-violet-700 dark:text-violet-300",   bg: "bg-violet-500/15" },
  rendering:         { label: "Rendering",          color: "text-blue-700 dark:text-blue-300",       bg: "bg-blue-500/15" },
  published:         { label: "Published",          color: "text-emerald-700 dark:text-emerald-300", bg: "bg-emerald-500/20" },
};

const PLATFORM_LABELS: Record<string, string> = {
  tiktok: "TikTok", instagram: "Instagram", youtube: "YouTube Shorts",
  twitter: "Twitter/X", linkedin: "LinkedIn", generic: "Multi-platform",
};

const SCENE_TYPE_COLORS: Record<string, string> = {
  hook:   "border-rose-500/30 bg-rose-500/5",
  setup:  "border-amber-500/30 bg-amber-500/5",
  main:   "border-sky-500/30 bg-sky-500/5",
  cta:    "border-violet-500/30 bg-violet-500/5",
  outro:  "border-slate-500/30 bg-slate-500/5",
};

const SCENE_TYPE_LABELS: Record<string, string> = {
  hook: "Hook", setup: "Setup", main: "Main", cta: "CTA", outro: "Outro",
};

function cn(...cls: (string | boolean | undefined)[]) {
  return cls.filter(Boolean).join(" ");
}

// ─── Editable field ───────────────────────────────────────────────────────────

function EditableField({
  label,
  icon: Icon,
  value,
  multiline = false,
  onSave,
}: {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  value: string;
  multiline?: boolean;
  onSave: (v: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    await onSave(draft);
    setSaving(false);
    setEditing(false);
  };

  const handleCopy = async () => {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="rounded-lg border border-border bg-background/60 p-3.5">
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          <Icon className="h-3.5 w-3.5" />
          {label}
        </div>
        {!editing && (
          <div className="flex items-center gap-0.5">
            <button
              type="button"
              onClick={handleCopy}
              className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
              title="Copy"
            >
              {copied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
            </button>
            <button
              type="button"
              onClick={() => { setDraft(value); setEditing(true); }}
              className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
              title="Edit"
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </div>
      {editing ? (
        <div className="space-y-2">
          {multiline ? (
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={5}
              className="w-full resize-none rounded-md border border-primary/30 bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
              autoFocus
            />
          ) : (
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              className="w-full rounded-md border border-primary/30 bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
              autoFocus
            />
          )}
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-1 rounded-md bg-primary px-2.5 py-1 text-[11px] font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
            >
              {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
              Save
            </button>
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-[11px] text-muted-foreground hover:bg-muted"
            >
              <X className="h-3 w-3" />
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <p className="text-sm leading-relaxed whitespace-pre-wrap">
          {value || <span className="italic text-muted-foreground/60">Not set</span>}
        </p>
      )}
    </div>
  );
}

// ─── Scene card ───────────────────────────────────────────────────────────────

function SceneCard({
  scene,
  onUpdate,
}: {
  scene: VideoScene;
  onUpdate: (updated: VideoScene) => Promise<void>;
}) {
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(scene);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    await onUpdate(draft);
    setSaving(false);
    setEditing(false);
  };

  return (
    <div className={cn("rounded-lg border p-3.5 transition-colors", SCENE_TYPE_COLORS[scene.type])}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-background/80 text-xs font-bold text-foreground border border-border">
            {scene.order}
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5 mb-1">
              <span className="text-[11px] font-semibold uppercase tracking-wider">
                {SCENE_TYPE_LABELS[scene.type]}
              </span>
              <span className="flex items-center gap-0.5 rounded-full bg-background/80 border border-border/60 px-1.5 py-0.5 text-[10px] text-muted-foreground">
                <Clock className="h-2.5 w-2.5" />
                {scene.duration}s
              </span>
              <span className="flex items-center gap-0.5 rounded-full bg-background/80 border border-border/60 px-1.5 py-0.5 text-[10px] text-muted-foreground">
                <Camera className="h-2.5 w-2.5" />
                {scene.shot_type}
              </span>
            </div>
            <p className="text-sm text-foreground leading-snug line-clamp-2">
              {scene.script}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          <button
            type="button"
            onClick={() => setExpanded(!expanded)}
            className="rounded p-1 text-muted-foreground hover:bg-background/80 hover:text-foreground transition-colors"
            title={expanded ? "Collapse" : "Expand"}
          >
            <ChevronRight className={cn("h-3.5 w-3.5 transition-transform", expanded && "rotate-90")} />
          </button>
          {!editing && (
            <button
              type="button"
              onClick={() => { setDraft(scene); setEditing(true); setExpanded(true); }}
              className="rounded p-1 text-muted-foreground hover:bg-background/80 hover:text-foreground transition-colors"
              title="Edit scene"
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      {expanded && !editing && (
        <div className="mt-3 space-y-2.5 border-t border-border/40 pt-3">
          {scene.visual_prompt && (
            <div>
              <div className="mb-0.5 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                <Film className="h-3 w-3" />
                Visual Direction
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed">{scene.visual_prompt}</p>
            </div>
          )}
          {scene.on_screen_text && (
            <div>
              <div className="mb-0.5 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                <Type className="h-3 w-3" />
                On-Screen Text
              </div>
              <p className="text-xs text-muted-foreground">{scene.on_screen_text}</p>
            </div>
          )}
          {scene.notes && (
            <div>
              <div className="mb-0.5 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                <StickyNote className="h-3 w-3" />
                Notes
              </div>
              <p className="text-xs text-muted-foreground">{scene.notes}</p>
            </div>
          )}
        </div>
      )}

      {editing && (
        <div className="mt-3 space-y-3 border-t border-border/40 pt-3">
          <div>
            <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Script</label>
            <textarea value={draft.script} onChange={(e) => setDraft({ ...draft, script: e.target.value })}
              rows={3} className="w-full resize-none rounded-md border border-border bg-background px-2.5 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary/30" />
          </div>
          <div>
            <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Visual Direction</label>
            <textarea value={draft.visual_prompt} onChange={(e) => setDraft({ ...draft, visual_prompt: e.target.value })}
              rows={2} className="w-full resize-none rounded-md border border-border bg-background px-2.5 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-primary/30" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">On-Screen Text</label>
              <input value={draft.on_screen_text} onChange={(e) => setDraft({ ...draft, on_screen_text: e.target.value })}
                className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-primary/30" />
            </div>
            <div>
              <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Duration (s)</label>
              <input type="number" value={draft.duration} onChange={(e) => setDraft({ ...draft, duration: Number(e.target.value) })}
                className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-primary/30" />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Notes</label>
            <input value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
              className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-primary/30" />
          </div>
          <div className="flex items-center gap-1.5">
            <button type="button" onClick={handleSave} disabled={saving}
              className="flex items-center gap-1 rounded-md bg-primary px-2.5 py-1 text-[11px] font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60">
              {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
              Save
            </button>
            <button type="button" onClick={() => setEditing(false)}
              className="flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-[11px] text-muted-foreground hover:bg-muted">
              <X className="h-3 w-3" />
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Pipeline step ────────────────────────────────────────────────────────────

function PipelineStep({
  step,
  label,
  sublabel,
  state,
  icon: Icon,
  action,
  actionLabel,
  onAction,
  acting,
}: {
  step: number;
  label: string;
  sublabel: string;
  state: "done" | "active" | "locked" | "loading";
  icon: React.ComponentType<{ className?: string }>;
  action?: boolean;
  actionLabel?: string;
  onAction?: () => void;
  acting?: boolean;
}) {
  return (
    <div className={cn(
      "flex items-start gap-3 rounded-lg border p-3 transition-colors",
      state === "done"   ? "border-emerald-500/30 bg-emerald-500/5" :
      state === "active" ? "border-primary/30 bg-primary/5" :
      state === "loading" ? "border-primary/20 bg-primary/5" :
      "border-border/50 bg-muted/10 opacity-60",
    )}>
      <div className={cn(
        "flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-xs font-bold",
        state === "done"   ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-600" :
        state === "active" ? "border-primary/50 bg-primary/10 text-primary" :
        state === "loading" ? "border-primary/30 bg-primary/5 text-primary" :
        "border-border/50 bg-muted/30 text-muted-foreground",
      )}>
        {state === "done" ? (
          <Check className="h-3.5 w-3.5" />
        ) : state === "locked" ? (
          <Lock className="h-3 w-3" />
        ) : state === "loading" ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Icon className="h-3.5 w-3.5" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-sm font-medium leading-snug">{label}</p>
            <p className="mt-0.5 text-[11px] text-muted-foreground leading-snug">{sublabel}</p>
          </div>
          {action && state === "active" && (
            <button
              type="button"
              onClick={onAction}
              disabled={acting}
              className="shrink-0 flex items-center gap-1 rounded-md bg-primary px-2.5 py-1 text-[11px] font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
            >
              {acting ? <Loader2 className="h-3 w-3 animate-spin" /> : <ChevronRight className="h-3 w-3" />}
              {actionLabel}
            </button>
          )}
          {state === "locked" && (
            <span className="shrink-0 rounded-full border border-border/40 bg-muted/30 px-1.5 py-0.5 text-[9px] font-medium text-muted-foreground uppercase tracking-wider">
              Soon
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Main workspace ────────────────────────────────────────────────────────────

export function ProjectWorkspace({ project: initial }: { project: VideoProject }) {
  const router = useRouter();
  const [project, setProject] = useState<VideoProject>(initial);
  const [publishing, setPublishing] = useState(false);
  const [confirmingScenes, setConfirmingScenes] = useState(false);

  const save = useCallback(async (updates: Partial<VideoProject>) => {
    const res = await fetch(`/api/ai/video/${project.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updates),
    });
    if (!res.ok) {
      const { error } = await res.json();
      toast.error(error || "Save failed");
      return;
    }
    const { project: updated } = await res.json();
    setProject(updated);
  }, [project.id]);

  const handleFieldSave = useCallback(
    (field: keyof VideoProject) => async (value: string) => {
      await save({ [field]: value });
      toast.success("Saved");
    },
    [save],
  );

  const handleSceneUpdate = useCallback(
    async (updated: VideoScene) => {
      const newScenes = project.scenes.map((s) => (s.id === updated.id ? updated : s));
      await save({ scenes: newScenes });
      toast.success("Scene saved");
    },
    [project.scenes, save],
  );

  const handleConfirmScenes = async () => {
    setConfirmingScenes(true);
    await save({ status: "scenes_generated" });
    toast.success("Scenes confirmed — your storyboard is locked in");
    setConfirmingScenes(false);
  };

  const handlePublish = async () => {
    setPublishing(true);
    try {
      const res = await fetch("/api/ai/publish/queue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          platform: project.platform === "generic" ? "youtube" : project.platform,
          title: project.title,
          body: project.caption ?? project.cta ?? "",
          platform_meta: {
            title: project.title,
            description: [project.concept, project.script_body].filter(Boolean).join("\n\n"),
          },
          asset_id: null,
        }),
      });
      if (!res.ok) {
        const { error } = await res.json();
        toast.error(error || "Failed to add to queue");
        return;
      }
      const { item } = await res.json();
      await save({ status: "published", publish_queue_id: item?.id ?? null });
      toast.success("Added to publish queue — go to Publishing Hub to schedule");
    } finally {
      setPublishing(false);
    }
  };

  const statusMeta = STATUS_META[project.status] ?? STATUS_META.script_ready;
  const platformLabel = PLATFORM_LABELS[project.platform] ?? project.platform;
  const ago = formatDistanceToNow(new Date(project.created_at), { addSuffix: true });

  const isScenesDone = project.status !== "script_ready";
  const isPublished  = project.status === "published";

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-8">

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="mb-6">
        <button
          type="button"
          onClick={() => router.push("/ai")}
          className="mb-4 flex items-center gap-1.5 text-[12px] text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to Studio
        </button>

        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-violet-600 to-fuchsia-500 text-white shadow-sm">
              <Clapperboard className="h-5 w-5" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-lg font-semibold leading-tight">{project.title}</h1>
                <span className={cn(
                  "rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider",
                  statusMeta.color, statusMeta.bg,
                )}>
                  {statusMeta.label}
                </span>
              </div>
              <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                <span className="flex items-center gap-1">
                  <Globe className="h-3 w-3" />
                  {platformLabel}
                </span>
                <span>·</span>
                <span className="flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  {project.video_length}s video
                </span>
                <span>·</span>
                <span>Created {ago}</span>
              </div>
            </div>
          </div>

          {!isPublished && (
            <Button
              size="sm"
              className="gap-2"
              onClick={handlePublish}
              disabled={publishing}
            >
              {publishing
                ? <><Loader2 className="h-3.5 w-3.5 animate-spin" />Adding to queue…</>
                : <><Send className="h-3.5 w-3.5" />Publish</>
              }
            </Button>
          )}
          {isPublished && (
            <Badge className="border-0 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300">
              <BadgeCheck className="mr-1 h-3.5 w-3.5" />
              In Publish Queue
            </Badge>
          )}
        </div>
      </div>

      {/* ── Two-column workspace ─────────────────────────────────────── */}
      <div className="grid gap-6 lg:grid-cols-5">

        {/* Left: Script + Scenes ─────────────────────────────────────── */}
        <div className="space-y-6 lg:col-span-3">

          {/* Script panel */}
          <section>
            <div className="mb-3 flex items-center gap-2">
              <AlignLeft className="h-4 w-4 text-muted-foreground" />
              <h2 className="text-sm font-semibold">Script</h2>
              <span className="text-[11px] text-muted-foreground">Click the pencil icon on any field to edit</span>
            </div>
            <div className="space-y-2.5">
              <EditableField
                label="Hook" icon={MousePointerClick}
                value={project.hook ?? ""}
                onSave={handleFieldSave("hook")}
              />
              <EditableField
                label="Concept" icon={CircleDot}
                value={project.concept ?? ""}
                onSave={handleFieldSave("concept")}
              />
              <EditableField
                label="Script Body" icon={AlignLeft}
                value={project.script_body ?? ""}
                multiline
                onSave={handleFieldSave("script_body")}
              />
              <EditableField
                label="CTA" icon={MousePointerClick}
                value={project.cta ?? ""}
                onSave={handleFieldSave("cta")}
              />
              <EditableField
                label="Caption" icon={Type}
                value={project.caption ?? ""}
                onSave={handleFieldSave("caption")}
              />
            </div>
          </section>

          {/* Scenes panel */}
          <section>
            <div className="mb-3 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Film className="h-4 w-4 text-muted-foreground" />
                <h2 className="text-sm font-semibold">Scene Breakdown</h2>
                <Badge variant="outline" className="h-5 px-1.5 text-[10px]">
                  {project.scenes.length} scenes · {project.video_length}s total
                </Badge>
              </div>
              {!isScenesDone && project.scenes.length > 0 && (
                <button
                  type="button"
                  onClick={handleConfirmScenes}
                  disabled={confirmingScenes}
                  className="flex items-center gap-1 rounded-md bg-sky-600 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-sky-700 disabled:opacity-60"
                >
                  {confirmingScenes
                    ? <Loader2 className="h-3 w-3 animate-spin" />
                    : <Check className="h-3 w-3" />}
                  Confirm Scenes
                </button>
              )}
              {isScenesDone && (
                <span className="flex items-center gap-1 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
                  <Check className="h-3 w-3" />
                  Scenes confirmed
                </span>
              )}
            </div>

            {project.scenes.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border/60 px-4 py-8 text-center">
                <Film className="mx-auto mb-2 h-6 w-6 text-muted-foreground/40" />
                <p className="text-sm text-muted-foreground">No scenes yet</p>
                <p className="text-xs text-muted-foreground/60">Scenes are auto-generated when the script is created</p>
              </div>
            ) : (
              <div className="space-y-2">
                {project.scenes
                  .slice()
                  .sort((a, b) => a.order - b.order)
                  .map((scene) => (
                    <SceneCard key={scene.id} scene={scene} onUpdate={handleSceneUpdate} />
                  ))}
              </div>
            )}
          </section>
        </div>

        {/* Right: Production Pipeline ─────────────────────────────────── */}
        <div className="lg:col-span-2">
          <div className="sticky top-6 space-y-3">
            <div className="mb-3 flex items-center gap-2">
              <Cpu className="h-4 w-4 text-muted-foreground" />
              <h2 className="text-sm font-semibold">Production Pipeline</h2>
            </div>

            <PipelineStep
              step={1}
              label="Script Ready"
              sublabel="Hook, concept, script, CTA & caption generated"
              state="done"
              icon={AlignLeft}
            />

            <PipelineStep
              step={2}
              label="Scenes"
              sublabel={isScenesDone ? `${project.scenes.length} scenes confirmed` : `${project.scenes.length} scenes ready — review and confirm`}
              state={isScenesDone ? "done" : "active"}
              icon={Film}
              action={!isScenesDone}
              actionLabel="Confirm"
              onAction={handleConfirmScenes}
              acting={confirmingScenes}
            />

            <PipelineStep
              step={3}
              label="Visuals"
              sublabel="Generate AI visuals or attach media for each scene"
              state="locked"
              icon={Camera}
            />

            <PipelineStep
              step={4}
              label="Voiceover"
              sublabel="AI narration from your script body"
              state="locked"
              icon={Mic}
            />

            <PipelineStep
              step={5}
              label="Preview"
              sublabel="Assemble scenes into a preview sequence"
              state="locked"
              icon={Eye}
            />

            <PipelineStep
              step={6}
              label="Render"
              sublabel="Export the final short video file"
              state="locked"
              icon={RefreshCw}
            />

            <div className={cn(
              "flex items-start gap-3 rounded-lg border p-3 transition-colors",
              isPublished
                ? "border-emerald-500/30 bg-emerald-500/5"
                : "border-violet-500/30 bg-violet-500/5",
            )}>
              <div className={cn(
                "flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-xs",
                isPublished
                  ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-600"
                  : "border-violet-500/50 bg-violet-500/10 text-violet-600",
              )}>
                {isPublished
                  ? <Check className="h-3.5 w-3.5" />
                  : <Send className="h-3.5 w-3.5" />
                }
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-medium leading-snug">Publish</p>
                    <p className="mt-0.5 text-[11px] text-muted-foreground leading-snug">
                      {isPublished
                        ? "Added to your publishing queue"
                        : "Send to Publishing Hub to schedule & post"}
                    </p>
                  </div>
                  {!isPublished && (
                    <button
                      type="button"
                      onClick={handlePublish}
                      disabled={publishing}
                      className="shrink-0 flex items-center gap-1 rounded-md bg-violet-600 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-violet-700 disabled:opacity-60"
                    >
                      {publishing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
                      Publish
                    </button>
                  )}
                  {isPublished && (
                    <a
                      href="/ai/publish"
                      className="shrink-0 flex items-center gap-1 rounded-md border border-emerald-500/40 px-2.5 py-1 text-[11px] font-medium text-emerald-700 dark:text-emerald-400 hover:bg-emerald-500/10"
                    >
                      <ChevronRight className="h-3 w-3" />
                      View Queue
                    </a>
                  )}
                </div>
              </div>
            </div>

            {/* Quick project info */}
            <div className="mt-4 rounded-lg border border-border/50 bg-muted/20 p-3">
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Project info</p>
              <dl className="space-y-1.5 text-[11px]">
                <div className="flex items-center justify-between">
                  <dt className="text-muted-foreground">Platform</dt>
                  <dd className="font-medium capitalize">{platformLabel}</dd>
                </div>
                <div className="flex items-center justify-between">
                  <dt className="text-muted-foreground">Length</dt>
                  <dd className="font-medium">{project.video_length}s</dd>
                </div>
                <div className="flex items-center justify-between">
                  <dt className="text-muted-foreground">Scenes</dt>
                  <dd className="font-medium">{project.scenes.length}</dd>
                </div>
                {(project.metadata?.tone as string) && (
                  <div className="flex items-center justify-between">
                    <dt className="text-muted-foreground">Tone</dt>
                    <dd className="font-medium capitalize">{project.metadata.tone as string}</dd>
                  </div>
                )}
                {(project.metadata?.model as string) && (
                  <div className="flex items-center justify-between">
                    <dt className="text-muted-foreground">AI Model</dt>
                    <dd className="font-medium text-[10px] truncate max-w-28">{project.metadata.model as string}</dd>
                  </div>
                )}
              </dl>
            </div>

            {/* Insights hint */}
            <div className="rounded-lg border border-border/40 bg-muted/10 p-3">
              <p className="text-[11px] text-muted-foreground">
                After publishing, track performance in{" "}
                <a href="/ai/insights" className="font-medium text-primary hover:underline">
                  AI Insights <AlertCircle className="inline h-3 w-3" />
                </a>
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
