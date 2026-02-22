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

export type PollingTier = {
  label: string;
  thresholdHours: number | undefined;
  intervalMinutes: number;
};

/**
 * Display-friendly polling tiers, derived from the constants above.
 * Used by the frontend docs page to render an always-up-to-date table.
 */
export const POLLING_TIERS: PollingTier[] = [
  {
    label: "Active (< 1 hour)",
    thresholdHours: ACTIVITY_THRESHOLDS.HOUR_1,
    intervalMinutes: POLLING_INTERVALS.MIN,
  },
  {
    label: "1-3 hours",
    thresholdHours: ACTIVITY_THRESHOLDS.HOUR_3,
    intervalMinutes: POLLING_INTERVALS.HOUR_3,
  },
  {
    label: "3-6 hours",
    thresholdHours: ACTIVITY_THRESHOLDS.HOUR_6,
    intervalMinutes: POLLING_INTERVALS.HOUR_6,
  },
  {
    label: "6-12 hours",
    thresholdHours: ACTIVITY_THRESHOLDS.HOUR_12,
    intervalMinutes: POLLING_INTERVALS.HOUR_12,
  },
  {
    label: "12 hours - 1 day",
    thresholdHours: ACTIVITY_THRESHOLDS.DAY_1,
    intervalMinutes: POLLING_INTERVALS.DAY_1,
  },
  {
    label: "1-3 days",
    thresholdHours: ACTIVITY_THRESHOLDS.DAY_3,
    intervalMinutes: POLLING_INTERVALS.DAY_3,
  },
  {
    label: "3-7 days",
    thresholdHours: ACTIVITY_THRESHOLDS.DAY_7,
    intervalMinutes: POLLING_INTERVALS.DAY_7,
  },
  {
    label: "7-14 days",
    thresholdHours: ACTIVITY_THRESHOLDS.DAY_14,
    intervalMinutes: POLLING_INTERVALS.DAY_14,
  },
  {
    label: "14-30 days",
    thresholdHours: ACTIVITY_THRESHOLDS.DAY_30,
    intervalMinutes: POLLING_INTERVALS.DAY_30,
  },
  {
    label: "30+ days (inactive)",
    thresholdHours: undefined,
    intervalMinutes: POLLING_INTERVALS.MAX,
  },
];
