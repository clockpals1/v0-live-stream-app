"use client";

/**
 * AdminPanel — User Management page body.
 *
 * UI/UX redesign (presentation only — no business-logic changes).
 *
 * Layout
 * ------
 *  [ Header strip ]
 *    title + subtitle | role-count chips (also act as filters) | Add User CTA
 *  [ Toolbar card ]
 *    search box (name/email) | role filter Select | refresh
 *  [ Listing card ]
 *    desktop ≥md → table (User / Email / Role / Joined / Actions)
 *    mobile  <md → stacked rows (mirroring the table fields)
 *
 * Constraints preserved exactly
 *  - cannot demote your own admin
 *  - cannot demote the last admin
 *  - cannot remove yourself
 *  - cannot remove an admin (must be demoted first)
 *  - promoting to admin requires confirmation
 *
 * All mutations still hit /api/admin/hosts and /api/admin/hosts/[hostId].
 */

import { useState, useEffect, useCallback, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import {
  UserPlus,
  Trash2,
  Loader2,
  ShieldCheck,
  User,
  Users,
  Search,
  RefreshCw,
  MoreHorizontal,
  Eye,
  EyeOff,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
} from "lucide-react";
import { ROLE_LABELS, ROLE_DESCRIPTIONS, resolveRole, type Role } from "@/lib/rbac";

// ─── Types ──────────────────────────────────────────────────────────────────

interface Host {
  id: string;
  user_id: string;
  email: string;
  display_name: string | null;
  role?: Role | null;
  is_admin?: boolean;
  created_at: string;
}

interface AdminPanelProps {
  currentUserId: string;
}

type RoleFilter = "all" | Role;
type SortKey = "name" | "joined";
type SortDir = "asc" | "desc";

// ─── Helpers ────────────────────────────────────────────────────────────────

function relativeDate(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "—";
  const diff = Date.now() - then;
  const day = 24 * 60 * 60 * 1000;
  if (diff < day) return "today";
  if (diff < 2 * day) return "yesterday";
  if (diff < 30 * day) return `${Math.floor(diff / day)} days ago`;
  if (diff < 365 * day) return `${Math.floor(diff / (30 * day))} mo ago`;
  return `${Math.floor(diff / (365 * day))}y ago`;
}

function roleBadgeClass(role: Role): string {
  switch (role) {
    case "admin":
      return "bg-primary/10 text-primary border-primary/20";
    case "cohost":
      return "bg-purple-500/10 text-purple-600 border-purple-500/20";
    case "super_user":
      return "bg-amber-500/10 text-amber-600 border-amber-500/20";
    case "host":
    default:
      return "bg-muted text-foreground border-border";
  }
}

function roleIcon(role: Role) {
  switch (role) {
    case "admin":
    case "super_user":
      return ShieldCheck;
    case "cohost":
      return Users;
    case "host":
    default:
      return User;
  }
}

// ─── Component ──────────────────────────────────────────────────────────────

export function AdminPanel({ currentUserId }: AdminPanelProps) {
  const [hosts, setHosts] = useState<Host[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [roleSavingId, setRoleSavingId] = useState<string | null>(null);
  const [pendingRole, setPendingRole] = useState<Record<string, Role>>({});
  const [removeTarget, setRemoveTarget] = useState<Host | null>(null);

  // Toolbar state
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<RoleFilter>("all");
  const [sortKey, setSortKey] = useState<SortKey>("joined");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  // Add-user dialog state
  const [addOpen, setAddOpen] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [form, setForm] = useState<{
    email: string;
    displayName: string;
    password: string;
    role: Exclude<Role, "admin">;
  }>({
    email: "",
    displayName: "",
    password: "",
    role: "host",
  });

  // ─── Data ──────────────────────────────────────────────────────────────────

  const loadHosts = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch("/api/admin/hosts");
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg =
          data?.error ||
          `Server returned ${res.status} ${res.statusText || ""}`.trim();
        setLoadError(msg);
        // Don't toast here — the inline error card is more actionable.
        return;
      }
      setHosts(data.hosts || []);
    } catch (e) {
      const msg =
        e instanceof Error ? e.message : "Network error while loading users";
      setLoadError(msg);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadHosts();
  }, [loadHosts]);

  // ─── Derived ───────────────────────────────────────────────────────────────

  const counts = useMemo(() => {
    const acc: Record<Role, number> = {
      admin: 0,
      host: 0,
      cohost: 0,
      super_user: 0,
    };
    for (const h of hosts) acc[resolveRole(h)]++;
    return acc;
  }, [hosts]);

  const adminCount = counts.admin;

  const visibleHosts = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = hosts;
    if (q) {
      list = list.filter(
        (h) =>
          (h.display_name || "").toLowerCase().includes(q) ||
          h.email.toLowerCase().includes(q),
      );
    }
    if (roleFilter !== "all") {
      list = list.filter((h) => resolveRole(h) === roleFilter);
    }
    const dir = sortDir === "asc" ? 1 : -1;
    return [...list].sort((a, b) => {
      if (sortKey === "name") {
        const an = (a.display_name || a.email).toLowerCase();
        const bn = (b.display_name || b.email).toLowerCase();
        return an < bn ? -1 * dir : an > bn ? 1 * dir : 0;
      }
      // joined
      const at = new Date(a.created_at).getTime();
      const bt = new Date(b.created_at).getTime();
      return (at - bt) * dir;
    });
  }, [hosts, search, roleFilter, sortKey, sortDir]);

  // ─── Mutations (logic unchanged) ──────────────────────────────────────────

  const handleAddHost = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.email || !form.displayName || !form.password) return;

    setSubmitting(true);
    try {
      const res = await fetch("/api/admin/hosts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: form.email,
          displayName: form.displayName,
          password: form.password,
          role: form.role,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Failed to create user");
        return;
      }

      toast.success(
        `${ROLE_LABELS[form.role]} "${form.displayName}" created. They can now log in.`,
      );
      setForm({ email: "", displayName: "", password: "", role: "host" });
      setAddOpen(false);
      await loadHosts();
    } catch {
      toast.error("An unexpected error occurred");
    } finally {
      setSubmitting(false);
    }
  };

  const handleRemoveHost = async (host: Host) => {
    setRemovingId(host.id);
    try {
      const res = await fetch(`/api/admin/hosts/${host.id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Failed to remove user");
        return;
      }
      toast.success(`User "${host.display_name || host.email}" removed`);
      setHosts((prev) => prev.filter((h) => h.id !== host.id));
    } catch {
      toast.error("An unexpected error occurred");
    } finally {
      setRemovingId(null);
      setRemoveTarget(null);
    }
  };

  const handleChangeRole = async (host: Host, nextRole: Role) => {
    const currentRole = resolveRole(host);
    if (nextRole === currentRole) return;

    if (host.user_id === currentUserId && currentRole === "admin" && nextRole !== "admin") {
      toast.error("You cannot demote your own admin account.");
      clearPending(host.id);
      return;
    }
    if (currentRole === "admin" && nextRole !== "admin" && adminCount <= 1) {
      toast.error("Cannot demote the last remaining admin.");
      clearPending(host.id);
      return;
    }

    setRoleSavingId(host.id);
    try {
      const res = await fetch(`/api/admin/hosts/${host.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: nextRole }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Failed to change role");
        return;
      }
      toast.success(
        `${host.display_name || host.email} is now ${ROLE_LABELS[nextRole]}.`,
      );
      setHosts((prev) =>
        prev.map((h) =>
          h.id === host.id ? { ...h, role: nextRole, is_admin: nextRole === "admin" } : h,
        ),
      );
      clearPending(host.id);
    } catch {
      toast.error("An unexpected error occurred");
    } finally {
      setRoleSavingId(null);
    }
  };

  const clearPending = (id: string) => {
    setPendingRole((prev) => {
      const { [id]: _removed, ...rest } = prev;
      return rest;
    });
  };

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "joined" ? "desc" : "asc");
    }
  };

  const SortIcon = ({ col }: { col: SortKey }) =>
    sortKey !== col ? (
      <ArrowUpDown className="ml-1 h-3 w-3 opacity-50" />
    ) : sortDir === "asc" ? (
      <ArrowUp className="ml-1 h-3 w-3" />
    ) : (
      <ArrowDown className="ml-1 h-3 w-3" />
    );

  const filtersActive = search.length > 0 || roleFilter !== "all";

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <TooltipProvider delayDuration={150}>
      <div className="space-y-6">
        {/* ── Header strip ─────────────────────────────────────────────── */}
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
              <ShieldCheck className="w-6 h-6 text-primary" />
              User Management
            </h1>
            <p className="text-muted-foreground mt-1 text-sm">
              Create accounts, change roles, and remove users. Role changes take effect immediately.
            </p>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <CountChip
              label="Total"
              value={hosts.length}
              active={roleFilter === "all"}
              onClick={() => setRoleFilter("all")}
            />
            <CountChip
              label="Admins"
              value={counts.admin}
              tone="primary"
              active={roleFilter === "admin"}
              onClick={() => setRoleFilter(roleFilter === "admin" ? "all" : "admin")}
            />
            <CountChip
              label="Hosts"
              value={counts.host}
              active={roleFilter === "host"}
              onClick={() => setRoleFilter(roleFilter === "host" ? "all" : "host")}
            />
            <CountChip
              label="Co-hosts"
              value={counts.cohost}
              tone="purple"
              active={roleFilter === "cohost"}
              onClick={() => setRoleFilter(roleFilter === "cohost" ? "all" : "cohost")}
            />
            <CountChip
              label="Super Users"
              value={counts.super_user}
              tone="amber"
              active={roleFilter === "super_user"}
              onClick={() =>
                setRoleFilter(roleFilter === "super_user" ? "all" : "super_user")
              }
            />

            <Dialog open={addOpen} onOpenChange={setAddOpen}>
              <DialogTrigger asChild>
                <Button size="sm" className="ml-1">
                  <UserPlus className="w-4 h-4 mr-1.5" />
                  Add User
                </Button>
              </DialogTrigger>
              <AddUserDialog
                form={form}
                setForm={setForm}
                submitting={submitting}
                showPassword={showPassword}
                setShowPassword={setShowPassword}
                onSubmit={handleAddHost}
                onCancel={() => setAddOpen(false)}
              />
            </Dialog>
          </div>
        </div>

        {/* ── Toolbar + Listing card ───────────────────────────────────── */}
        <Card>
          <CardHeader className="border-b">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div className="relative flex-1 max-w-md">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  placeholder="Search name or email…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-9"
                />
              </div>
              <div className="flex items-center gap-2">
                <Select
                  value={roleFilter}
                  onValueChange={(v) => setRoleFilter(v as RoleFilter)}
                >
                  <SelectTrigger className="w-[160px] h-9">
                    <SelectValue placeholder="All roles" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All roles</SelectItem>
                    <SelectItem value="admin">{ROLE_LABELS.admin}</SelectItem>
                    <SelectItem value="host">{ROLE_LABELS.host}</SelectItem>
                    <SelectItem value="cohost">{ROLE_LABELS.cohost}</SelectItem>
                    <SelectItem value="super_user">{ROLE_LABELS.super_user}</SelectItem>
                  </SelectContent>
                </Select>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={loadHosts}
                      disabled={loading}
                      aria-label="Refresh"
                    >
                      <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Refresh</TooltipContent>
                </Tooltip>
              </div>
            </div>
            {filtersActive && !loading && (
              <div className="text-xs text-muted-foreground">
                Showing <span className="font-medium text-foreground">{visibleHosts.length}</span> of{" "}
                {hosts.length}
                {" · "}
                <button
                  className="underline-offset-2 hover:underline"
                  onClick={() => {
                    setSearch("");
                    setRoleFilter("all");
                  }}
                >
                  Clear filters
                </button>
              </div>
            )}
          </CardHeader>

          <CardContent className="p-0">
            {loadError && !loading ? (
              <ErrorState message={loadError} onRetry={loadHosts} />
            ) : loading ? (
              <ListingSkeleton />
            ) : hosts.length === 0 ? (
              <EmptyState
                title="No users yet"
                body="Add your first user to get started."
                action={
                  <Button onClick={() => setAddOpen(true)}>
                    <UserPlus className="w-4 h-4 mr-1.5" />
                    Add User
                  </Button>
                }
              />
            ) : visibleHosts.length === 0 ? (
              <EmptyState
                title="No matches"
                body="No users match the current search or filter."
                action={
                  <Button
                    variant="outline"
                    onClick={() => {
                      setSearch("");
                      setRoleFilter("all");
                    }}
                  >
                    Clear filters
                  </Button>
                }
              />
            ) : (
              <>
                {/* Desktop table ≥md */}
                <div className="hidden md:block">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-muted/30 text-xs uppercase tracking-wide text-muted-foreground">
                        <th className="text-left font-medium px-6 py-3">
                          <button
                            onClick={() => toggleSort("name")}
                            className="inline-flex items-center hover:text-foreground"
                          >
                            User <SortIcon col="name" />
                          </button>
                        </th>
                        <th className="text-left font-medium px-6 py-3">Email</th>
                        <th className="text-left font-medium px-6 py-3">Role</th>
                        <th className="text-left font-medium px-6 py-3">
                          <button
                            onClick={() => toggleSort("joined")}
                            className="inline-flex items-center hover:text-foreground"
                          >
                            Joined <SortIcon col="joined" />
                          </button>
                        </th>
                        <th className="px-6 py-3 w-12"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {visibleHosts.map((host) => (
                        <UserRow
                          key={host.id}
                          host={host}
                          currentUserId={currentUserId}
                          adminCount={adminCount}
                          pendingRole={pendingRole[host.id]}
                          isSaving={roleSavingId === host.id}
                          isRemoving={removingId === host.id}
                          onPickRole={(next) => {
                            if (next === "admin" && resolveRole(host) !== "admin") {
                              setPendingRole((p) => ({ ...p, [host.id]: next }));
                            } else {
                              setPendingRole((p) => ({ ...p, [host.id]: next }));
                              handleChangeRole(host, next);
                            }
                          }}
                          onCancelPromote={() => clearPending(host.id)}
                          onConfirmPromote={() => handleChangeRole(host, "admin")}
                          onRequestRemove={() => setRemoveTarget(host)}
                        />
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Mobile cards <md */}
                <div className="md:hidden divide-y">
                  {visibleHosts.map((host) => (
                    <UserCard
                      key={host.id}
                      host={host}
                      currentUserId={currentUserId}
                      adminCount={adminCount}
                      pendingRole={pendingRole[host.id]}
                      isSaving={roleSavingId === host.id}
                      isRemoving={removingId === host.id}
                      onPickRole={(next) => {
                        if (next === "admin" && resolveRole(host) !== "admin") {
                          setPendingRole((p) => ({ ...p, [host.id]: next }));
                        } else {
                          setPendingRole((p) => ({ ...p, [host.id]: next }));
                          handleChangeRole(host, next);
                        }
                      }}
                      onCancelPromote={() => clearPending(host.id)}
                      onConfirmPromote={() => handleChangeRole(host, "admin")}
                      onRequestRemove={() => setRemoveTarget(host)}
                    />
                  ))}
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {/* ── Remove confirmation ──────────────────────────────────────── */}
        <AlertDialog
          open={!!removeTarget}
          onOpenChange={(open) => {
            if (!open) setRemoveTarget(null);
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Remove user?</AlertDialogTitle>
              <AlertDialogDescription>
                This will permanently remove{" "}
                <strong>
                  {removeTarget?.display_name || removeTarget?.email}
                </strong>{" "}
                and delete their account. Their past streams will remain. This
                action cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => removeTarget && handleRemoveHost(removeTarget)}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                Remove
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </TooltipProvider>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function CountChip({
  label,
  value,
  active,
  onClick,
  tone = "default",
}: {
  label: string;
  value: number;
  active: boolean;
  onClick: () => void;
  tone?: "default" | "primary" | "purple" | "amber";
}) {
  const toneCls =
    active && tone === "primary"
      ? "bg-primary/10 border-primary/30 text-primary"
      : active && tone === "purple"
      ? "bg-purple-500/10 border-purple-500/30 text-purple-600"
      : active && tone === "amber"
      ? "bg-amber-500/10 border-amber-500/30 text-amber-600"
      : active
      ? "bg-foreground/5 border-foreground/20 text-foreground"
      : "bg-background border-border text-muted-foreground hover:text-foreground hover:border-foreground/30";
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors ${toneCls}`}
    >
      <span>{label}</span>
      <span className="rounded-md bg-foreground/10 px-1.5 py-0.5 text-[10px] font-semibold">
        {value}
      </span>
    </button>
  );
}

function ListingSkeleton() {
  return (
    <div className="divide-y">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 px-6 py-4">
          <Skeleton className="h-10 w-10 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3.5 w-40" />
            <Skeleton className="h-3 w-56" />
          </div>
          <Skeleton className="h-8 w-28" />
          <Skeleton className="h-8 w-8 rounded" />
        </div>
      ))}
    </div>
  );
}

function ErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center text-center px-6 py-14">
      <div className="w-12 h-12 rounded-full bg-destructive/10 flex items-center justify-center mb-4">
        <ShieldCheck className="w-6 h-6 text-destructive" />
      </div>
      <p className="font-medium text-foreground">Couldn&apos;t load users</p>
      <p className="text-sm text-muted-foreground mt-1 max-w-md break-words">
        {message}
      </p>
      <div className="mt-4 flex gap-2">
        <Button variant="outline" onClick={onRetry}>
          <RefreshCw className="w-4 h-4 mr-2" />
          Try again
        </Button>
      </div>
      <p className="text-xs text-muted-foreground mt-4 max-w-md">
        If this keeps happening, check that{" "}
        <code className="px-1 py-0.5 bg-muted rounded">SUPABASE_SERVICE_ROLE_KEY</code>{" "}
        is set as an encrypted environment variable for the Production environment
        on Cloudflare Pages, then redeploy.
      </p>
    </div>
  );
}

function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center text-center px-6 py-16">
      <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mb-4">
        <Users className="w-6 h-6 text-muted-foreground" />
      </div>
      <p className="font-medium text-foreground">{title}</p>
      <p className="text-sm text-muted-foreground mt-1 max-w-sm">{body}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

interface RowProps {
  host: Host;
  currentUserId: string;
  adminCount: number;
  pendingRole: Role | undefined;
  isSaving: boolean;
  isRemoving: boolean;
  onPickRole: (next: Role) => void;
  onCancelPromote: () => void;
  onConfirmPromote: () => void;
  onRequestRemove: () => void;
}

function UserRow(props: RowProps) {
  const {
    host,
    currentUserId,
    adminCount,
    pendingRole,
    isSaving,
    isRemoving,
    onPickRole,
    onCancelPromote,
    onConfirmPromote,
    onRequestRemove,
  } = props;

  const role = resolveRole(host);
  const isSelf = host.user_id === currentUserId;
  const isLastAdmin = role === "admin" && adminCount <= 1;
  const roleLocked = isSelf || isLastAdmin;
  const lockReason = isSelf
    ? "You cannot change your own role."
    : isLastAdmin
    ? "Promote another user to admin first."
    : null;
  const selectValue: Role = pendingRole ?? role;
  const isPromotingToAdmin = pendingRole === "admin" && role !== "admin";
  const RoleIcon = roleIcon(role);

  return (
    <tr className="border-b last:border-0 hover:bg-muted/30 transition-colors">
      <td className="px-6 py-4">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
            <span className="text-primary font-semibold text-sm">
              {(host.display_name || host.email).charAt(0).toUpperCase()}
            </span>
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-medium text-foreground truncate">
                {host.display_name || "—"}
              </span>
              {isSelf && (
                <Badge variant="secondary" className="text-[10px] h-5">
                  You
                </Badge>
              )}
            </div>
          </div>
        </div>
      </td>
      <td className="px-6 py-4 text-muted-foreground">
        <span className="truncate inline-block max-w-[280px] align-middle">{host.email}</span>
      </td>
      <td className="px-6 py-4">
        <div className="flex items-center gap-2">
          <Badge className={`${roleBadgeClass(role)} gap-1 text-xs`}>
            <RoleIcon className="w-3 h-3" />
            {ROLE_LABELS[role]}
          </Badge>
          <RolePicker
            value={selectValue}
            disabled={roleLocked || isSaving}
            lockReason={lockReason}
            onChange={onPickRole}
          />
          {isSaving && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
        </div>
        {isPromotingToAdmin && (
          <PromoteAdminDialog
            host={host}
            onCancel={onCancelPromote}
            onConfirm={onConfirmPromote}
          />
        )}
      </td>
      <td
        className="px-6 py-4 text-muted-foreground text-sm"
        title={new Date(host.created_at).toLocaleString()}
      >
        {relativeDate(host.created_at)}
      </td>
      <td className="px-6 py-4 text-right">
        <RowMenu
          canRemove={role !== "admin" && !isSelf}
          isRemoving={isRemoving}
          onRemove={onRequestRemove}
          email={host.email}
        />
      </td>
    </tr>
  );
}

function UserCard(props: RowProps) {
  const {
    host,
    currentUserId,
    adminCount,
    pendingRole,
    isSaving,
    isRemoving,
    onPickRole,
    onCancelPromote,
    onConfirmPromote,
    onRequestRemove,
  } = props;

  const role = resolveRole(host);
  const isSelf = host.user_id === currentUserId;
  const isLastAdmin = role === "admin" && adminCount <= 1;
  const roleLocked = isSelf || isLastAdmin;
  const lockReason = isSelf
    ? "You cannot change your own role."
    : isLastAdmin
    ? "Promote another user to admin first."
    : null;
  const selectValue: Role = pendingRole ?? role;
  const isPromotingToAdmin = pendingRole === "admin" && role !== "admin";
  const RoleIcon = roleIcon(role);

  return (
    <div className="px-4 py-4 flex items-start gap-3">
      <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
        <span className="text-primary font-semibold text-sm">
          {(host.display_name || host.email).charAt(0).toUpperCase()}
        </span>
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium text-foreground truncate">
            {host.display_name || "—"}
          </span>
          {isSelf && (
            <Badge variant="secondary" className="text-[10px] h-5">
              You
            </Badge>
          )}
          <Badge className={`${roleBadgeClass(role)} gap-1 text-xs ml-auto`}>
            <RoleIcon className="w-3 h-3" />
            {ROLE_LABELS[role]}
          </Badge>
        </div>
        <div className="text-sm text-muted-foreground truncate mt-0.5">{host.email}</div>
        <div
          className="text-xs text-muted-foreground mt-1"
          title={new Date(host.created_at).toLocaleString()}
        >
          Joined {relativeDate(host.created_at)}
        </div>
        <div className="flex items-center gap-2 mt-3">
          <RolePicker
            value={selectValue}
            disabled={roleLocked || isSaving}
            lockReason={lockReason}
            onChange={onPickRole}
          />
          {isSaving && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
          <div className="ml-auto">
            <RowMenu
              canRemove={role !== "admin" && !isSelf}
              isRemoving={isRemoving}
              onRemove={onRequestRemove}
              email={host.email}
            />
          </div>
        </div>
        {isPromotingToAdmin && (
          <PromoteAdminDialog
            host={host}
            onCancel={onCancelPromote}
            onConfirm={onConfirmPromote}
          />
        )}
      </div>
    </div>
  );
}

function RolePicker({
  value,
  disabled,
  lockReason,
  onChange,
}: {
  value: Role;
  disabled: boolean;
  lockReason: string | null;
  onChange: (next: Role) => void;
}) {
  const select = (
    <Select
      value={value}
      disabled={disabled}
      onValueChange={(v) => onChange(v as Role)}
    >
      <SelectTrigger className="h-8 w-[130px]">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="admin">{ROLE_LABELS.admin}</SelectItem>
        <SelectItem value="host">{ROLE_LABELS.host}</SelectItem>
        <SelectItem value="cohost">{ROLE_LABELS.cohost}</SelectItem>
        <SelectItem value="super_user">{ROLE_LABELS.super_user}</SelectItem>
      </SelectContent>
    </Select>
  );
  if (!disabled || !lockReason) return select;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {/* span needed because disabled trigger swallows pointer events */}
        <span className="inline-flex">{select}</span>
      </TooltipTrigger>
      <TooltipContent side="top">{lockReason}</TooltipContent>
    </Tooltip>
  );
}

function RowMenu({
  canRemove,
  isRemoving,
  onRemove,
  email,
}: {
  canRemove: boolean;
  isRemoving: boolean;
  onRemove: () => void;
  email: string;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" disabled={isRemoving} aria-label="Row actions">
          {isRemoving ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <MoreHorizontal className="w-4 h-4" />
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground truncate">
          {email}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {canRemove ? (
          <DropdownMenuItem
            onSelect={(e) => {
              e.preventDefault();
              onRemove();
            }}
            className="text-destructive focus:text-destructive"
          >
            <Trash2 className="w-4 h-4 mr-2" />
            Remove user
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem disabled className="text-xs">
            No actions available
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function PromoteAdminDialog({
  host,
  onCancel,
  onConfirm,
}: {
  host: Host;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog
      open
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Promote to Admin?</AlertDialogTitle>
          <AlertDialogDescription>
            This gives <strong>{host.display_name || host.email}</strong> full
            platform access, including the ability to manage other users. Only
            grant admin to people you fully trust.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onCancel}>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>Make Admin</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// ─── Add User Dialog ────────────────────────────────────────────────────────

function AddUserDialog({
  form,
  setForm,
  submitting,
  showPassword,
  setShowPassword,
  onSubmit,
  onCancel,
}: {
  form: {
    email: string;
    displayName: string;
    password: string;
    role: Exclude<Role, "admin">;
  };
  setForm: React.Dispatch<
    React.SetStateAction<{
      email: string;
      displayName: string;
      password: string;
      role: Exclude<Role, "admin">;
    }>
  >;
  submitting: boolean;
  showPassword: boolean;
  setShowPassword: (v: boolean) => void;
  onSubmit: (e: React.FormEvent) => void;
  onCancel: () => void;
}) {
  return (
    <DialogContent className="sm:max-w-[480px]">
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <UserPlus className="w-5 h-5 text-primary" />
          Add User
        </DialogTitle>
        <DialogDescription>
          Create an account that can sign in immediately. Admin rights can only
          be granted after creation.
        </DialogDescription>
      </DialogHeader>
      <form onSubmit={onSubmit} className="space-y-4 mt-2">
        <div className="grid gap-2">
          <Label htmlFor="displayName">Display Name</Label>
          <Input
            id="displayName"
            placeholder="Jane Doe"
            value={form.displayName}
            onChange={(e) => setForm((f) => ({ ...f, displayName: e.target.value }))}
            required
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="hostEmail">Email</Label>
          <Input
            id="hostEmail"
            type="email"
            placeholder="user@example.com"
            value={form.email}
            onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
            required
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="hostRole">Role</Label>
          <Select
            value={form.role}
            onValueChange={(v) =>
              setForm((f) => ({ ...f, role: v as Exclude<Role, "admin"> }))
            }
          >
            <SelectTrigger id="hostRole">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="host">
                <div className="flex flex-col text-left">
                  <span className="font-medium">{ROLE_LABELS.host}</span>
                  <span className="text-xs text-muted-foreground">
                    {ROLE_DESCRIPTIONS.host}
                  </span>
                </div>
              </SelectItem>
              <SelectItem value="cohost">
                <div className="flex flex-col text-left">
                  <span className="font-medium">{ROLE_LABELS.cohost}</span>
                  <span className="text-xs text-muted-foreground">
                    {ROLE_DESCRIPTIONS.cohost}
                  </span>
                </div>
              </SelectItem>
              <SelectItem value="super_user">
                <div className="flex flex-col text-left">
                  <span className="font-medium">{ROLE_LABELS.super_user}</span>
                  <span className="text-xs text-muted-foreground">
                    {ROLE_DESCRIPTIONS.super_user}
                  </span>
                </div>
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="hostPassword">Temporary Password</Label>
          <div className="relative">
            <Input
              id="hostPassword"
              type={showPassword ? "text" : "password"}
              placeholder="Min 6 characters"
              value={form.password}
              onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
              minLength={6}
              required
              className="pr-10"
            />
            <button
              type="button"
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              onClick={() => setShowPassword(!showPassword)}
              tabIndex={-1}
              aria-label={showPassword ? "Hide password" : "Show password"}
            >
              {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
          <p className="text-xs text-muted-foreground">
            Share this password with the user. They can change it after logging in.
          </p>
        </div>
        <DialogFooter className="mt-2">
          <Button type="button" variant="outline" onClick={onCancel} disabled={submitting}>
            Cancel
          </Button>
          <Button type="submit" disabled={submitting}>
            {submitting ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Creating…
              </>
            ) : (
              <>
                <UserPlus className="w-4 h-4 mr-2" />
                Create User
              </>
            )}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}
