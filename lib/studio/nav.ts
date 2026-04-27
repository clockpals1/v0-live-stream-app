import type { FeatureKey } from "@/lib/billing/plans";

/**
 * Studio sidebar navigation.
 *
 * Each entry maps a URL to a label, an icon-by-key, and (optionally)
 * the feature key that gates access. The layout uses `gateKey` to
 * disable the link with a "Upgrade" tooltip when the host's effective
 * plan doesn't include that capability — admin bypass and active
 * grants still flow through `getEffectivePlan` so platform admins
 * always see everything.
 *
 * IMPORTANT — icon by string, not by component reference.
 * The studio layout is a server component; the sidebar is a client
 * component. React Server Components forbid passing function
 * components (like Lucide icons, which are forwardRef objects) across
 * the boundary as props. We pass a stable string key here and let the
 * client-side sidebar resolve it through `STUDIO_ICONS` in
 * `components/studio/sidebar.tsx`. This keeps the nav config plain
 * data — fully serializable — at the cost of one extra map lookup.
 *
 * Keep this list short and product-aligned. Sub-pages live under each
 * top-level item and don't need their own nav entry.
 */
export type StudioIconKey =
  | "overview"
  | "replay"
  | "distribution"
  | "audience"
  | "monetize"
  | "insights";

export interface StudioNavItem {
  href: string;
  label: string;
  description: string;
  iconKey: StudioIconKey;
  /** When set, the page is gated behind this plan feature. */
  gateKey?: FeatureKey;
}

export const STUDIO_NAV: ReadonlyArray<StudioNavItem> = [
  {
    href: "/studio",
    label: "Overview",
    description: "Your creator dashboard at a glance.",
    iconKey: "overview",
  },
  {
    href: "/studio/replay",
    label: "Replay Library",
    description: "Recordings, publications, engagement.",
    iconKey: "replay",
    gateKey: "replay_publishing",
  },
  {
    href: "/studio/distribution",
    label: "Distribution Hub",
    description: "YouTube, exports, archive destinations.",
    iconKey: "distribution",
    gateKey: "distribution_export",
  },
  {
    href: "/studio/audience",
    label: "Audience CRM",
    description: "Subscriber lists, segments, engagement history.",
    iconKey: "audience",
    gateKey: "audience_crm",
  },
  {
    href: "/studio/monetize",
    label: "Monetization",
    description: "Earnings, paywalls, premium content.",
    iconKey: "monetize",
    gateKey: "monetization_basic",
  },
  {
    href: "/studio/insights",
    label: "Insights",
    description: "Viewer trends, chat activity, subscriber growth.",
    iconKey: "insights",
    gateKey: "live_analytics",
  },
];
