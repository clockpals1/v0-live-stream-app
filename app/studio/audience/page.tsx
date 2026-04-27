import { Users } from "lucide-react";
import { ComingSoon } from "@/components/studio/coming-soon";

/**
 * Audience CRM — Phase 4 surface.
 *
 * The Insider Circle subscriber model already exists; the CRM
 * promotes that data into a first-class workspace with segmentation,
 * engagement history, and email organisation tools.
 */
export default function AudiencePage() {
  return (
    <ComingSoon
      title="Audience CRM"
      description="Subscriber lists, engagement history, segments — your audience as a first-class entity."
      icon={Users}
      phaseLabel="Phase 4"
      bullets={[
        "Unified subscriber list across Insider Circle and replay viewers",
        "Tag-based segmentation (top fans, lapsed, new this week)",
        "Per-subscriber engagement history (replays watched, comments, likes)",
        "Email broadcast composer with send-time scheduling",
        "CSV export and unsubscribe handling",
      ]}
    />
  );
}
