"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ArrowRight } from "lucide-react";

export function JoinForm() {
  const [code, setCode] = useState("");
  const router = useRouter();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = code.trim();
    if (trimmed) router.push(`/watch/${trimmed}`);
  };

  return (
    <form onSubmit={handleSubmit} className="mt-5 flex max-w-sm gap-2">
      <input
        value={code}
        onChange={(e) => setCode(e.target.value.toUpperCase())}
        placeholder="Room code"
        autoComplete="off"
        autoCapitalize="characters"
        spellCheck={false}
        className="flex h-10 flex-1 rounded-lg border border-border bg-background px-3 font-mono text-sm uppercase tracking-widest focus:outline-none focus:ring-2 focus:ring-primary/50"
        aria-label="Room code"
      />
      <Button type="submit" size="sm" className="h-10 px-4 gap-1.5" disabled={!code.trim()}>
        Join
        <ArrowRight className="h-3.5 w-3.5" />
      </Button>
    </form>
  );
}
