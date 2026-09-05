import type { AnalyticsProps } from "#src/lib/analytics/analytics-events.ts";

/**
 * Pure decisions for the /app/installed landing page: what to show, where
 * "Continue setup" goes, and whether the install-completed analytics event
 * fires. Kept out of the component so the outcome table is testable without
 * mounting the router/tRPC providers.
 *
 * Everything here consumes the installAttribution.complete mutation's
 * server-echoed response — never raw query params — so a hand-crafted
 * `/installed?guild_id=…` link can only ever reach the neutral copy.
 */

export type InstallCompleteResponse =
  | { outcome: "invalid" | "cancelled" }
  | {
      outcome: "attributed" | "already_installed" | "pending";
      guildId: string;
      surface: string;
    };

export type InstallLandingResult = {
  outcome: InstallCompleteResponse["outcome"];
  guildId: string | null;
};

export function installLandingResult(
  response: InstallCompleteResponse,
): InstallLandingResult {
  if (
    response.outcome === "attributed" ||
    response.outcome === "already_installed" ||
    response.outcome === "pending"
  ) {
    return { outcome: response.outcome, guildId: response.guildId };
  }
  return { outcome: response.outcome, guildId: null };
}

/**
 * Props for the `bot_install_completed` event, or null when the response is
 * not a completed install (cancelled, invalid, or a guild that already had
 * Scout — none of which are installs to attribute).
 */
export function installCompletedEventProps(
  response: InstallCompleteResponse,
): AnalyticsProps | null {
  if (response.outcome !== "attributed" && response.outcome !== "pending") {
    return null;
  }
  return {
    guild_id: response.guildId,
    outcome: response.outcome,
    surface: response.surface,
  };
}

export function installLandingCopy(result: InstallLandingResult | null): {
  title: string;
  description: string;
} {
  if (result === null) {
    return {
      title: "Finishing up…",
      description: "Confirming the install with Discord.",
    };
  }
  if (result.outcome === "attributed" || result.outcome === "pending") {
    return {
      title: "Scout added 🎉",
      description: "Scout is now in your server. Let's finish setting it up.",
    };
  }
  if (result.outcome === "already_installed") {
    return {
      title: "Finish setup",
      description:
        "Scout was already in that server. Pick up where you left off.",
    };
  }
  return {
    title: "Finish setup",
    description: "Pick up where you left off and finish setting up Scout.",
  };
}

/**
 * Carry the freshly-installed guild into the wizard so "Continue setup"
 * skips the install step and lands on step 2 (concepts).
 */
export function installContinueTarget(
  result: InstallLandingResult | null,
): string {
  if (result?.guildId == null) {
    return "/welcome";
  }
  return `/welcome?guild=${encodeURIComponent(result.guildId)}`;
}
