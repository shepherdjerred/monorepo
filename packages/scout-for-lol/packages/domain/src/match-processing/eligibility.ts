import type { MatchProcessingPolicy } from "./states.ts";

export const LIVE_DISCOVERY_WINDOW_MS = 15 * 60 * 1000;
export const TIMELINE_RECOVERY_WINDOW_MS = 2 * 60 * 1000;

/** Discovery purpose and time, never payload origin, decide effect eligibility. */
export function processingEligibility(input: {
  readonly historical: boolean;
  readonly completedAt: number;
  readonly discoveredAt: number;
}): {
  readonly policy: Extract<MatchProcessingPolicy, "FULL" | "HISTORY_ONLY">;
  readonly reason: "live-completion" | "history-discovery" | "late-discovery";
} {
  if (input.historical)
    return { policy: "HISTORY_ONLY", reason: "history-discovery" };
  return input.discoveredAt - input.completedAt > LIVE_DISCOVERY_WINDOW_MS
    ? { policy: "HISTORY_ONLY", reason: "late-discovery" }
    : { policy: "FULL", reason: "live-completion" };
}
