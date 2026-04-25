"use client";

import { useState } from "react";
import { Sparkles, Mail, Check, Loader2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

/**
 * Insider Circle subscribe form for the live-stream viewer page.
 *
 * Placement guidance: drop it directly under the chat panel in the right
 * column. It's tasteful, brand-warm, and never interrupts video playback.
 *
 * Logic:
 *   - Posts to /api/insider/subscribe with { host_id, email, source_room_code }.
 *   - The API itself is idempotent (re-activates a previously unsubscribed
 *     row, or politely confirms an existing active subscription), so this
 *     component only needs to surface success/error toasts and lock the
 *     form into a "you're in" state.
 */
interface Props {
  hostId: string;
  hostName: string;
  roomCode: string;
}

export function InsiderCircleSubscribe({ hostId, hostName, roomCode }: Props) {
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting || done) return;
    const trimmed = email.trim();
    if (!trimmed) return;

    setSubmitting(true);
    try {
      const res = await fetch("/api/insider/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          host_id: hostId,
          email: trimmed,
          source_room_code: roomCode,
        }),
      });
      const json = await res.json().catch(() => ({}));

      if (!res.ok) {
        toast.error(json?.error || "Couldn't add you to the list.");
        return;
      }

      setDone(true);
      toast.success(json?.message || "You're in. Talk soon.");
    } catch {
      toast.error("Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Card className="overflow-hidden border-primary/20 bg-gradient-to-br from-primary/5 via-card to-card">
      <CardContent className="p-4 sm:p-5 flex flex-col gap-3">
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
            <Sparkles className="w-4 h-4 text-primary" />
          </div>
          <div className="min-w-0">
            <div className="text-[10px] uppercase tracking-[0.14em] font-semibold text-primary/80">
              Insider Circle
            </div>
            <h3 className="text-sm sm:text-base font-semibold text-foreground mt-0.5 leading-snug">
              Get updates from {hostName}
            </h3>
            <p className="text-[12px] text-muted-foreground mt-0.5 leading-snug">
              Be the first to hear about upcoming live sessions.
            </p>
          </div>
        </div>

        {done ? (
          <div className="flex items-center gap-2 px-3 py-2.5 rounded-md bg-green-500/10 border border-green-500/30 text-sm text-green-700 dark:text-green-400">
            <Check className="w-4 h-4 shrink-0" />
            <span className="leading-tight">
              You&apos;re on the list — we&apos;ll keep you posted.
            </span>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col sm:flex-row gap-2">
            <div className="relative flex-1 min-w-0">
              <Mail className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
              <Input
                type="email"
                required
                inputMode="email"
                autoComplete="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={submitting}
                className="pl-8 h-9"
              />
            </div>
            <Button
              type="submit"
              size="sm"
              disabled={submitting || !email.trim()}
              className="h-9 shrink-0 gap-1.5"
            >
              {submitting ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Joining…
                </>
              ) : (
                "Join"
              )}
            </Button>
          </form>
        )}

        {!done && (
          <p className="text-[10px] text-muted-foreground/80 leading-snug">
            One-tap unsubscribe in every email. We never share your address.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
