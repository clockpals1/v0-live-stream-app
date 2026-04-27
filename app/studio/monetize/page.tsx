import { CircleDollarSign } from "lucide-react";
import { ComingSoon } from "@/components/studio/coming-soon";

/**
 * Monetization Center — Phase 5 surface.
 *
 * Will lean on the existing Stripe integration (billing_plans, the
 * webhook handler, the entitlement resolver). Adds Stripe Connect for
 * payout to host accounts plus a paywall mechanism for individual
 * replays.
 */
export default function MonetizePage() {
  return (
    <ComingSoon
      title="Monetization Center"
      description="Earnings, paywalls, premium replays — turn engagement into revenue."
      icon={CircleDollarSign}
      phaseLabel="Phase 5"
      bullets={[
        "Earnings dashboard with payout history and pending balance",
        "Stripe Connect onboarding for direct host payouts",
        "Replay paywall — gate individual replays behind a one-time price",
        "Subscriber-only replays tied to your Insider Circle tiers",
        "Plan upgrade prompts wired to specific premium features",
      ]}
    />
  );
}
