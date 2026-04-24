"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
import { toast } from "sonner";
import {
  UserPlus,
  Trash2,
  Loader2,
  ShieldCheck,
  User,
  Users,
  Mail,
  Calendar,
  Eye,
  EyeOff,
  RefreshCw,
} from "lucide-react";
import { ROLE_LABELS, ROLE_DESCRIPTIONS, resolveRole, type Role } from "@/lib/rbac";

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

export function AdminPanel({ currentUserId }: AdminPanelProps) {
  const [hosts, setHosts] = useState<Host[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [roleSavingId, setRoleSavingId] = useState<string | null>(null);
  const [pendingRole, setPendingRole] = useState<Record<string, Role>>({});
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

  const loadHosts = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/hosts");
      if (!res.ok) throw new Error("Failed to load hosts");
      const data = await res.json();
      setHosts(data.hosts || []);
    } catch {
      toast.error("Failed to load hosts");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadHosts();
  }, [loadHosts]);

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
        toast.error(data.error || "Failed to create host");
        return;
      }

      toast.success(
        `${ROLE_LABELS[form.role]} "${form.displayName}" created. They can now log in.`
      );
      setForm({ email: "", displayName: "", password: "", role: "host" });
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
      const res = await fetch(`/api/admin/hosts/${host.id}`, {
        method: "DELETE",
      });

      const data = await res.json();

      if (!res.ok) {
        toast.error(data.error || "Failed to remove host");
        return;
      }

      toast.success(`Host "${host.display_name || host.email}" removed`);
      setHosts(prev => prev.filter(h => h.id !== host.id));
    } catch {
      toast.error("An unexpected error occurred");
    } finally {
      setRemovingId(null);
    }
  };

  const adminCount = useMemo(
    () => hosts.filter(h => resolveRole(h) === "admin").length,
    [hosts]
  );

  const handleChangeRole = async (host: Host, nextRole: Role) => {
    const currentRole = resolveRole(host);
    if (nextRole === currentRole) return;

    // Client-side guards mirror server-side checks for instant feedback
    if (host.user_id === currentUserId && currentRole === "admin" && nextRole !== "admin") {
      toast.error("You cannot demote your own admin account.");
      setPendingRole(prev => {
        const { [host.id]: _removed, ...rest } = prev;
        return rest;
      });
      return;
    }
    if (currentRole === "admin" && nextRole !== "admin" && adminCount <= 1) {
      toast.error("Cannot demote the last remaining admin.");
      setPendingRole(prev => {
        const { [host.id]: _removed, ...rest } = prev;
        return rest;
      });
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
        `${host.display_name || host.email} is now ${ROLE_LABELS[nextRole]}.`
      );
      setHosts(prev =>
        prev.map(h =>
          h.id === host.id
            ? { ...h, role: nextRole, is_admin: nextRole === "admin" }
            : h
        )
      );
      setPendingRole(prev => {
        const { [host.id]: _removed, ...rest } = prev;
        return rest;
      });
    } catch {
      toast.error("An unexpected error occurred");
    } finally {
      setRoleSavingId(null);
    }
  };

  return (
    <div className="space-y-8">

      {/* Add New Host */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <UserPlus className="w-5 h-5 text-primary" />
            Add New Host
          </CardTitle>
          <CardDescription>
            Create a host account. The host can immediately log in with these credentials.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleAddHost} className="grid sm:grid-cols-2 gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="displayName">Display Name</Label>
              <Input
                id="displayName"
                placeholder="John Doe"
                value={form.displayName}
                onChange={e => setForm(f => ({ ...f, displayName: e.target.value }))}
                required
              />
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="hostEmail">Email Address</Label>
              <Input
                id="hostEmail"
                type="email"
                placeholder="host@example.com"
                value={form.email}
                onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                required
              />
            </div>

            <div className="flex flex-col gap-2 sm:col-span-2">
              <Label htmlFor="hostRole">Role</Label>
              <Select
                value={form.role}
                onValueChange={(v) =>
                  setForm(f => ({ ...f, role: v as Exclude<Role, "admin"> }))
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
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Admin rights can only be granted after creation.
              </p>
            </div>

            <div className="flex flex-col gap-2 sm:col-span-2">
              <Label htmlFor="hostPassword">Temporary Password</Label>
              <div className="relative">
                <Input
                  id="hostPassword"
                  type={showPassword ? "text" : "password"}
                  placeholder="Min 6 characters"
                  value={form.password}
                  onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                  minLength={6}
                  required
                  className="pr-10"
                />
                <button
                  type="button"
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  onClick={() => setShowPassword(v => !v)}
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              <p className="text-xs text-muted-foreground">
                Share this password with the host. They can change it after logging in.
              </p>
            </div>

            <div className="sm:col-span-2">
              <Button type="submit" disabled={submitting} className="w-full sm:w-auto">
                {submitting ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Creating host...
                  </>
                ) : (
                  <>
                    <UserPlus className="w-4 h-4 mr-2" />
                    Create Host Account
                  </>
                )}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {/* Hosts List */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <User className="w-5 h-5 text-primary" />
                All Hosts
                <Badge variant="secondary">{hosts.length}</Badge>
              </CardTitle>
              <CardDescription>
                Manage who can access the host dashboard and stream
              </CardDescription>
            </div>
            <Button variant="ghost" size="sm" onClick={loadHosts} disabled={loading}>
              <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : hosts.length === 0 ? (
            <div className="text-center py-10 text-muted-foreground">
              <User className="w-10 h-10 mx-auto mb-3 opacity-40" />
              <p>No hosts yet. Add the first one above.</p>
            </div>
          ) : (
            <div className="divide-y">
              {hosts.map(host => {
                const role = resolveRole(host);
                const isSelf = host.user_id === currentUserId;
                const isLastAdmin = role === "admin" && adminCount <= 1;
                const roleLocked = isSelf || isLastAdmin;
                const pending = pendingRole[host.id];
                const selectValue: Role = pending ?? role;
                const isSaving = roleSavingId === host.id;
                const isPromotingToAdmin = pending === "admin" && role !== "admin";

                const roleBadgeClass =
                  role === "admin"
                    ? "bg-primary/10 text-primary border-primary/20"
                    : role === "cohost"
                    ? "bg-purple-500/10 text-purple-600 border-purple-500/20"
                    : "bg-muted text-foreground border-border";

                const RoleIcon = role === "admin"
                  ? ShieldCheck
                  : role === "cohost"
                  ? Users
                  : User;

                return (
                  <div
                    key={host.id}
                    className="flex flex-col sm:flex-row sm:items-center sm:justify-between py-4 gap-4"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                        <span className="text-primary font-semibold text-sm">
                          {(host.display_name || host.email).charAt(0).toUpperCase()}
                        </span>
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium text-foreground truncate">
                            {host.display_name || "—"}
                          </span>
                          <Badge className={`${roleBadgeClass} text-xs gap-1`}>
                            <RoleIcon className="w-3 h-3" />
                            {ROLE_LABELS[role]}
                          </Badge>
                          {isSelf && (
                            <Badge variant="secondary" className="text-xs">You</Badge>
                          )}
                        </div>
                        <div className="flex items-center gap-3 text-sm text-muted-foreground mt-0.5">
                          <span className="flex items-center gap-1 truncate">
                            <Mail className="w-3 h-3 shrink-0" />
                            {host.email}
                          </span>
                          <span className="flex items-center gap-1 shrink-0">
                            <Calendar className="w-3 h-3" />
                            {new Date(host.created_at).toLocaleDateString()}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      {/* Role selector — disabled for self and last admin */}
                      <div className="flex items-center gap-2">
                        <Select
                          value={selectValue}
                          disabled={roleLocked || isSaving}
                          onValueChange={(v) => {
                            const next = v as Role;
                            if (next === "admin" && role !== "admin") {
                              // Promoting to admin — require confirmation before save
                              setPendingRole(prev => ({ ...prev, [host.id]: next }));
                            } else {
                              // Demote / same-tier change — save immediately
                              setPendingRole(prev => ({ ...prev, [host.id]: next }));
                              handleChangeRole(host, next);
                            }
                          }}
                        >
                          <SelectTrigger className="h-9 w-[130px]">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="admin">{ROLE_LABELS.admin}</SelectItem>
                            <SelectItem value="host">{ROLE_LABELS.host}</SelectItem>
                            <SelectItem value="cohost">{ROLE_LABELS.cohost}</SelectItem>
                          </SelectContent>
                        </Select>

                        {isPromotingToAdmin && (
                          <AlertDialog
                            open
                            onOpenChange={(open) => {
                              if (!open) {
                                setPendingRole(prev => {
                                  const { [host.id]: _removed, ...rest } = prev;
                                  return rest;
                                });
                              }
                            }}
                          >
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>Promote to Admin?</AlertDialogTitle>
                                <AlertDialogDescription>
                                  This gives <strong>{host.display_name || host.email}</strong> full
                                  platform access, including the ability to manage other users.
                                  Only grant admin to people you fully trust.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                <AlertDialogAction
                                  onClick={() => handleChangeRole(host, "admin")}
                                >
                                  Make Admin
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        )}

                        {isSaving && (
                          <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                        )}
                      </div>

                      {/* Can't remove self or admins (admin must be demoted first) */}
                      {role !== "admin" && !isSelf && (
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-destructive hover:text-destructive hover:bg-destructive/10"
                              disabled={removingId === host.id}
                            >
                              {removingId === host.id ? (
                                <Loader2 className="w-4 h-4 animate-spin" />
                              ) : (
                                <Trash2 className="w-4 h-4" />
                              )}
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Remove User</AlertDialogTitle>
                              <AlertDialogDescription>
                                This will remove <strong>{host.display_name || host.email}</strong>
                                {" "}and delete their account. Their past streams will remain.
                                This action cannot be undone.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction
                                onClick={() => handleRemoveHost(host)}
                                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                              >
                                Remove
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
