"use client";

/**
 * StreamOperatorsPanel
 * --------------------
 * Admin-only card that lives at the top of a host stream page and lets
 * admins assign / remove Super User operators for THIS stream.
 *
 * Per-stream scoping: this panel only reads and writes rows of
 * `stream_operators` keyed to the stream whose id is passed in. Operators
 * get access to this stream only; removing a row here does not affect
 * their access on any other stream.
 *
 * Only accounts whose role is 'superuser' are offered in the add dropdown,
 * to keep the UX honest — admins already have global operate rights and
 * co-hosts are broadcasters, not operators. The server-side API also
 * rejects co-host assignments defensively.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
import { Badge } from "@/components/ui/badge";
import {
  Loader2,
  Plus,
  Shield,
  Trash2,
  UserCog,
} from "lucide-react";
import { ROLE_LABELS } from "@/lib/rbac";

interface Operator {
  id: string;
  assigned_at: string;
  host: {
    id: string;
    display_name: string | null;
    email: string;
    role: string;
  } | null;
}

interface HostSummary {
  id: string;
  display_name: string | null;
  email: string;
  role: string;
}

interface Props {
  streamId: string;
}

export function StreamOperatorsPanel({ streamId }: Props) {
  const [operators, setOperators] = useState<Operator[]>([]);
  const [candidates, setCandidates] = useState<HostSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedHostId, setSelectedHostId] = useState<string>("");
  const [adding, setAdding] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);

  const loadOperators = useCallback(async () => {
    try {
      const res = await fetch(`/api/admin/streams/${streamId}/operators`);
      if (!res.ok) return;
      const json = (await res.json()) as { operators?: Operator[] };
      setOperators(json.operators ?? []);
    } catch {
      /* swallow — panel is non-critical, banner elsewhere surfaces role */
    }
  }, [streamId]);

  const loadCandidates = useCallback(async () => {
    try {
      const res = await fetch(`/api/admin/hosts`);
      if (!res.ok) return;
      const json = (await res.json()) as { hosts?: HostSummary[] };
      // Only superusers are valid candidates. Admins already have implicit
      // operator rights on every stream; co-hosts cannot operate by design.
      setCandidates(
        (json.hosts ?? []).filter((h) => h.role === "superuser")
      );
    } catch {
      /* non-fatal */
    }
  }, []);

  useEffect(() => {
    let mounted = true;
    (async () => {
      setLoading(true);
      await Promise.all([loadOperators(), loadCandidates()]);
      if (mounted) setLoading(false);
    })();
    return () => {
      mounted = false;
    };
  }, [loadOperators, loadCandidates]);

  // Hide already-assigned candidates from the add dropdown so the admin
  // doesn't hit a 409 duplicate error on every click.
  const assignedHostIds = useMemo(
    () => new Set(operators.map((o) => o.host?.id).filter(Boolean) as string[]),
    [operators]
  );
  const unassignedCandidates = useMemo(
    () => candidates.filter((c) => !assignedHostIds.has(c.id)),
    [candidates, assignedHostIds]
  );

  const handleAdd = async () => {
    if (!selectedHostId) return;
    setAdding(true);
    try {
      const res = await fetch(`/api/admin/streams/${streamId}/operators`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ host_id: selectedHostId }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        operator?: Operator;
        error?: string;
      };
      if (!res.ok) {
        toast.error(json.error ?? "Failed to assign operator");
        return;
      }
      if (json.operator) {
        setOperators((prev) => [...prev, json.operator as Operator]);
      }
      setSelectedHostId("");
      toast.success("Operator assigned");
    } finally {
      setAdding(false);
    }
  };

  const handleRemove = async (op: Operator) => {
    if (!op.host?.id) return;
    setRemovingId(op.id);
    try {
      const res = await fetch(
        `/api/admin/streams/${streamId}/operators?host_id=${encodeURIComponent(op.host.id)}`,
        { method: "DELETE" }
      );
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error(json.error ?? "Failed to remove operator");
        return;
      }
      setOperators((prev) => prev.filter((o) => o.id !== op.id));
      toast.success("Operator removed");
    } finally {
      setRemovingId(null);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <UserCog className="w-4 h-4 text-purple-600" />
          Stream Operators
          <Badge variant="secondary" className="text-xs">
            {operators.length}
          </Badge>
        </CardTitle>
        <CardDescription className="text-xs">
          Assign Super Users to operate this stream. Operators can manage
          overlays, music, ticker, slideshow, and co-hosts, but cannot
          broadcast.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Assign new */}
        <div className="flex flex-col sm:flex-row gap-2">
          <Select
            value={selectedHostId}
            onValueChange={setSelectedHostId}
            disabled={loading || unassignedCandidates.length === 0}
          >
            <SelectTrigger className="h-9 flex-1">
              <SelectValue
                placeholder={
                  loading
                    ? "Loading…"
                    : unassignedCandidates.length === 0
                    ? "No Super Users available"
                    : "Select a Super User to assign"
                }
              />
            </SelectTrigger>
            <SelectContent>
              {unassignedCandidates.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  <div className="flex flex-col text-left">
                    <span className="font-medium">
                      {c.display_name || c.email}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {c.email}
                    </span>
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            size="sm"
            onClick={handleAdd}
            disabled={!selectedHostId || adding}
          >
            {adding ? (
              <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
            ) : (
              <Plus className="w-4 h-4 mr-1.5" />
            )}
            Assign
          </Button>
        </div>

        {/* Existing list */}
        {operators.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No operators assigned to this stream yet.
          </p>
        ) : (
          <ul className="divide-y divide-border rounded-md border border-border">
            {operators.map((op) => (
              <li
                key={op.id}
                className="flex items-center justify-between gap-2 px-3 py-2"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <Shield className="w-4 h-4 text-purple-600 shrink-0" />
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate">
                      {op.host?.display_name || op.host?.email || "Unknown"}
                    </div>
                    <div className="text-xs text-muted-foreground truncate">
                      {op.host?.email} ·{" "}
                      {op.host
                        ? ROLE_LABELS[op.host.role as keyof typeof ROLE_LABELS] ??
                          op.host.role
                        : "—"}
                    </div>
                  </div>
                </div>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-destructive hover:text-destructive"
                      disabled={removingId === op.id}
                    >
                      {removingId === op.id ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Trash2 className="w-4 h-4" />
                      )}
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Remove operator?</AlertDialogTitle>
                      <AlertDialogDescription>
                        <strong>
                          {op.host?.display_name || op.host?.email}
                        </strong>{" "}
                        will no longer be able to manage this stream. Their
                        access to other streams is unaffected.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={() => handleRemove(op)}
                        className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                      >
                        Remove
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
