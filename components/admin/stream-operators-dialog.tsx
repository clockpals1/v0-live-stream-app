"use client";

/**
 * Dialog for assigning Super Users / operators to a specific stream.
 *
 * Accessible to:
 *   - platform admins  (can manage any stream)
 *   - the stream owner (can manage their own stream) — since migration 017
 *
 * Writes go through /api/admin/streams/[streamId]/operators — which now
 * enforces admin OR stream-owner at both the API and RLS layers.
 *
 * The candidate list is loaded from /api/admin/hosts when the caller is an
 * admin, falling back to /api/hosts/directory for non-admin stream owners.
 * The dialog also accepts controlled `open` / `onOpenChange` props so callers
 * (e.g. the host dashboard) can open it programmatically after creating a
 * new stream.
 */

import { useEffect, useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Loader2, ShieldCheck, Trash2, UserPlus } from "lucide-react";
import { ROLE_LABELS, type Role } from "@/lib/rbac";

interface HostRow {
  id: string;
  display_name: string | null;
  email: string;
  role: Role | null;
}

interface OperatorRow {
  id: string;
  host_id: string;
  created_at: string;
  host: { id: string; display_name: string | null; email: string; role: Role | null };
}

interface Props {
  streamId: string;
  streamTitle: string;
  trigger?: React.ReactNode;
  /** Controlled open state — lets callers drive the dialog programmatically. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function StreamOperatorsDialog({
  streamId,
  streamTitle,
  trigger,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
}: Props) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? (controlledOpen as boolean) : uncontrolledOpen;
  const setOpen = (next: boolean) => {
    if (!isControlled) setUncontrolledOpen(next);
    controlledOnOpenChange?.(next);
  };
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [operators, setOperators] = useState<OperatorRow[]>([]);
  const [allHosts, setAllHosts] = useState<HostRow[]>([]);
  const [selectedHostId, setSelectedHostId] = useState<string>("");
  const [notSetUp, setNotSetUp] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setNotSetUp(false);
    try {
      const [opsRes, adminHostsRes] = await Promise.all([
        fetch(`/api/admin/streams/${streamId}/operators`),
        fetch(`/api/admin/hosts`),
      ]);

      if (opsRes.status === 501) {
        setNotSetUp(true);
        setLoading(false);
        return;
      }

      const opsBody = await opsRes.json();
      if (!opsRes.ok) {
        toast.error(opsBody.error || "Failed to load operators");
      } else {
        setOperators(opsBody.operators || []);
      }

      // Hosts list: admins get the full directory from /api/admin/hosts.
      // Non-admin stream owners fall back to /api/hosts/directory which is
      // open to any authenticated host and already excludes admins.
      if (adminHostsRes.ok) {
        const body = await adminHostsRes.json();
        setAllHosts(body.hosts || []);
      } else if (adminHostsRes.status === 401 || adminHostsRes.status === 403) {
        const dirRes = await fetch(`/api/hosts/directory`);
        if (dirRes.ok) {
          const body = await dirRes.json();
          setAllHosts(body.hosts || []);
        }
      }
    } catch (err: any) {
      toast.error("Load failed: " + (err?.message ?? "unknown"));
    } finally {
      setLoading(false);
    }
  }, [streamId]);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  const assignedHostIds = new Set(operators.map((o) => o.host_id));
  const candidateHosts = allHosts.filter(
    (h) => !assignedHostIds.has(h.id) && h.role !== "admin",
  );

  const assign = async () => {
    if (!selectedHostId) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/streams/${streamId}/operators`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hostId: selectedHostId }),
      });
      const body = await res.json();
      if (!res.ok) {
        if (res.status === 501) {
          setNotSetUp(true);
          return;
        }
        toast.error(body.error || "Assign failed");
        return;
      }
      toast.success("Operator assigned");
      setOperators((prev) => [...prev, body.operator]);
      setSelectedHostId("");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (op: OperatorRow) => {
    setRemovingId(op.id);
    try {
      const res = await fetch(
        `/api/admin/streams/${streamId}/operators/${op.id}`,
        { method: "DELETE" },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        toast.error(body.error || "Remove failed");
        return;
      }
      toast.success("Operator removed");
      setOperators((prev) => prev.filter((o) => o.id !== op.id));
    } finally {
      setRemovingId(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {/* When controlled externally without an explicit trigger, skip the
          default trigger button entirely so it doesn't leak into the calling
          page. The caller is responsible for opening the dialog. */}
      {!(isControlled && !trigger) && (
        <DialogTrigger asChild>
          {trigger ?? (
            <Button variant="outline" size="sm">
              <ShieldCheck className="w-4 h-4 mr-1.5" />
              Super Users
            </Button>
          )}
        </DialogTrigger>
      )}
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-amber-500" />
            Super Users — {streamTitle}
          </DialogTitle>
          <DialogDescription>
            Assigned Super Users can manage overlays, ticker, music, co-hosts, and send private messages
            for this stream. They cannot go live or create streams.
          </DialogDescription>
        </DialogHeader>

        {notSetUp ? (
          <div className="p-4 border border-amber-500/30 bg-amber-500/5 rounded-md text-xs">
            Super-User tables are not yet set up on the database. Please apply{" "}
            <code className="font-mono">016_super_user_role.sql</code> on your Supabase project, then reload.
          </div>
        ) : (
          <>
            <div className="flex flex-col gap-2">
              <label className="text-xs font-medium">Assign a user as operator:</label>
              <div className="flex gap-2">
                <Select value={selectedHostId} onValueChange={setSelectedHostId}>
                  <SelectTrigger className="flex-1">
                    <SelectValue placeholder="Pick a user…" />
                  </SelectTrigger>
                  <SelectContent>
                    {candidateHosts.length === 0 ? (
                      <SelectItem value="__none__" disabled>
                        No eligible users
                      </SelectItem>
                    ) : (
                      candidateHosts.map((h) => (
                        <SelectItem key={h.id} value={h.id}>
                          {h.display_name || h.email}
                          {h.role && (
                            <span className="ml-2 text-xs text-muted-foreground">
                              ({ROLE_LABELS[h.role]})
                            </span>
                          )}
                        </SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
                <Button onClick={assign} disabled={!selectedHostId || saving}>
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserPlus className="w-4 h-4" />}
                </Button>
              </div>
              <p className="text-[11px] text-muted-foreground">
                Admins can manage any stream without an assignment — only assign non-admin users here.
              </p>
            </div>

            <div className="flex flex-col gap-2 mt-4">
              <div className="text-xs font-medium">
                Currently assigned ({operators.length})
              </div>
              {loading ? (
                <div className="flex justify-center py-6">
                  <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                </div>
              ) : operators.length === 0 ? (
                <p className="text-xs text-muted-foreground py-4 text-center">
                  No Super Users assigned to this stream yet.
                </p>
              ) : (
                <div className="flex flex-col gap-1.5 max-h-64 overflow-y-auto">
                  {operators.map((op) => (
                    <div
                      key={op.id}
                      className="flex items-center gap-2 p-2 rounded border border-border bg-muted/20"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="text-sm truncate">
                          {op.host.display_name || op.host.email}
                        </div>
                        <div className="text-[11px] text-muted-foreground truncate">{op.host.email}</div>
                      </div>
                      {op.host.role && (
                        <Badge variant="outline" className="text-[10px] h-5">
                          {ROLE_LABELS[op.host.role]}
                        </Badge>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 p-0 text-red-500"
                        onClick={() => remove(op)}
                        disabled={removingId === op.id}
                      >
                        {removingId === op.id ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Trash2 className="w-3.5 h-3.5" />
                        )}
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
