"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
  Mail,
  Calendar,
  Eye,
  EyeOff,
  RefreshCw,
} from "lucide-react";

interface Host {
  id: string;
  user_id: string;
  email: string;
  display_name: string | null;
  is_admin: boolean;
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
  const [showPassword, setShowPassword] = useState(false);

  const [form, setForm] = useState({
    email: "",
    displayName: "",
    password: "",
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
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        toast.error(data.error || "Failed to create host");
        return;
      }

      toast.success(`Host "${form.displayName}" created successfully! They can now log in.`);
      setForm({ email: "", displayName: "", password: "" });
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
              {hosts.map(host => (
                <div
                  key={host.id}
                  className="flex items-center justify-between py-4 gap-4"
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
                        {host.is_admin && (
                          <Badge className="bg-primary/10 text-primary border-primary/20 text-xs gap-1">
                            <ShieldCheck className="w-3 h-3" />
                            Admin
                          </Badge>
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

                  {/* Can't remove self or other admins */}
                  {!host.is_admin && host.user_id !== currentUserId && (
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive hover:text-destructive hover:bg-destructive/10 shrink-0"
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
                          <AlertDialogTitle>Remove Host</AlertDialogTitle>
                          <AlertDialogDescription>
                            This will remove <strong>{host.display_name || host.email}</strong> from the
                            host list and delete their account. Their past streams will remain.
                            This action cannot be undone.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction
                            onClick={() => handleRemoveHost(host)}
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                          >
                            Remove Host
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
