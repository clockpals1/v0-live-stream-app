"use client";

import { Button } from "@/components/ui/button";
import { Copy } from "lucide-react";
import { toast } from "sonner";

/**
 * Tiny client island for the otherwise-server-rendered summary page.
 * Splitting it out keeps the summary page a pure RSC, which gets us
 * better TTFB and zero client JS for the bulk of the layout.
 */
export function CopyButton({ text }: { text: string }) {
  return (
    <Button
      variant="ghost"
      size="sm"
      className="h-6 px-1.5"
      onClick={() => {
        navigator.clipboard.writeText(text);
        toast.success("Copied.");
      }}
    >
      <Copy className="h-3 w-3" />
    </Button>
  );
}
