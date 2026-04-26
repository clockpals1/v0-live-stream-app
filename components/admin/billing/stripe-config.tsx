"use client";

import { useEffect, useState, useTransition } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { toast } from "sonner";
import { Eye, EyeOff, KeyRound, Save, RefreshCw } from "lucide-react";
import type { RedactedBillingConfig } from "@/lib/billing/config";

/**
 * Admin panel — Stripe API keys + mode toggle.
 *
 * Behaviour
 * - Loads /api/admin/billing/config and renders a redacted view.
 * - Each key field shows a masked indicator like `sk_…XXXX` when set.
 * - Editing a field marks it dirty; clicking Save sends only changed
 *   fields. An empty saved value clears the slot.
 * - The mode is a segmented control (Test | Live). Switching to a mode
 *   whose secret key is empty is disabled in the UI (the server would
 *   400 anyway, by design).
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
    label: "Test secret key",
    hint: "Server-side only. Used by Checkout and the Customer Portal.",
    placeholder: "sk_test_…",
    mask: true,
  },
  {
    name: "stripe_test_publishable_key",
    label: "Test publishable key",
    hint: "Safe for the browser. Used to render Stripe Elements.",
    placeholder: "pk_test_…",
  },
  {
    name: "stripe_test_webhook_secret",
    label: "Test webhook secret",
    hint: "From the Stripe webhook endpoint. Verifies incoming events.",
    placeholder: "whsec_…",
    mask: true,
  },
];

const LIVE_FIELDS: FieldDef[] = [
  {
    name: "stripe_live_secret_key",
    label: "Live secret key",
    hint: "Server-side only. Used by Checkout and the Customer Portal.",
    placeholder: "sk_live_…",
    mask: true,
  },
  {
    name: "stripe_live_publishable_key",
    label: "Live publishable key",
    hint: "Safe for the browser. Used to render Stripe Elements.",
    placeholder: "pk_live_…",
  },
  {
    name: "stripe_live_webhook_secret",
    label: "Live webhook secret",
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
  // Active tab follows the active mode by default; user can switch
  // independently to peek at the inactive set.
  const [tab, setTab] = useState<"test" | "live">(initial.stripe_mode);

  useEffect(() => setConfig(initial), [initial]);

  const isDirty = Object.keys(drafts).length > 0;
  const testHasSecret = config.stripe_test_secret_key_set;
  const liveHasSecret = config.stripe_live_secret_key_set;
  // Will the post-save state still allow switching to that mode? Counts
  // pending drafts so the toggle reflects the user's intent.
  const willHaveTestSecret =
    drafts.stripe_test_secret_key === undefined
      ? testHasSecret
      : !!drafts.stripe_test_secret_key;
  const willHaveLiveSecret =
    drafts.stripe_live_secret_key === undefined
      ? liveHasSecret
      : !!drafts.stripe_live_secret_key;

  async function patchConfig(body: Record<string, unknown>) {
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
        toast.error(e instanceof Error ? e.message : "Save failed.");
      }
    });
  }

  function setMode(target: "test" | "live") {
    if (target === config.stripe_mode) return;
    if (target === "live" && !liveHasSecret) return;
    if (target === "test" && !testHasSecret) return;
    startTransition(async () => {
      try {
        await patchConfig({ stripe_mode: target });
        toast.success(`Switched to ${target.toUpperCase()} mode.`);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Could not switch mode.");
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
    const status =
      draft === ""
        ? "Will clear on save."
        : draft && draft !== ""
          ? "Pending save."
          : isSet
            ? "Saved."
            : "Not set.";
    return (
      <div key={field.name} className="space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <Label htmlFor={field.name} className="text-sm font-medium">
            {field.label}
          </Label>
          {isSet ? (
            <Badge variant="secondary" className="font-mono text-[10px]">
              {tail ? `…${tail}` : "saved"}
            </Badge>
          ) : null}
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
            className="font-mono text-sm"
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
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">{field.hint}</span>
          <span
            className={
              draft !== undefined && draft !== ""
                ? "text-amber-600 dark:text-amber-400"
                : "text-muted-foreground"
            }
          >
            {status}
          </span>
        </div>
      </div>
    );
  }

  return (
    <TooltipProvider delayDuration={150}>
      <Card>
        <CardHeader className="space-y-1.5 pb-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                <KeyRound className="h-4 w-4" />
                Stripe configuration
              </CardTitle>
              <CardDescription className="mt-1">
                Manage test and live API credentials. The active mode determines
                which key set is used for Checkout, the Customer Portal, and
                webhook verification.
              </CardDescription>
            </div>
          </div>

          {/* Mode segmented control */}
          <div className="flex flex-wrap items-center gap-3 pt-2">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Active mode
            </span>
            <div
              role="radiogroup"
              aria-label="Active Stripe mode"
              className="inline-flex h-9 items-center gap-1 rounded-lg border border-border bg-muted/40 p-1"
            >
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={config.stripe_mode === "test"}
                    disabled={pending || !testHasSecret}
                    onClick={() => setMode("test")}
                    className={
                      "rounded-md px-3 py-1 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-50 " +
                      (config.stripe_mode === "test"
                        ? "bg-amber-500/15 text-amber-700 dark:text-amber-300"
                        : "text-muted-foreground hover:bg-muted")
                    }
                  >
                    TEST
                  </button>
                </TooltipTrigger>
                {!testHasSecret ? (
                  <TooltipContent>Add a test secret key first.</TooltipContent>
                ) : null}
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={config.stripe_mode === "live"}
                    disabled={pending || !liveHasSecret}
                    onClick={() => setMode("live")}
                    className={
                      "rounded-md px-3 py-1 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-50 " +
                      (config.stripe_mode === "live"
                        ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                        : "text-muted-foreground hover:bg-muted")
                    }
                  >
                    LIVE
                  </button>
                </TooltipTrigger>
                {!liveHasSecret ? (
                  <TooltipContent>Add a live secret key first.</TooltipContent>
                ) : null}
              </Tooltip>
            </div>
            {pending ? (
              <RefreshCw className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
            ) : null}
          </div>
        </CardHeader>

        <CardContent>
          <Tabs value={tab} onValueChange={(v) => setTab(v as "test" | "live")}>
            <TabsList className="mb-4">
              <TabsTrigger value="test" className="gap-1.5">
                Test keys
                <span
                  className={
                    "inline-block h-1.5 w-1.5 rounded-full " +
                    (willHaveTestSecret ? "bg-emerald-500" : "bg-muted-foreground/40")
                  }
                />
              </TabsTrigger>
              <TabsTrigger value="live" className="gap-1.5">
                Live keys
                <span
                  className={
                    "inline-block h-1.5 w-1.5 rounded-full " +
                    (willHaveLiveSecret ? "bg-emerald-500" : "bg-muted-foreground/40")
                  }
                />
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
                onClick={() => setDrafts({})}
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
