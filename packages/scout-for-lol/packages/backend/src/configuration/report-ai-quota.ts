import type {
  ReportAiQuotaScope,
  ReportAiQuotaWindow,
} from "@scout-for-lol/data";

/**
 * How many AI report edits may run, and how many each window allows.
 *
 * A report belongs to one server, so unlike Explore the quota charges the
 * user within that guild and the guild itself, with a global ceiling over
 * both. The in-process limiter and the durable reservation both read these,
 * so the two admission paths cannot drift apart.
 */

/** AI report edits that may run at once across every server. */
export const REPORT_AI_MAX_ACTIVE_RUNS = 5;

export type ReportAiQuotaRule = {
  scope: ReportAiQuotaScope;
  window: ReportAiQuotaWindow;
  limit: number;
};

/** Ordered narrowest scope and window first, as refusals report them. */
export const REPORT_AI_QUOTA_RULES: readonly ReportAiQuotaRule[] = [
  { scope: "user_guild", window: "minute", limit: 1 },
  { scope: "user_guild", window: "hour", limit: 3 },
  { scope: "user_guild", window: "day", limit: 8 },
  { scope: "user_guild", window: "week", limit: 30 },
  { scope: "guild", window: "hour", limit: 5 },
  { scope: "guild", window: "day", limit: 20 },
  { scope: "guild", window: "week", limit: 100 },
  { scope: "global", window: "hour", limit: 30 },
  { scope: "global", window: "day", limit: 150 },
  { scope: "global", window: "week", limit: 500 },
];
