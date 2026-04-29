"use client";

import { useState, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Clapperboard, ArrowLeft, Check, Pencil, Save, X,
  Send, ChevronRight, Film, Mic, Eye, Globe,
  Clock, Camera, AlignLeft, MousePointerClick, Type,
  StickyNote, Copy, RefreshCw, Loader2, BadgeCheck,
  CircleDot, Lock, Wand2, Subtitles, Play, MoreHorizontal,
  Trash2, RotateCcw, AlertTriangle, Download, ExternalLink,
  PlusCircle, Upload, StopCircle, ChevronDown, ChevronUp,
  Image as ImageIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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

interface RefImage { id: string; url: string; label: string }

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

// ─── Tab type ─────────────────────────────────────────────────────────────────

type Tab = "script" | "scenes" | "voiceover" | "produce";

// ─── Main workspace ────────────────────────────────────────────────────────────

export function ProjectWorkspace({ project: initial }: { project: VideoProject }) {
  const router = useRouter();
  const [project, setProject] = useState<VideoProject>(initial);
  const [activeTab, setActiveTab] = useState<Tab>("script");
  const [publishing, setPublishing] = useState(false);
  const [confirmingScenes, setConfirmingScenes] = useState(false);
  const [copiedVoiceover, setCopiedVoiceover] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [duplicating, setDuplicating] = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(project.title);
  const [voiceMode, setVoiceMode] = useState<"record" | "upload" | "ai">("record");
  const [recording, setRecording] = useState(false);
  const [recorderRef, setRecorderRef] = useState<MediaRecorder | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [uploadedVoiceName, setUploadedVoiceName] = useState<string | null>(null);
  const [editingPreviewUrl, setEditingPreviewUrl] = useState(false);
  const [previewUrlDraft, setPreviewUrlDraft] = useState(project.preview_url ?? "");
  const [savingPreviewUrl, setSavingPreviewUrl] = useState(false);
  const [editingRenderUrl, setEditingRenderUrl] = useState(false);
  const [renderUrlDraft, setRenderUrlDraft] = useState(project.render_url ?? "");
  const [savingRenderUrl, setSavingRenderUrl] = useState(false);
  const [showRefImages, setShowRefImages] = useState(false);
  const [refImages, setRefImages] = useState<RefImage[]>(
    (project.metadata?.reference_images as RefImage[] | undefined) ?? []
  );
  const [newImageUrl, setNewImageUrl] = useState("");

  const missingFields = useMemo(() => {
    const f: string[] = [];
    if (!project.hook?.trim())        f.push("Hook");
    if (!project.concept?.trim())    f.push("Concept");
    if (!project.script_body?.trim()) f.push("Script Body");
    if (!project.cta?.trim())        f.push("CTA");
    if (!project.caption?.trim())    f.push("Caption");
    return f;
  }, [project.hook, project.concept, project.script_body, project.cta, project.caption]);

  const save = useCallback(async (updates: Partial<VideoProject>) => {
    const res = await fetch(`/api/ai/video/${project.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updates),
    });
    if (!res.ok) {
      const { error } = await res.json().catch(() => ({}));
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
    toast.success("Scenes confirmed — storyboard locked in");
    setConfirmingScenes(false);
  };

  const handleRegenerate = async (fields: "full" | "script" | "scenes") => {
    setRegenerating(true);
    try {
      const res = await fetch(`/api/ai/video/${project.id}/regenerate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fields }),
      });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error || "Regeneration failed"); return; }
      setProject(data.project);
      toast.success(
        fields === "scenes" ? "Scenes regenerated from script" :
        fields === "script" ? "Script fields regenerated" :
        "Full project regenerated by AI"
      );
    } finally {
      setRegenerating(false);
    }
  };

  const handleDuplicate = async () => {
    setDuplicating(true);
    try {
      const res = await fetch(`/api/ai/video/${project.id}/duplicate`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error || "Duplicate failed"); return; }
      toast.success("Project duplicated — opening copy");
      router.push(`/ai/video/${data.projectId}`);
    } finally {
      setDuplicating(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm("Delete this project permanently? This cannot be undone.")) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/ai/video/${project.id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error || "Delete failed"); return; }
      toast.success("Project deleted");
      router.push("/ai");
    } finally {
      setDeleting(false);
    }
  };

  const handleTitleSave = async () => {
    if (!titleDraft.trim()) return;
    await save({ title: titleDraft.trim() });
    setEditingTitle(false);
    toast.success("Title updated");
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
        const { error } = await res.json().catch(() => ({}));
        toast.error(error || "Failed to add to queue");
        return;
      }
      const { item } = await res.json();
      await save({ status: "published", publish_queue_id: item?.id ?? null });
      toast.success("Added to publish queue — open Publishing Hub to schedule");
      setActiveTab("produce");
    } finally {
      setPublishing(false);
    }
  };

  const handleSavePreviewUrl = async () => {
    const url = previewUrlDraft.trim();
    if (!url) return;
    setSavingPreviewUrl(true);
    try {
      await save({ preview_url: url });
      setEditingPreviewUrl(false);
      toast.success("Preview URL saved");
    } finally {
      setSavingPreviewUrl(false);
    }
  };

  const handleSaveRenderUrl = async () => {
    const url = renderUrlDraft.trim();
    if (!url) return;
    setSavingRenderUrl(true);
    try {
      await save({ render_url: url, render_status: "ready" });
      setEditingRenderUrl(false);
      toast.success("Render URL saved");
    } finally {
      setSavingRenderUrl(false);
    }
  };

  const handleStartRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const chunks: Blob[] = [];
      const recorder = new MediaRecorder(stream);
      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunks, { type: recorder.mimeType || "audio/webm" });
        if (audioUrl) URL.revokeObjectURL(audioUrl);
        setAudioUrl(URL.createObjectURL(blob));
        setRecording(false);
      };
      recorder.start(200);
      setRecorderRef(recorder);
      setAudioUrl(null);
      setRecording(true);
    } catch {
      toast.error("Could not access microphone — check browser permissions");
    }
  };

  const handleStopRecording = () => {
    recorderRef?.stop();
    setRecorderRef(null);
  };

  const handleVoiceUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    setAudioUrl(URL.createObjectURL(file));
    setUploadedVoiceName(file.name);
  };

  const handleAddRefImage = async () => {
    if (!newImageUrl.trim()) return;
    const img: RefImage = { id: Date.now().toString(), url: newImageUrl.trim(), label: "" };
    const next = [...refImages, img];
    setRefImages(next);
    setNewImageUrl("");
    await save({ metadata: { ...project.metadata, reference_images: next } });
    toast.success("Reference image added");
  };

  const handleRemoveRefImage = async (imgId: string) => {
    const next = refImages.filter((i) => i.id !== imgId);
    setRefImages(next);
    await save({ metadata: { ...project.metadata, reference_images: next } });
  };

  const sortedScenes = useMemo(
    () => project.scenes.slice().sort((a, b) => a.order - b.order),
    [project.scenes],
  );

  const voiceoverScript = useMemo(
    () =>
      sortedScenes
        .map((s, i) => `[Scene ${i + 1} — ${SCENE_TYPE_LABELS[s.type]} · ${s.duration}s]\n${s.script}`)
        .join("\n\n"),
    [sortedScenes],
  );

  const subtitleLines = useMemo(
    () => sortedScenes.map((s) => s.on_screen_text).filter(Boolean),
    [sortedScenes],
  );

  const statusMeta = STATUS_META[project.status] ?? STATUS_META.script_ready;
  const platformLabel = PLATFORM_LABELS[project.platform] ?? project.platform;
  const ago = formatDistanceToNow(new Date(project.created_at), { addSuffix: true });

  const isScenesDone  = project.status !== "script_ready";
  const hasScenesAny  = project.scenes.length > 0;
  const isPublished   = project.status === "published";
  const totalDuration = sortedScenes.reduce((sum, s) => sum + s.duration, 0);

  const tabs: { id: Tab; label: string; badge?: string }[] = [
    { id: "script",    label: "Script" },
    { id: "scenes",    label: "Scenes", badge: String(project.scenes.length) },
    { id: "voiceover", label: "Voiceover" },
    { id: "produce",   label: "Produce" },
  ];

  return (
    <div className="flex min-h-screen flex-col bg-background">

      {/* ── Studio header ─────────────────────────────────────────────── */}
      <div className="border-b border-border bg-background/95 backdrop-blur-sm sticky top-0 z-20">
        <div className="mx-auto max-w-5xl px-4 sm:px-8">
          {/* Top row */}
          <div className="flex items-center gap-3 py-3">
            <button
              type="button"
              onClick={() => router.push("/ai")}
              className="flex items-center gap-1 text-[12px] text-muted-foreground hover:text-foreground transition-colors"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              AI Hub
            </button>
            <span className="text-muted-foreground/40">/</span>

            <div className="flex min-w-0 flex-1 items-center gap-3">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-violet-600 to-fuchsia-500 text-white">
                <Clapperboard className="h-4 w-4" />
              </div>
              <div className="min-w-0 flex-1">
                {editingTitle ? (
                  <div className="flex items-center gap-1.5">
                    <input
                      value={titleDraft}
                      onChange={(e) => setTitleDraft(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") handleTitleSave(); if (e.key === "Escape") setEditingTitle(false); }}
                      className="min-w-0 flex-1 rounded border border-primary/30 bg-background px-2 py-0.5 text-sm font-semibold focus:outline-none focus:ring-1 focus:ring-primary/30"
                      autoFocus
                    />
                    <button type="button" onClick={handleTitleSave} className="rounded p-1 hover:bg-muted"><Check className="h-3.5 w-3.5 text-emerald-600" /></button>
                    <button type="button" onClick={() => setEditingTitle(false)} className="rounded p-1 hover:bg-muted"><X className="h-3.5 w-3.5 text-muted-foreground" /></button>
                  </div>
                ) : (
                  <div className="flex items-center gap-1.5 group/title">
                    <h1 className="truncate text-sm font-semibold leading-none">{project.title}</h1>
                    <button type="button" onClick={() => { setTitleDraft(project.title); setEditingTitle(true); }}
                      className="opacity-0 group-hover/title:opacity-100 rounded p-0.5 text-muted-foreground hover:text-foreground transition-opacity">
                      <Pencil className="h-3 w-3" />
                    </button>
                  </div>
                )}
                <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground">
                  <span className="flex items-center gap-0.5"><Globe className="h-3 w-3" />{platformLabel}</span>
                  <span>·</span>
                  <span className="flex items-center gap-0.5"><Clock className="h-3 w-3" />{totalDuration}s / {project.video_length}s target</span>
                  <span>·</span>
                  <span>{ago}</span>
                </div>
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-2">
              <span className={cn(
                "hidden rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider sm:inline-flex",
                statusMeta.color, statusMeta.bg,
              )}>
                {statusMeta.label}
              </span>
              {isPublished ? (
                <Badge className="border-0 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300">
                  <BadgeCheck className="mr-1 h-3.5 w-3.5" />
                  Published
                </Badge>
              ) : (
                <Button size="sm" className="h-7 gap-1.5 text-xs" onClick={handlePublish} disabled={publishing}>
                  {publishing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
                  {publishing ? "Queuing…" : "Publish"}
                </Button>
              )}

              {/* Three-dot menu */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button type="button" disabled={regenerating || deleting || duplicating}
                    className="flex h-7 w-7 items-center justify-center rounded-md border border-border text-muted-foreground hover:bg-muted hover:text-foreground transition-colors disabled:opacity-50">
                    {(regenerating || deleting || duplicating)
                      ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      : <MoreHorizontal className="h-3.5 w-3.5" />}
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-52">
                  <DropdownMenuItem onClick={() => { setTitleDraft(project.title); setEditingTitle(true); }}>
                    <Pencil className="mr-2 h-3.5 w-3.5" />Edit title
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => handleRegenerate("full")} disabled={regenerating}>
                    <RotateCcw className="mr-2 h-3.5 w-3.5" />Regenerate full project
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleRegenerate("script")} disabled={regenerating}>
                    <RefreshCw className="mr-2 h-3.5 w-3.5" />Regenerate script only
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleRegenerate("scenes")} disabled={regenerating}>
                    <Film className="mr-2 h-3.5 w-3.5" />Regenerate scenes from script
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={handleDuplicate} disabled={duplicating}>
                    <Copy className="mr-2 h-3.5 w-3.5" />Duplicate project
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={handleDelete} disabled={deleting}
                    className="text-destructive focus:text-destructive">
                    <Trash2 className="mr-2 h-3.5 w-3.5" />Delete project
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>

          {/* Tab bar */}
          <div className="flex gap-0.5 pb-px">
            {tabs.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setActiveTab(t.id)}
                className={cn(
                  "flex items-center gap-1.5 rounded-t-md border-b-2 px-4 py-2.5 text-[12px] font-medium transition-colors",
                  activeTab === t.id
                    ? "border-primary text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground hover:border-border",
                )}
              >
                {t.label}
                {t.badge !== undefined && (
                  <span className={cn(
                    "flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[9px] font-bold",
                    activeTab === t.id
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground",
                  )}>
                    {t.badge}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── Tab content ───────────────────────────────────────────────── */}
      <div className="mx-auto w-full max-w-5xl flex-1 px-4 py-6 sm:px-8">

        {/* ── SCRIPT TAB ──────────────────────────────────────────────── */}
        {activeTab === "script" && (
          <div className="mx-auto max-w-2xl space-y-3">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold">Script Package</h2>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  AI-generated script — click the pencil on any field to edit
                </p>
              </div>
              <button
                type="button"
                onClick={() => setActiveTab("scenes")}
                className="flex items-center gap-1 rounded-md bg-primary/10 px-3 py-1.5 text-[11px] font-medium text-primary hover:bg-primary/15 transition-colors"
              >
                Review Scenes <ChevronRight className="h-3 w-3" />
              </button>
            </div>

            {/* Recovery banner */}
            {missingFields.length > 0 && (
              <div className="flex items-start gap-3 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-amber-700 dark:text-amber-400">Some fields weren&apos;t generated</p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">Missing: {missingFields.join(", ")}</p>
                </div>
                <button
                  type="button"
                  onClick={() => handleRegenerate("script")}
                  disabled={regenerating}
                  className="shrink-0 flex items-center gap-1 rounded-md bg-amber-600 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-amber-700 disabled:opacity-60"
                >
                  {regenerating ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCcw className="h-3 w-3" />}
                  Regenerate
                </button>
              </div>
            )}

            <EditableField label="Hook" icon={MousePointerClick}
              value={project.hook ?? ""}
              onSave={handleFieldSave("hook")} />

            <EditableField label="Concept" icon={CircleDot}
              value={project.concept ?? ""}
              onSave={handleFieldSave("concept")} />

            <EditableField label="Script Body" icon={AlignLeft}
              value={project.script_body ?? ""}
              multiline
              onSave={handleFieldSave("script_body")} />

            <EditableField label="CTA" icon={MousePointerClick}
              value={project.cta ?? ""}
              onSave={handleFieldSave("cta")} />

            <EditableField label="Caption" icon={Type}
              value={project.caption ?? ""}
              onSave={handleFieldSave("caption")} />

            <div className="pt-2 flex justify-end">
              <button
                type="button"
                onClick={() => setActiveTab("scenes")}
                className="flex items-center gap-1.5 rounded-md bg-sky-600 px-3 py-1.5 text-[12px] font-medium text-white hover:bg-sky-700 transition-colors"
              >
                <Film className="h-3.5 w-3.5" />
                Continue to Scenes
              </button>
            </div>
          </div>
        )}

        {/* ── SCENES TAB ──────────────────────────────────────────────── */}
        {activeTab === "scenes" && (
          <div>
            <div className="mb-4 flex items-center justify-between gap-4">
              <div>
                <h2 className="text-sm font-semibold">Scene Breakdown</h2>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  {project.scenes.length} scenes · {totalDuration}s total · expand any scene to edit
                </p>
              </div>
              <div className="flex items-center gap-2">
                {isScenesDone ? (
                  <span className="flex items-center gap-1 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
                    <Check className="h-3.5 w-3.5" />Scenes confirmed
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={handleConfirmScenes}
                    disabled={confirmingScenes || project.scenes.length === 0}
                    className="flex items-center gap-1.5 rounded-md bg-sky-600 px-3 py-1.5 text-[11px] font-medium text-white hover:bg-sky-700 disabled:opacity-50 transition-colors"
                  >
                    {confirmingScenes ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                    Confirm Scenes
                  </button>
                )}
                {hasScenesAny && (
                  <button
                    type="button"
                    onClick={() => {
                      const text = sortedScenes
                        .map((s, i) =>
                          `[Scene ${i + 1} — ${SCENE_TYPE_LABELS[s.type]} · ${s.duration}s]\nVisual: ${s.visual_prompt}\nShot: ${s.shot_type}${
                            refImages.length > 0
                              ? `\nReference: ${refImages.map((r) => r.url).join(", ")}`
                              : ""
                          }`
                        )
                        .join("\n\n");
                      navigator.clipboard.writeText(text);
                      toast.success("All visual prompts copied");
                    }}
                    className="flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-[11px] text-muted-foreground hover:bg-muted transition-colors"
                  >
                    <Copy className="h-3 w-3" />Copy Prompts
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setActiveTab("voiceover")}
                  className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-[11px] text-muted-foreground hover:bg-muted transition-colors"
                >
                  <Mic className="h-3 w-3" />Voiceover
                </button>
              </div>
            </div>

            {/* ── Reference Images ─────────────────────────────────── */}
            <div className="mb-4 rounded-xl border border-border">
              <button
                type="button"
                onClick={() => setShowRefImages((v) => !v)}
                className="flex w-full items-center justify-between px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground hover:bg-muted/30 transition-colors"
              >
                <div className="flex items-center gap-1.5">
                  <ImageIcon className="h-3.5 w-3.5" />
                  Reference Images
                  {refImages.length > 0 && (
                    <span className="flex h-4 w-4 items-center justify-center rounded-full bg-primary text-[8px] font-bold text-primary-foreground">
                      {refImages.length}
                    </span>
                  )}
                </div>
                {showRefImages
                  ? <ChevronUp className="h-3.5 w-3.5" />
                  : <ChevronDown className="h-3.5 w-3.5" />}
              </button>

              {showRefImages && (
                <div className="border-t border-border/60 p-4 space-y-3">
                  <p className="text-[11px] text-muted-foreground">
                    Add reference images for visual consistency — product photos, character references, or brand assets. Share these with your visual AI tool alongside each scene&apos;s prompt.
                  </p>

                  {refImages.length > 0 && (
                    <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                      {refImages.map((img) => (
                        <div key={img.id} className="group relative aspect-video rounded-lg border border-border overflow-hidden bg-muted">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={img.url} alt={img.label || "Reference"} className="h-full w-full object-cover" />
                          <div className="absolute inset-0 flex items-center justify-center bg-background/70 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button
                              type="button"
                              onClick={() => handleRemoveRefImage(img.id)}
                              className="flex items-center gap-1 rounded-md bg-destructive px-2 py-1 text-[10px] font-medium text-white"
                            >
                              <X className="h-2.5 w-2.5" />Remove
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="flex gap-2">
                    <input
                      type="url"
                      placeholder="Paste image URL (https://...)" 
                      value={newImageUrl}
                      onChange={(e) => setNewImageUrl(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && handleAddRefImage()}
                      className="flex-1 rounded-md border border-border bg-background px-3 py-1.5 text-[12px] outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20"
                    />
                    <button
                      type="button"
                      onClick={handleAddRefImage}
                      disabled={!newImageUrl.trim()}
                      className="flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-[11px] font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-40"
                    >
                      <PlusCircle className="h-3 w-3" />Add
                    </button>
                  </div>
                </div>
              )}
            </div>

            {project.scenes.length === 0 ? (
              <div className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-border/60 py-16">
                <Film className="mb-3 h-8 w-8 text-muted-foreground/30" />
                <p className="text-sm font-medium text-muted-foreground">No scenes generated</p>
                <p className="mt-1 text-xs text-muted-foreground/60 max-w-xs text-center">
                  Scenes are derived from the script. Generate them automatically or go back to Script to check the content.
                </p>
                <div className="mt-4 flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleRegenerate("scenes")}
                    disabled={regenerating}
                    className="flex items-center gap-1.5 rounded-md bg-sky-600 px-3 py-1.5 text-[11px] font-medium text-white hover:bg-sky-700 disabled:opacity-50"
                  >
                    {regenerating ? <Loader2 className="h-3 w-3 animate-spin" /> : <PlusCircle className="h-3 w-3" />}
                    Generate Scenes from Script
                  </button>
                  <button type="button" onClick={() => setActiveTab("script")}
                    className="flex items-center gap-1 rounded-md border border-border px-3 py-1.5 text-[11px] text-muted-foreground hover:bg-muted">
                    <ArrowLeft className="h-3 w-3" />Back to Script
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                {sortedScenes.map((scene) => (
                  <SceneCard key={scene.id} scene={scene} onUpdate={handleSceneUpdate} />
                ))}
              </div>
            )}

            {!isScenesDone && project.scenes.length > 0 && (
              <div className="mt-4 rounded-lg border border-sky-500/20 bg-sky-500/5 p-3">
                <p className="text-[11px] text-sky-700 dark:text-sky-300">
                  <strong>Next step:</strong> Review and edit the scene cards above, then click <strong>Confirm Scenes</strong> to lock in the storyboard and continue to Voiceover.
                </p>
              </div>
            )}
          </div>
        )}

        {/* ── VOICEOVER TAB ───────────────────────────────────────────── */}
        {activeTab === "voiceover" && (
          <div className="mx-auto max-w-2xl space-y-5">
            <div className="mb-2">
              <h2 className="text-sm font-semibold">Voiceover & Subtitles</h2>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                Full narration script derived from your scenes — use this for recording or TTS generation
              </p>
            </div>

            {/* Full voiceover script */}
            <div className="rounded-xl border border-border bg-background/60">
              <div className="flex items-center justify-between border-b border-border/60 px-4 py-2.5">
                <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  <Mic className="h-3.5 w-3.5" />
                  Full Voiceover Script
                </div>
                <button
                  type="button"
                  onClick={async () => {
                    await navigator.clipboard.writeText(voiceoverScript);
                    setCopiedVoiceover(true);
                    setTimeout(() => setCopiedVoiceover(false), 1800);
                  }}
                  className="flex items-center gap-1 rounded-md px-2 py-1 text-[10px] text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                >
                  {copiedVoiceover ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
                  {copiedVoiceover ? "Copied!" : "Copy"}
                </button>
              </div>
              {voiceoverScript ? (
                <pre className="whitespace-pre-wrap px-4 py-3 text-[12px] leading-relaxed text-foreground font-sans">
                  {voiceoverScript}
                </pre>
              ) : (
                <div className="px-4 py-8 text-center">
                  <Mic className="mx-auto mb-2 h-6 w-6 text-muted-foreground/30" />
                  <p className="text-sm text-muted-foreground">No scenes yet — add scenes first</p>
                </div>
              )}
            </div>

            {/* Voice input options */}
            <div className="rounded-xl border border-border">
              {/* Tab bar */}
              <div className="flex border-b border-border/60">
                {([
                  { id: "record", label: "Record",  icon: Mic      },
                  { id: "upload", label: "Upload",  icon: Upload   },
                  { id: "ai",     label: "AI Voice", icon: Wand2    },
                ] as { id: "record"|"upload"|"ai"; label: string; icon: React.ComponentType<{className?:string}> }[]).map(({ id, label, icon: Icon }) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setVoiceMode(id)}
                    className={cn(
                      "flex items-center gap-1.5 border-b-2 px-4 py-2.5 text-[11px] font-medium transition-colors",
                      voiceMode === id
                        ? "border-primary text-foreground"
                        : "border-transparent text-muted-foreground hover:text-foreground",
                    )}
                  >
                    <Icon className="h-3 w-3" />{label}
                  </button>
                ))}
              </div>

              {/* ── Record ───────────────────────── */}
              {voiceMode === "record" && (
                <div className="space-y-3 p-4">
                  <p className="text-[11px] text-muted-foreground">
                    Record your narration directly in the browser. Use the voiceover script above as your guide.
                  </p>
                  <div className="flex items-center gap-3">
                    {!recording ? (
                      <button
                        type="button"
                        onClick={handleStartRecording}
                        className="flex items-center gap-1.5 rounded-md bg-rose-600 px-3 py-1.5 text-[12px] font-medium text-white hover:bg-rose-700 transition-colors"
                      >
                        <Mic className="h-3.5 w-3.5" />Start Recording
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={handleStopRecording}
                        className="flex animate-pulse items-center gap-1.5 rounded-md bg-rose-600 px-3 py-1.5 text-[12px] font-medium text-white hover:bg-rose-700 transition-colors"
                      >
                        <StopCircle className="h-3.5 w-3.5" />Stop Recording
                      </button>
                    )}
                    {recording && (
                      <span className="flex items-center gap-1.5 text-[11px] text-rose-600">
                        <span className="h-2 w-2 animate-pulse rounded-full bg-rose-500" />
                        Recording…
                      </span>
                    )}
                  </div>
                  {audioUrl && !recording && (
                    <div className="flex items-center gap-2">
                      <audio src={audioUrl} controls className="h-9 flex-1 min-w-0" />
                      <a
                        href={audioUrl}
                        download="voiceover.webm"
                        className="flex shrink-0 items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-[11px] text-muted-foreground hover:bg-muted transition-colors"
                      >
                        <Download className="h-3 w-3" />Save
                      </a>
                    </div>
                  )}
                </div>
              )}

              {/* ── Upload ───────────────────────── */}
              {voiceMode === "upload" && (
                <div className="space-y-3 p-4">
                  <p className="text-[11px] text-muted-foreground">
                    Upload a pre-recorded voice file (.mp3, .wav, .m4a, .ogg, .webm).
                  </p>
                  <label className="flex cursor-pointer items-center gap-3 rounded-xl border-2 border-dashed border-border/60 px-4 py-5 hover:border-primary/40 hover:bg-muted/20 transition-colors">
                    <Upload className="h-5 w-5 shrink-0 text-muted-foreground" />
                    <div>
                      <p className="text-[12px] font-medium">
                        {uploadedVoiceName ?? "Click to choose audio file"}
                      </p>
                      {uploadedVoiceName && (
                        <p className="text-[10px] text-muted-foreground">Click to replace</p>
                      )}
                    </div>
                    <input type="file" accept="audio/*" className="hidden" onChange={handleVoiceUpload} />
                  </label>
                  {audioUrl && uploadedVoiceName && (
                    <div className="flex items-center gap-2">
                      <audio src={audioUrl} controls className="h-9 flex-1 min-w-0" />
                      <button
                        type="button"
                        onClick={() => { setAudioUrl(null); setUploadedVoiceName(null); }}
                        className="shrink-0 rounded-md border border-border px-2 py-1.5 text-[11px] text-muted-foreground hover:bg-muted transition-colors"
                      >
                        Remove
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* ── AI Voice ─────────────────────── */}
              {voiceMode === "ai" && (
                <div className="space-y-3 p-4">
                  <p className="text-[11px] text-muted-foreground">
                    Generate AI narration from your voiceover script. Configure a provider API key in Admin → AI Configuration.
                  </p>
                  <div className="space-y-2">
                    {[
                      {
                        name: "ElevenLabs",
                        badge: "Best",
                        badgeColor: "bg-violet-500/15 text-violet-700 dark:text-violet-300",
                        desc: "Human-quality voices + voice cloning from a 1-min sample. 10,000 chars/mo free.",
                        href: "https://elevenlabs.io",
                      },
                      {
                        name: "PlayHT",
                        badge: "Alternative",
                        badgeColor: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
                        desc: "Clone any voice from 5 s of audio. Good free tier.",
                        href: "https://play.ht",
                      },
                    ].map((p) => (
                      <div key={p.name} className="flex items-start justify-between gap-3 rounded-lg border border-border/60 bg-muted/20 p-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="text-[12px] font-medium">{p.name}</span>
                            <span className={cn("rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider", p.badgeColor)}>{p.badge}</span>
                          </div>
                          <p className="mt-0.5 text-[11px] text-muted-foreground">{p.desc}</p>
                        </div>
                        <a
                          href={p.href}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="shrink-0 flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[10px] text-muted-foreground hover:bg-muted transition-colors"
                        >
                          <ExternalLink className="h-2.5 w-2.5" />Get key
                        </a>
                      </div>
                    ))}
                  </div>
                  <a
                    href="/admin/ai"
                    className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
                  >
                    Configure API key in Admin → AI Configuration <ExternalLink className="h-2.5 w-2.5" />
                  </a>
                </div>
              )}
            </div>

            {/* Mark voiceover done */}
            {voiceoverScript && (
              <div className={cn(
                "flex items-center justify-between gap-3 rounded-lg border p-3",
                project.voiceover_status === "ready"
                  ? "border-emerald-500/30 bg-emerald-500/5"
                  : "border-border/60 bg-muted/10",
              )}>
                <div className="flex items-center gap-2">
                  {project.voiceover_status === "ready" ? (
                    <BadgeCheck className="h-4 w-4 shrink-0 text-emerald-600" />
                  ) : (
                    <CircleDot className="h-4 w-4 shrink-0 text-muted-foreground" />
                  )}
                  <p className="text-[11px] text-muted-foreground">
                    {project.voiceover_status === "ready"
                      ? "Voiceover marked as recorded — proceed to Produce"
                      : "Once you have recorded or generated your narration, mark it done"}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={async () => {
                    if (project.voiceover_status === "ready") {
                      await save({ voiceover_status: "pending" });
                      toast.success("Voiceover status cleared");
                    } else {
                      await save({ voiceover_status: "ready" });
                      toast.success("Voiceover marked as done");
                    }
                  }}
                  className={cn(
                    "shrink-0 flex items-center gap-1 rounded-md px-2.5 py-1.5 text-[11px] font-medium transition-colors",
                    project.voiceover_status === "ready"
                      ? "border border-emerald-500/40 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-500/10"
                      : "bg-emerald-600 text-white hover:bg-emerald-700",
                  )}
                >
                  {project.voiceover_status === "ready" ? (
                    <><RotateCcw className="h-3 w-3" />Undo</>
                  ) : (
                    <><Check className="h-3 w-3" />Mark Done</>
                  )}
                </button>
              </div>
            )}

            {/* Subtitle / caption structure */}
            <div className="rounded-xl border border-border bg-background/60">
              <div className="flex items-center gap-1.5 border-b border-border/60 px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                <Subtitles className="h-3.5 w-3.5" />
                On-Screen Text by Scene
              </div>
              {subtitleLines.length > 0 ? (
                <ul className="divide-y divide-border/40">
                  {sortedScenes
                    .filter((s) => s.on_screen_text)
                    .map((s, i) => (
                      <li key={s.id} className="flex items-center gap-3 px-4 py-2.5">
                        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-bold text-muted-foreground">
                          {i + 1}
                        </span>
                        <span className="flex-1 text-[12px]">{s.on_screen_text}</span>
                        <span className="text-[10px] text-muted-foreground">{s.duration}s</span>
                      </li>
                    ))}
                </ul>
              ) : (
                <p className="px-4 py-5 text-center text-[12px] text-muted-foreground/60">
                  No on-screen text set — edit scene cards to add text overlays
                </p>
              )}
            </div>

            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => setActiveTab("produce")}
                className="flex items-center gap-1.5 rounded-md bg-violet-600 px-3 py-1.5 text-[12px] font-medium text-white hover:bg-violet-700 transition-colors"
              >
                <Play className="h-3.5 w-3.5" />Continue to Produce
              </button>
            </div>
          </div>
        )}

        {/* ── PRODUCE TAB ─────────────────────────────────────────────── */}
        {activeTab === "produce" && (
          <div className="mx-auto max-w-xl space-y-3">
            <div className="mb-4">
              <h2 className="text-sm font-semibold">Production Pipeline</h2>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                Progress through each stage to take your project from script to published
              </p>
            </div>

            <PipelineStep step={1} icon={AlignLeft} label="Script Ready"
              sublabel={`Hook, concept, ${project.script_body ? "script body," : "script,"} CTA & caption all generated`}
              state="done" />

            <PipelineStep step={2} icon={Film} label="Scene Breakdown"
              sublabel={isScenesDone
                ? `${project.scenes.length} scenes confirmed · ${totalDuration}s storyboard`
                : `${project.scenes.length} scenes ready — review on the Scenes tab, then confirm`}
              state={isScenesDone ? "done" : project.scenes.length > 0 ? "active" : "active"}
              action={!isScenesDone && project.scenes.length > 0}
              actionLabel="Confirm"
              onAction={() => { setActiveTab("scenes"); }}
            />

            <PipelineStep step={3} icon={Camera} label="Scene Visuals"
              sublabel={hasScenesAny
                ? "Review visual direction notes on each scene — use for stock footage, AI images, or your own media"
                : "Generate scenes from your script to unlock visual direction"}
              state={hasScenesAny ? "active" : "locked"}
              action={hasScenesAny}
              actionLabel="Review Visuals"
              onAction={() => setActiveTab("scenes")}
            />

            <PipelineStep step={4} icon={Mic} label="Voiceover"
              sublabel={
                project.voiceover_status === "ready"
                  ? "Voiceover recorded — ready for the next stage"
                  : hasScenesAny
                  ? "Record, upload, or generate AI narration from your voiceover script"
                  : "Generate scenes first to build your voiceover script"
              }
              state={project.voiceover_status === "ready" ? "done" : hasScenesAny ? "active" : "locked"}
              action={hasScenesAny}
              actionLabel="Open Voiceover"
              onAction={() => setActiveTab("voiceover")}
            />

            {/* ── Preview ─────────────────────────────────────────────── */}
            <PipelineStep step={5} icon={Eye} label="Preview"
              sublabel={
                project.preview_url
                  ? "Preview link saved — open to review before final render"
                  : "Assemble your clips, then paste a preview link below"
              }
              state={project.preview_url ? "done" : "active"}
              action={!!project.preview_url}
              actionLabel="View Preview"
              onAction={() => project.preview_url && window.open(project.preview_url, "_blank")}
            />

            {/* Preview URL input — always shown when no URL or editing */}
            {(!project.preview_url || editingPreviewUrl) && (
              <div className="ml-10 -mt-1 mb-1 rounded-lg border border-border/60 bg-muted/20 p-3">
                <p className="mb-2 text-[11px] text-muted-foreground">
                  Paste a preview link — Google Drive, YouTube (unlisted), Dropbox, Vimeo, or any direct URL.
                </p>
                <div className="flex gap-2">
                  <input
                    type="url"
                    placeholder="https://..."
                    value={previewUrlDraft}
                    onChange={(e) => setPreviewUrlDraft(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleSavePreviewUrl()}
                    className="flex-1 rounded-md border border-border bg-background px-3 py-1.5 text-[12px] outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20"
                  />
                  <button
                    type="button"
                    onClick={handleSavePreviewUrl}
                    disabled={!previewUrlDraft.trim() || savingPreviewUrl}
                    className="flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-[11px] font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-40"
                  >
                    {savingPreviewUrl ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                    Save
                  </button>
                  {editingPreviewUrl && (
                    <button
                      type="button"
                      onClick={() => { setEditingPreviewUrl(false); setPreviewUrlDraft(project.preview_url ?? ""); }}
                      className="rounded-md border border-border px-2.5 py-1.5 text-[11px] text-muted-foreground hover:bg-muted"
                    >
                      Cancel
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* Change preview URL link (shown when URL already exists) */}
            {project.preview_url && !editingPreviewUrl && (
              <div className="ml-10 -mt-1 mb-1 flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => { setEditingPreviewUrl(true); setPreviewUrlDraft(project.preview_url ?? ""); }}
                  className="text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                >
                  Change URL
                </button>
              </div>
            )}

            {/* ── Render ──────────────────────────────────────────────── */}
            <PipelineStep step={6} icon={RefreshCw} label="Render"
              sublabel={
                project.render_status === "ready" && project.render_url
                  ? "Render complete — download your final video"
                  : project.render_status === "rendering"
                  ? "Render in progress…"
                  : "Once you have your final video file, paste the download link below"
              }
              state={
                project.render_status === "ready" ? "done" :
                project.render_status === "rendering" ? "loading" :
                "active"
              }
              action={project.render_status === "ready" && !!project.render_url}
              actionLabel="Download"
              onAction={() => project.render_url && window.open(project.render_url, "_blank")}
            />

            {/* Render URL input — always shown when no render URL */}
            {(!project.render_url || editingRenderUrl) && project.render_status !== "rendering" && (
              <div className="ml-10 -mt-1 mb-1 rounded-lg border border-border/60 bg-muted/20 p-3">
                <p className="mb-2 text-[11px] text-muted-foreground">
                  Paste your final render download link — Google Drive, Dropbox, direct .mp4, or any URL.
                </p>
                <div className="flex gap-2">
                  <input
                    type="url"
                    placeholder="https://..."
                    value={renderUrlDraft}
                    onChange={(e) => setRenderUrlDraft(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleSaveRenderUrl()}
                    className="flex-1 rounded-md border border-border bg-background px-3 py-1.5 text-[12px] outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20"
                  />
                  <button
                    type="button"
                    onClick={handleSaveRenderUrl}
                    disabled={!renderUrlDraft.trim() || savingRenderUrl}
                    className="flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-[11px] font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-40"
                  >
                    {savingRenderUrl ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                    Save
                  </button>
                  {editingRenderUrl && (
                    <button
                      type="button"
                      onClick={() => { setEditingRenderUrl(false); setRenderUrlDraft(project.render_url ?? ""); }}
                      className="rounded-md border border-border px-2.5 py-1.5 text-[11px] text-muted-foreground hover:bg-muted"
                    >
                      Cancel
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* Change render URL link (shown when URL already exists) */}
            {project.render_url && !editingRenderUrl && (
              <div className="ml-10 -mt-1 mb-1">
                <button
                  type="button"
                  onClick={() => { setEditingRenderUrl(true); setRenderUrlDraft(project.render_url ?? ""); }}
                  className="text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                >
                  Change URL
                </button>
              </div>
            )}

            {/* Publish */}
            <div className={cn(
              "flex items-start gap-3 rounded-lg border p-3.5 transition-colors",
              isPublished ? "border-emerald-500/30 bg-emerald-500/5" : "border-violet-500/30 bg-violet-500/5",
            )}>
              <div className={cn(
                "flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-xs",
                isPublished
                  ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-600"
                  : "border-violet-500/50 bg-violet-500/10 text-violet-600",
              )}>
                {isPublished ? <Check className="h-3.5 w-3.5" /> : <Send className="h-3.5 w-3.5" />}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-medium">Publish</p>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                      {isPublished ? "Added to your Publishing Hub queue" : "Queue to Publishing Hub to schedule & post"}
                    </p>
                  </div>
                  {!isPublished && (
                    <button type="button" onClick={handlePublish} disabled={publishing}
                      className="shrink-0 flex items-center gap-1 rounded-md bg-violet-600 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-violet-700 disabled:opacity-60">
                      {publishing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
                      {publishing ? "Queuing…" : "Publish Now"}
                    </button>
                  )}
                  {isPublished && (
                    <a href="/ai/publish"
                      className="shrink-0 flex items-center gap-1 rounded-md border border-emerald-500/40 px-2.5 py-1 text-[11px] font-medium text-emerald-700 dark:text-emerald-400 hover:bg-emerald-500/10">
                      <ChevronRight className="h-3 w-3" />View Queue
                    </a>
                  )}
                </div>
              </div>
            </div>

            {/* Project info card */}
            <div className="mt-2 rounded-lg border border-border/50 bg-muted/20 p-3">
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Project</p>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-[11px]">
                {([
                  ["Platform", platformLabel],
                  ["Target length", `${project.video_length}s`],
                  ["Scenes", `${project.scenes.length} (${totalDuration}s)`],
                  ["Status", statusMeta.label],
                  ...(project.metadata?.tone ? [["Tone", String(project.metadata.tone)]] : []),
                  ...(project.metadata?.model ? [["Model", String(project.metadata.model).split("-").slice(0, 2).join("-")]] : []),
                ] as [string, string][]).map(([k, v]) => (
                  <div key={k} className="flex items-center justify-between col-span-1">
                    <dt className="text-muted-foreground">{k}</dt>
                    <dd className="font-medium capitalize truncate max-w-[8rem]">{v}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
