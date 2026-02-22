/**
 * Dynamic polling intervals for match history checking.
 * Adjusts check frequency based on when a player was last in a match.
 * This helps avoid rate limiting by checking active players more frequently.
 *
 * Constants (POLLING_INTERVALS, ACTIVITY_THRESHOLDS, MAX_PLAYERS_PER_RUN)
 * are defined in @scout-for-lol/data/polling-config.ts so they can be
 * shared with the frontend docs page.
 *
 * Scaling: 1 minute (played within 3 hours) -> 15 minutes (inactive for 30+ days)
 */

import { differenceInMinutes, differenceInHours } from "date-fns";
import {
  POLLING_INTERVALS,
  ACTIVITY_THRESHOLDS,
} from "@scout-for-lol/data/polling-config.ts";

// Re-export for backward compatibility with existing imports
/**
 * Calculate the appropriate polling interval (in minutes) based on when
 * this player was last in a match.
 *
 * @param lastMatchTime - When the player was last in a match (game creation time)
 * @param currentTime - Current time (for testing purposes)
 * @returns Polling interval in minutes
 */
export function calculatePollingInterval(
  lastMatchTime: Date | undefined,
  currentTime: Date = new Date(),
): number {
  if (lastMatchTime === undefined) {
    return POLLING_INTERVALS.MAX;
  }

  const hoursSinceLastMatch = differenceInHours(currentTime, lastMatchTime);

  if (hoursSinceLastMatch < ACTIVITY_THRESHOLDS.HOUR_1) {
    return POLLING_INTERVALS.MIN;
  }
  if (hoursSinceLastMatch < ACTIVITY_THRESHOLDS.HOUR_3) {
    return POLLING_INTERVALS.HOUR_3;
  }
  if (hoursSinceLastMatch < ACTIVITY_THRESHOLDS.HOUR_6) {
    return POLLING_INTERVALS.HOUR_6;
  }
  if (hoursSinceLastMatch < ACTIVITY_THRESHOLDS.HOUR_12) {
    return POLLING_INTERVALS.HOUR_12;
  }
  if (hoursSinceLastMatch < ACTIVITY_THRESHOLDS.DAY_1) {
    return POLLING_INTERVALS.DAY_1;
  }
  if (hoursSinceLastMatch < ACTIVITY_THRESHOLDS.DAY_3) {
    return POLLING_INTERVALS.DAY_3;
  }
  if (hoursSinceLastMatch < ACTIVITY_THRESHOLDS.DAY_7) {
    return POLLING_INTERVALS.DAY_7;
  }
  if (hoursSinceLastMatch < ACTIVITY_THRESHOLDS.DAY_14) {
    return POLLING_INTERVALS.DAY_14;
  }
  if (hoursSinceLastMatch < ACTIVITY_THRESHOLDS.DAY_30) {
    return POLLING_INTERVALS.DAY_30;
  }

  return POLLING_INTERVALS.MAX;
}

/**
 * Determine the time we should use to calculate when to next check a player.
 *
 * @param lastMatchTime - When the player was last in a match
 * @param lastCheckedAt - When we last checked for matches
 * @returns The time to use for polling interval calculations
 */
export function getPollingReferenceTime(
  lastMatchTime?: Date,
  lastCheckedAt?: Date,
): Date | undefined {
  if (lastCheckedAt === undefined) {
    return;
  }

  if (lastMatchTime === undefined) {
    return lastCheckedAt;
  }

  return lastMatchTime > lastCheckedAt ? lastMatchTime : lastCheckedAt;
}

/**
 * Determine if a player should be checked this cycle based on their polling interval.
 *
 * @param lastMatchTime - When the player was last in a match
 * @param lastCheckedAt - When we last checked for matches
 * @param currentTime - Current time (for testing purposes)
 * @returns True if the player should be checked this cycle
 */
export function shouldCheckPlayer(
  lastMatchTime: Date | undefined,
  lastCheckedAt: Date | undefined,
  currentTime: Date = new Date(),
): boolean {
  const referenceTime = getPollingReferenceTime(lastMatchTime, lastCheckedAt);

  if (referenceTime === undefined) {
    return true;
  }

  const interval = calculatePollingInterval(lastMatchTime, currentTime);

  if (interval === POLLING_INTERVALS.MIN) {
    return true;
  }

  const minutesSinceReference = differenceInMinutes(currentTime, referenceTime);
  return minutesSinceReference >= interval;
}
