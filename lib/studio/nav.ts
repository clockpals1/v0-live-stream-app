import {
  LayoutDashboard,
  Film,
  Share2,
  Users,
  CircleDollarSign,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { FeatureKey } from "@/lib/billing/plans";

/**
 * Studio sidebar navigation.
 *
 * Each entry maps a URL to a label, an icon, and (optionally) the
 * feature key that gates access. The layout uses `gateKey` to disable
 * the link with a "Upgrade" tooltip when the host's effective plan
 * doesn't include that capability — admin bypass and active grants
 * still flow through `getEffectivePlan` so platform admins always see
 * everything.
 *
 * Keep this list short and product-aligned. Sub-pages live under each
 * top-level item and don't need their own nav entry.
 */
export interface StudioNavItem {
  href: string;
  label: string;
  description: string;
  icon: LucideIcon;
  /** When set, the page is gated behind this plan feature. */
  gateKey?: FeatureKey;
}

export const STUDIO_NAV: ReadonlyArray<StudioNavItem> = [
  {
    href: "/studio",
    label: "Overview",
    description: "Your creator dashboard at a glance.",
    icon: LayoutDashboard,
  },
  {
    href: "/studio/replay",
    label: "Replay Library",
    description: "Recordings, publications, engagement.",
    icon: Film,
    gateKey: "replay_publishing",
  },
  {
    href: "/studio/distribution",
    label: "Distribution Hub",
    description: "YouTube, exports, archive destinations.",
    icon: Share2,
    gateKey: "distribution_export",
  },
  {
    href: "/studio/audience",
    label: "Audience CRM",
    description: "Subscriber lists, segments, engagement history.",
    icon: Users,
    gateKey: "audience_crm",
  },
  {
    href: "/studio/monetize",
    label: "Monetization",
    description: "Earnings, paywalls, premium content.",
    icon: CircleDollarSign,
    gateKey: "monetization_basic",
  },
];
