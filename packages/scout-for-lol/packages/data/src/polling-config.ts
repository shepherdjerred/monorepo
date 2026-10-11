/**
 * Polling interval configuration shared between backend and frontend.
 * Backend uses these for actual polling logic; frontend uses them for docs display.
 */

/**
 * Maximum number of players to check per polling run.
 */
export const MAX_PLAYERS_PER_RUN = 50;

/**
 * Polling interval values in minutes, keyed by activity tier.
 */
export const POLLING_INTERVALS = {
  MIN: 1,
  HOUR_3: 1,
  HOUR_6: 2,
  HOUR_12: 2,
  DAY_1: 3,
  DAY_3: 5,
  DAY_7: 5,
  DAY_14: 10,
  DAY_30: 10,
  MAX: 15,
} as const;

/**
 * Activity thresholds in hours that determine which polling interval to use.
 */
export const ACTIVITY_THRESHOLDS = {
  HOUR_1: 1,
  HOUR_3: 3,
  HOUR_6: 6,
  HOUR_12: 12,
  DAY_1: 24,
  DAY_3: 72,
  DAY_7: 168,
  DAY_14: 336,
  DAY_30: 720,
} as const;
