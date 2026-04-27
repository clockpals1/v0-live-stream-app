import { Share2 } from "lucide-react";
import { ComingSoon } from "@/components/studio/coming-soon";

/**
 * Distribution Hub — Phase 3 surface.
 *
 * Today: placeholder. The real implementation will reuse the existing
 * `host_integrations` table (migration 021) to surface YouTube
 * connection state, plus a destinations registry so new channels
 * (Vimeo, custom RTMP) plug in without touching the UI shell.
 */
export default function DistributionPage() {
  return (
    <ComingSoon
      title="Distribution Hub"
      description="One place to manage where your replays and recordings go after they're published."
      icon={Share2}
      phaseLabel="Phase 3"
      bullets={[
        "YouTube channel connection and per-replay push controls",
        "Cloud archive routing and retention overrides",
        "One-off downloadable exports for sponsors and clients",
        "Pluggable destination registry (Vimeo, custom RTMP, more)",
      ]}
    />
  );
}
