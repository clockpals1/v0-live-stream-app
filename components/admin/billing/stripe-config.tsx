"use client";

import { useEffect, useState, useTransition } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { toast } from "sonner";
import {
  Eye,
  EyeOff,
  KeyRound,
  Save,
  RefreshCw,
  Check,
  Circle,
  Info,
} from "lucide-react";
import type { RedactedBillingConfig } from "@/lib/billing/config";
import { cn } from "@/lib/utils";

/**
 * Admin panel — Stripe API keys + mode toggle.
 *
 * Fields are grouped into a tabbed Test / Live editor. Each field shows
 * its own status pill so admins know what's saved without diffing
 * against memory. Mode switching uses a segmented control disabled per-
 * option when the target mode lacks a secret key — eliminating the
 * 400-from-the-server class of error entirely. If something does go
 * wrong, errors render inline at the top of the panel rather than as a
 * toast that vanishes.
 */

type FieldName =
  | "stripe_test_secret_key"
  | "stripe_test_publishable_key"
  | "stripe_test_webhook_secret"
  | "stripe_live_secret_key"
  | "stripe_live_publishable_key"
  | "stripe_live_webhook_secret";

interface FieldDef {
  name: FieldName;
  label: string;
  hint: string;
  placeholder: string;
  mask?: boolean;
}

const TEST_FIELDS: FieldDef[] = [
  {
    name: "stripe_test_secret_key",
    label: "Secret key",
    hint: "Server-side only. Used by Checkout and the Customer Portal.",
    placeholder: "sk_test_…",
    mask: true,
  },
  {
    name: "stripe_test_publishable_key",
    label: "Publishable key",
    hint: "Safe for the browser. Used to render Stripe Elements.",
    placeholder: "pk_test_…",
  },
  {
    name: "stripe_test_webhook_secret",
    label: "Webhook secret",
    hint: "From the Stripe webhook endpoint. Verifies incoming events.",
    placeholder: "whsec_…",
    mask: true,
  },
];

const LIVE_FIELDS: FieldDef[] = [
  {
    name: "stripe_live_secret_key",
    label: "Secret key",
    hint: "Server-side only. Used by Checkout and the Customer Portal.",
    placeholder: "sk_live_…",
    mask: true,
  },
  {
    name: "stripe_live_publishable_key",
    label: "Publishable key",
    hint: "Safe for the browser. Used to render Stripe Elements.",
    placeholder: "pk_live_…",
  },
  {
    name: "stripe_live_webhook_secret",
    label: "Webhook secret",
    hint: "From the Stripe webhook endpoint. Verifies incoming events.",
    placeholder: "whsec_…",
    mask: true,
  },
];

export function StripeConfigPanel({
  initial,
  onChanged,
}: {
  initial: RedactedBillingConfig;
  onChanged?: (next: RedactedBillingConfig) => void;
}) {
  const [config, setConfig] = useState<RedactedBillingConfig>(initial);
  const [drafts, setDrafts] = useState<Partial<Record<FieldName, string>>>({});
  const [reveal, setReveal] = useState<Partial<Record<FieldName, boolean>>>({});
  const [pending, startTransition] = useTransition();
  const [tab, setTab] = useState<"test" | "live">(initial.stripe_mode);
  const [inlineError, setInlineError] = useState<string | null>(null);

  useEffect(() => setConfig(initial), [initial]);

  const isDirty = Object.keys(drafts).length > 0;
  const testHasSecret = config.stripe_test_secret_key_set;
  const liveHasSecret = config.stripe_live_secret_key_set;
  const willHaveTestSecret =
    drafts.stripe_test_secret_key === undefined
      ? testHasSecret
      : !!drafts.stripe_test_secret_key;
  const willHaveLiveSecret =
    drafts.stripe_live_secret_key === undefined
      ? liveHasSecret
      : !!drafts.stripe_live_secret_key;

  async function patchConfig(body: Record<string, unknown>) {
    setInlineError(null);
    const res = await fetch("/api/admin/billing/config", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = (await res.json()) as { config?: RedactedBillingConfig; error?: string };
    if (!res.ok || !json.config) {
      throw new Error(json.error ?? "Save failed");
    }
    setConfig(json.config);
    onChanged?.(json.config);
  }

  function onSave() {
    if (!isDirty) return;
    startTransition(async () => {
      try {
        await patchConfig(drafts);
        setDrafts({});
        toast.success("Stripe configuration saved.");
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Save failed.";
        setInlineError(msg);
        toast.error(msg);
      }
    });
  }

  function setMode(target: "test" | "live") {
    if (target === config.stripe_mode) return;
    if (target === "live" && !liveHasSecret) {
      setInlineError(
        "The live secret key is empty. Save it first, then switch modes.",
      );
      setTab("live");
      return;
    }
    if (target === "test" && !testHasSecret) {
      setInlineError(
        "The test secret key is empty. Save it first, then switch modes.",
      );
      setTab("test");
      return;
    }
    startTransition(async () => {
      try {
        await patchConfig({ stripe_mode: target });
        toast.success(`Switched to ${target.toUpperCase()} mode.`);
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Could not switch mode.";
        setInlineError(msg);
      }
    });
  }

  function renderField(field: FieldDef) {
    const isSet = config[`${field.name}_set` as `${typeof field.name}_set`] as boolean;
    const tail =
      field.name === "stripe_test_secret_key"
        ? config.stripe_test_secret_key_tail
        : field.name === "stripe_live_secret_key"
          ? config.stripe_live_secret_key_tail
          : null;
    const draft = drafts[field.name];
    const showReveal = reveal[field.name] ?? false;
    const inputType = field.mask && !showReveal ? "password" : "text";
    const willClear = draft === "";
    const willChange = draft !== undefined && draft !== "";
    const dirty = draft !== undefined;

    return (
      <div key={field.name} className="space-y-2">
        <div className="flex items-baseline justify-between gap-2">
          <Label htmlFor={field.name} className="text-sm font-medium">
            {field.label}
          </Label>
          <StatusPill
            tone={
              willChange
                ? "pending"
                : willClear
                  ? "warning"
                  : isSet
                    ? "ok"
                    : "muted"
            }
          >
            {willChange
              ? "Pending"
              : willClear
                ? "Will clear"
                : isSet
                  ? tail
                    ? `…${tail}`
                    : "Saved"
                  : "Not set"}
          </StatusPill>
        </div>
        <div className="flex gap-2">
          <Input
            id={field.name}
            type={inputType}
            placeholder={field.placeholder}
            value={draft ?? ""}
            onChange={(e) =>
              setDrafts((p) => ({ ...p, [field.name]: e.target.value }))
            }
            className={cn(
              "font-mono text-sm",
              dirty && "border-amber-400 focus-visible:ring-amber-300/50 dark:border-amber-500/60",
            )}
            autoComplete="off"
            spellCheck={false}
          />
          {field.mask ? (
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={() =>
                setReveal((p) => ({ ...p, [field.name]: !showReveal }))
              }
              aria-label={showReveal ? "Hide value" : "Reveal value"}
            >
              {showReveal ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </Button>
          ) : null}
        </div>
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          {field.hint}
        </p>
      </div>
    );
  }

  return (
    <TooltipProvider delayDuration={150}>
      <Card>
        <CardHeader className="space-y-4 border-b border-border bg-muted/20 pb-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                <KeyRound className="h-4 w-4" />
                Stripe configuration
              </CardTitle>
              <CardDescription className="mt-1 max-w-prose">
                Manage test and live API credentials. The active mode determines
                which key set is used for Checkout, the Customer Portal, and
                webhook verification.
              </CardDescription>
            </div>
          </div>

          {/* Mode segmented control */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
              Active mode
            </span>
            <div
              role="radiogroup"
              aria-label="Active Stripe mode"
              className="inline-flex h-9 items-center gap-1 rounded-lg border border-border bg-background p-1 shadow-sm"
            >
              <ModeButton
                mode="test"
                active={config.stripe_mode === "test"}
                hasKey={testHasSecret}
                disabled={pending}
                onClick={() => setMode("test")}
              />
              <ModeButton
                mode="live"
                active={config.stripe_mode === "live"}
                hasKey={liveHasSecret}
                disabled={pending}
                onClick={() => setMode("live")}
              />
            </div>
            {pending ? (
              <RefreshCw className="ml-1 h-3.5 w-3.5 animate-spin text-muted-foreground" />
            ) : null}
            {!liveHasSecret ? (
              <span className="ml-auto inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                <Info className="h-3 w-3" />
                Add a live secret key to enable Live mode
              </span>
            ) : null}
          </div>

          {inlineError ? (
            <Alert variant="destructive" className="py-2">
              <AlertDescription className="text-xs">
                {inlineError}
              </AlertDescription>
            </Alert>
          ) : null}
        </CardHeader>

        <CardContent className="pt-5">
          <Tabs value={tab} onValueChange={(v) => setTab(v as "test" | "live")}>
            <TabsList className="mb-5 grid w-full max-w-md grid-cols-2">
              <TabsTrigger value="test" className="gap-2">
                <span
                  className={cn(
                    "inline-block h-1.5 w-1.5 rounded-full",
                    willHaveTestSecret ? "bg-emerald-500" : "bg-muted-foreground/40",
                  )}
                />
                Test keys
              </TabsTrigger>
              <TabsTrigger value="live" className="gap-2">
                <span
                  className={cn(
                    "inline-block h-1.5 w-1.5 rounded-full",
                    willHaveLiveSecret ? "bg-emerald-500" : "bg-muted-foreground/40",
                  )}
                />
                Live keys
              </TabsTrigger>
            </TabsList>
            <TabsContent value="test" className="space-y-5">
              {TEST_FIELDS.map(renderField)}
            </TabsContent>
            <TabsContent value="live" className="space-y-5">
              {LIVE_FIELDS.map(renderField)}
            </TabsContent>
          </Tabs>

          <div className="mt-6 flex flex-wrap items-center justify-end gap-2 border-t border-border pt-4">
            {isDirty ? (
              <Button
                variant="ghost"
                onClick={() => {
                  setDrafts({});
                  setInlineError(null);
                }}
                disabled={pending}
              >
                Discard
              </Button>
            ) : null}
            <Button onClick={onSave} disabled={!isDirty || pending}>
              <Save className="mr-2 h-4 w-4" />
              {pending ? "Saving…" : "Save changes"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </TooltipProvider>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────

function ModeButton({
  mode,
  active,
  hasKey,
  disabled,
  onClick,
}: {
  mode: "test" | "live";
  active: boolean;
  hasKey: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  const label = mode.toUpperCase();
  const tone =
    mode === "live"
      ? "data-[active=true]:bg-emerald-500/15 data-[active=true]:text-emerald-700 dark:data-[active=true]:text-emerald-300"
      : "data-[active=true]:bg-amber-500/15 data-[active=true]:text-amber-700 dark:data-[active=true]:text-amber-300";

  const button = (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      data-active={active}
      disabled={disabled || (!active && !hasKey)}
      onClick={onClick}
      className={cn(
        "rounded-md px-3 py-1 text-xs font-semibold tracking-wide transition",
        "disabled:cursor-not-allowed disabled:opacity-40",
        "hover:bg-muted",
        tone,
        !active && hasKey && "text-muted-foreground",
      )}
    >
      {active ? <Check className="mr-1 inline-block h-3 w-3" /> : null}
      {label}
    </button>
  );

  if (!hasKey && !active) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>{button}</TooltipTrigger>
        <TooltipContent>
          Add a {mode} secret key first to enable {label} mode.
        </TooltipContent>
      </Tooltip>
    );
  }
  return button;
}

function StatusPill({
  tone,
  children,
}: {
  tone: "ok" | "muted" | "pending" | "warning";
  children: React.ReactNode;
}) {
  const cls =
    tone === "ok"
      ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
      : tone === "pending"
        ? "bg-amber-500/15 text-amber-700 dark:text-amber-300"
        : tone === "warning"
          ? "bg-rose-500/10 text-rose-700 dark:text-rose-300"
          : "bg-muted text-muted-foreground";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-mono text-[10px]",
        cls,
      )}
    >
      {tone === "ok" ? (
        <Check className="h-2.5 w-2.5" />
      ) : tone === "muted" ? (
        <Circle className="h-2 w-2" />
      ) : null}
      {children}
    </span>
  );
}
