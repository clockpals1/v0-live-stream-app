"use client";

import { useEffect, useState, useTransition } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { Eye, EyeOff, KeyRound, Save } from "lucide-react";
import type { RedactedBillingConfig } from "@/lib/billing/config";

/**
 * Admin panel — Stripe API keys + mode toggle.
 *
 * Behaviour
 * - Loads /api/admin/billing/config and renders a redacted view.
 * - Each key field shows a masked indicator like `sk_…XXXX` when set.
 * - Editing a field marks it dirty; clicking Save sends only changed
 *   fields. An empty saved value clears the slot.
 * - The mode toggle (Test / Live) is its own quick action: a switch
 *   that PATCHes immediately.
 */

type FieldName =
  | "stripe_test_secret_key"
  | "stripe_test_publishable_key"
  | "stripe_test_webhook_secret"
  | "stripe_live_secret_key"
  | "stripe_live_publishable_key"
  | "stripe_live_webhook_secret";

const TEST_FIELDS: { name: FieldName; label: string; placeholder: string; mask?: boolean }[] = [
  { name: "stripe_test_secret_key", label: "Test secret key", placeholder: "sk_test_…", mask: true },
  { name: "stripe_test_publishable_key", label: "Test publishable key", placeholder: "pk_test_…" },
  { name: "stripe_test_webhook_secret", label: "Test webhook secret", placeholder: "whsec_…", mask: true },
];

const LIVE_FIELDS: { name: FieldName; label: string; placeholder: string; mask?: boolean }[] = [
  { name: "stripe_live_secret_key", label: "Live secret key", placeholder: "sk_live_…", mask: true },
  { name: "stripe_live_publishable_key", label: "Live publishable key", placeholder: "pk_live_…" },
  { name: "stripe_live_webhook_secret", label: "Live webhook secret", placeholder: "whsec_…", mask: true },
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

  useEffect(() => setConfig(initial), [initial]);

  const isDirty = Object.keys(drafts).length > 0;

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

  function onModeToggle(next: boolean) {
    const targetMode: "test" | "live" = next ? "live" : "test";
    startTransition(async () => {
      try {
        await patchConfig({ stripe_mode: targetMode });
        toast.success(`Switched to ${targetMode.toUpperCase()} mode.`);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Could not switch mode.");
      }
    });
  }

  function renderField(field: (typeof TEST_FIELDS)[number]) {
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
    return (
      <div key={field.name} className="space-y-1.5">
        <div className="flex items-center justify-between">
          <Label htmlFor={field.name} className="text-sm">
            {field.label}
          </Label>
          {isSet ? (
            <Badge variant="secondary" className="font-mono text-xs">
              {tail ? `…${tail}` : "saved"}
            </Badge>
          ) : (
            <Badge variant="outline" className="text-xs">
              not set
            </Badge>
          )}
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
        <p className="text-xs text-muted-foreground">
          {draft === ""
            ? "Will clear this slot on save."
            : isSet && draft === undefined
              ? "Saved. Type a new value to replace."
              : draft
                ? "Pending save."
                : ""}
        </p>
      </div>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <KeyRound className="h-4 w-4" />
              Stripe configuration
            </CardTitle>
            <CardDescription>
              Manage test and live keys. The active mode determines which key
              set is used for Checkout sessions, the Customer Portal, and
              webhook signature verification.
            </CardDescription>
          </div>
          <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/40 px-3 py-2">
            <span className="text-xs uppercase tracking-wide text-muted-foreground">
              Mode
            </span>
            <span
              className={
                config.stripe_mode === "live"
                  ? "text-sm font-semibold text-emerald-600 dark:text-emerald-400"
                  : "text-sm font-semibold text-amber-600 dark:text-amber-400"
              }
            >
              {config.stripe_mode.toUpperCase()}
            </span>
            <Switch
              aria-label="Toggle live mode"
              checked={config.stripe_mode === "live"}
              disabled={pending}
              onCheckedChange={onModeToggle}
            />
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="test">
          <TabsList className="mb-4">
            <TabsTrigger value="test">
              Test keys
              {(config.stripe_test_secret_key_set ||
                config.stripe_test_publishable_key_set ||
                config.stripe_test_webhook_secret_set) && (
                <span className="ml-1.5 inline-block h-1.5 w-1.5 rounded-full bg-emerald-500" />
              )}
            </TabsTrigger>
            <TabsTrigger value="live">
              Live keys
              {(config.stripe_live_secret_key_set ||
                config.stripe_live_publishable_key_set ||
                config.stripe_live_webhook_secret_set) && (
                <span className="ml-1.5 inline-block h-1.5 w-1.5 rounded-full bg-emerald-500" />
              )}
            </TabsTrigger>
          </TabsList>
          <TabsContent value="test" className="space-y-4">
            {TEST_FIELDS.map(renderField)}
          </TabsContent>
          <TabsContent value="live" className="space-y-4">
            {LIVE_FIELDS.map(renderField)}
          </TabsContent>
        </Tabs>
        <div className="mt-6 flex items-center justify-end gap-2">
          {isDirty ? (
            <Button
              variant="ghost"
              onClick={() => setDrafts({})}
              disabled={pending}
            >
              Discard changes
            </Button>
          ) : null}
          <Button onClick={onSave} disabled={!isDirty || pending}>
            <Save className="mr-2 h-4 w-4" />
            {pending ? "Saving…" : "Save changes"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
