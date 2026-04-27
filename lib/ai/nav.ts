import type { FeatureKey } from "@/lib/billing/plans";

/**
 * AI Automation Hub sidebar navigation.
 *
 * Follows the exact same pattern as lib/studio/nav.ts:
 *   - plain data (no React components) so it's serializable across the
 *     RSC boundary from the server layout to the client sidebar.
 *   - iconKey resolved by the client sidebar's ICON registry.
 *   - gateKey checked against the host's effective plan in the layout.
 */
export type AiIconKey =
  | "studio"
  | "automate"
  | "publish"
  | "monetize"
  | "insights";

export interface AiNavItem {
  href: string;
  label: string;
  description: string;
  iconKey: AiIconKey;
  gateKey?: FeatureKey;
}

export const AI_NAV: ReadonlyArray<AiNavItem> = [
  {
    href: "/ai",
    label: "AI Studio",
    description: "Generate scripts, captions, titles, and more.",
    iconKey: "studio",
    gateKey: "ai_content_generation",
  },
  {
    href: "/ai/automate",
    label: "Automation",
    description: "Daily ideas, weekly summaries, post-stream recaps.",
    iconKey: "automate",
    gateKey: "ai_automation",
  },
  {
    href: "/ai/publish",
    label: "Publishing Hub",
    description: "Schedule content across YouTube, TikTok, Instagram.",
    iconKey: "publish",
    gateKey: "ai_publishing",
  },
  {
    href: "/ai/monetize",
    label: "Monetization Hub",
    description: "Affiliate campaigns, revenue copy, product launches.",
    iconKey: "monetize",
    gateKey: "ai_monetization",
  },
  {
    href: "/ai/insights",
    label: "AI Insights",
    description: "Trends, performance narratives, growth signals.",
    iconKey: "insights",
    gateKey: "ai_insights",
  },
];
