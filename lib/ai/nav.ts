import type { FeatureKey } from "@/lib/billing/plans";
import type { AppNavGroup } from "@/components/shell/app-sidebar";

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

/** Flat list kept for backward compatibility with any direct consumers. */
export const AI_NAV: ReadonlyArray<AiNavItem> = [
  { href: "/ai",           label: "AI Studio",        description: "Generate scripts, captions, titles, and more.", iconKey: "studio",   gateKey: "ai_content_generation" },
  { href: "/ai/automate",  label: "Automation",        description: "Daily ideas, weekly summaries, post-stream recaps.", iconKey: "automate", gateKey: "ai_automation" },
  { href: "/ai/publish",   label: "Publishing Hub",    description: "Schedule content across YouTube, TikTok, Instagram.", iconKey: "publish",  gateKey: "ai_publishing" },
  { href: "/ai/monetize",  label: "Monetization Hub",  description: "Affiliate campaigns, revenue copy, product launches.", iconKey: "monetize", gateKey: "ai_monetization" },
  { href: "/ai/insights",  label: "AI Insights",       description: "Trends, performance narratives, growth signals.", iconKey: "insights", gateKey: "ai_insights" },
];

/**
 * Grouped nav for the enterprise AppSidebar.
 * Groups follow Microsoft 365 admin-center pattern: purpose-based sections.
 */
export const AI_NAV_GROUPS: ReadonlyArray<AppNavGroup & { items: (AiNavItem & { badge?: string })[] }> = [
  {
    label: "Create",
    items: [
      { href: "/ai", label: "AI Studio", description: "", iconKey: "studio", gateKey: "ai_content_generation" },
    ],
  },
  {
    label: "Distribute",
    items: [
      { href: "/ai/automate", label: "Automation",       description: "", iconKey: "automate", gateKey: "ai_automation" },
      { href: "/ai/publish",  label: "Publishing Hub",   description: "", iconKey: "publish",  gateKey: "ai_publishing" },
      { href: "/ai/monetize", label: "Monetization Hub", description: "", iconKey: "monetize", gateKey: "ai_monetization" },
    ],
  },
  {
    label: "Intelligence",
    items: [
      { href: "/ai/insights", label: "AI Insights", description: "", iconKey: "insights", gateKey: "ai_insights" },
    ],
  },
];
