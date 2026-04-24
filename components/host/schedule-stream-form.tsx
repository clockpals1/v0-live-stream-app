"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, CalendarClock, User2 } from "lucide-react";
import { toast } from "sonner";
import { nanoid } from "nanoid";

interface Host {
  id: string;
  email: string;
  display_name: string | null;
}

interface ScheduleStreamFormProps {
  currentHostId: string;
  /**
   * Called after a stream is successfully scheduled. The new stream is passed
   * so the caller can auto-open the operator assignment dialog for it.
   */
  onScheduled?: (newStream?: { id: string; title: string }) => void;
}

export function ScheduleStreamForm({ currentHostId, onScheduled }: ScheduleStreamFormProps) {
  const router = useRouter();
  const supabaseRef = typeof window !== "undefined"
    ? (window as any).__supabaseClientRef ?? ((window as any).__supabaseClientRef = createClient())
    : createClient();

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [scheduleDate, setScheduleDate] = useState("");
  const [scheduleTime, setScheduleTime] = useState("");
  const [assignedHostId, setAssignedHostId] = useState(currentHostId);
  const [hosts, setHosts] = useState<Host[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingHosts, setLoadingHosts] = useState(true);

  // Load all registered hosts for assignment dropdown
  useEffect(() => {
    const loadHosts = async () => {
      const { data } = await supabaseRef
        .from("hosts")
        .select("id, email, display_name")
        .order("display_name", { ascending: true });
      if (data) setHosts(data);
      setLoadingHosts(false);
    };
    loadHosts();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Set minimum date to today
  const today = new Date().toISOString().split("T")[0];

  const handleSchedule = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !scheduleDate || !scheduleTime) return;

    setLoading(true);
    try {
      const scheduledAt = new Date(`${scheduleDate}T${scheduleTime}`).toISOString();
      const roomCode = nanoid(8).toUpperCase();

      const { data, error } = await supabaseRef
        .from("streams")
        .insert({
          host_id: currentHostId,
          assigned_host_id: assignedHostId || currentHostId,
          room_code: roomCode,
          title: title.trim(),
          description: description.trim() || null,
          status: "scheduled",
          scheduled_at: scheduledAt,
        })
        .select()
        .single();

      if (error) {
        toast.error("Failed to schedule stream: " + error.message);
        return;
      }

      toast.success(`"${data.title}" scheduled for ${new Date(scheduledAt).toLocaleString()}`, {
        duration: 6000,
      });

      setTitle("");
      setDescription("");
      setScheduleDate("");
      setScheduleTime("");
      setAssignedHostId(currentHostId);
      onScheduled?.({ id: data.id, title: data.title });
      router.refresh();
    } catch (err) {
      console.error("Error scheduling stream:", err);
      toast.error("Failed to schedule stream");
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSchedule} className="flex flex-col gap-4">
      {/* Title */}
      <div className="flex flex-col gap-2">
        <Label htmlFor="sched-title">Stream Title *</Label>
        <Input
          id="sched-title"
          placeholder="e.g. Sunday Service Live"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          required
        />
      </div>

      {/* Description */}
      <div className="flex flex-col gap-2">
        <Label htmlFor="sched-desc">Description</Label>
        <Input
          id="sched-desc"
          placeholder="Optional description for viewers"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>

      {/* Date & Time */}
      <div className="grid grid-cols-2 gap-2">
        <div className="flex flex-col gap-2">
          <Label htmlFor="sched-date">
            <CalendarClock className="w-3 h-3 inline mr-1" />
            Date *
          </Label>
          <Input
            id="sched-date"
            type="date"
            min={today}
            value={scheduleDate}
            onChange={(e) => setScheduleDate(e.target.value)}
            required
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="sched-time">Time *</Label>
          <Input
            id="sched-time"
            type="time"
            value={scheduleTime}
            onChange={(e) => setScheduleTime(e.target.value)}
            required
          />
        </div>
      </div>

      {/* Assign Host */}
      <div className="flex flex-col gap-2">
        <Label htmlFor="sched-host">
          <User2 className="w-3 h-3 inline mr-1" />
          Assign Broadcaster
        </Label>
        {loadingHosts ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="w-3 h-3 animate-spin" />
            Loading hosts...
          </div>
        ) : (
          <select
            id="sched-host"
            value={assignedHostId}
            onChange={(e) => setAssignedHostId(e.target.value)}
            className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            {hosts.map((h) => (
              <option key={h.id} value={h.id}>
                {h.display_name || h.email}
                {h.id === currentHostId ? " (you)" : ""}
              </option>
            ))}
          </select>
        )}
        <p className="text-xs text-muted-foreground">
          The assigned host can start this stream from their own location.
        </p>
      </div>

      <Button
        type="submit"
        disabled={loading || !title.trim() || !scheduleDate || !scheduleTime}
        className="w-full"
      >
        {loading ? (
          <>
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            Scheduling...
          </>
        ) : (
          <>
            <CalendarClock className="w-4 h-4 mr-2" />
            Schedule Stream
          </>
        )}
      </Button>
    </form>
  );
}
