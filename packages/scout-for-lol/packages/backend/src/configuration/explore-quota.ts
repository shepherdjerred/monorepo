import type {
  ExploreQuotaScope,
  ExploreQuotaWindow,
} from "@scout-for-lol/data";
import { z } from "zod";
import { ExploreQuotaLimitsSchema } from "@shepherdjerred/feature-flags/flag-value-settings.ts";

/**
 * How many Explore questions each window allows. The schema lives in the
 * feature-flags value registry (`ExploreQuotaLimitsSchema`), which enforces
 * the window ordering and per-user-below-global rules for the flag and env
 * layers alike.
 *
 * One key rather than seven, because these move together. A rollback is
 * "put the ceilings back", not seven coordinated flips with the system
 * running on a half-applied policy in between — and a half-applied policy is
 * the shape that produces a user allowance above the global one.
 *
 * Explore quotas are per person, not per server: the report editor charges a
 * guild because a report belongs to one, while a conversation belongs to a
 * user and reads the whole lake. The global rules exist to bound total spend
 * across concurrent explorers, not to be the wall one person meets.
 */
export type ExploreQuotaLimits = z.infer<typeof ExploreQuotaLimitsSchema>;

/**
 * The shipped policy, sized for gpt-6-luna's per-turn cost.
 *
 * The globals are three times the user rules on purpose rather than by
 * coincidence: they have to stay clear of one person's allowance or they
 * become the first wall for the second concurrent explorer.
 */
export const DEFAULT_EXPLORE_QUOTA_LIMITS: ExploreQuotaLimits = {
  userMinute: 4,
  userHour: 30,
  userDay: 100,
  userWeek: 300,
  globalHour: 120,
  globalDay: 600,
  globalWeek: 2000,
};

/**
 * Parse the JSON object an operator supplies through an environment variable
 * or a flag payload. Both carry strings; the object form is what a typed
 * caller passes.
 */
export const ExploreQuotaLimitsInputSchema = z.union([
  ExploreQuotaLimitsSchema,
  z
    .string()
    .transform((raw, ctx): unknown => {
      try {
        return JSON.parse(raw);
      } catch {
        ctx.addIssue({
          code: "custom",
          message: "explore quota limits must be a JSON object",
        });
        return z.NEVER;
      }
    })
    .pipe(ExploreQuotaLimitsSchema),
]);

/**
 * Explore answers that may run at once across every user.
 *
 * Fixed, unlike the question ceilings: it bounds concurrent provider work
 * rather than spend, and both admission paths refuse at the same number.
 */
export const EXPLORE_MAX_ACTIVE_RUNS = 5;

export type ExploreQuotaRule = {
  scope: ExploreQuotaScope;
  window: ExploreQuotaWindow;
  limit: number;
};

/**
 * The question quota as ordered rules: the per-user windows narrowest first,
 * then the global windows.
 *
 * The one place a limits object becomes rules. The in-process limiter and the
 * durable reservation both read this list, so they cannot disagree about which
 * windows exist, which scope each charges, or the order a refusal names them.
 */
export function exploreQuotaRules(
  limits: ExploreQuotaLimits,
): ExploreQuotaRule[] {
  return [
    { scope: "user", window: "minute", limit: limits.userMinute },
    { scope: "user", window: "hour", limit: limits.userHour },
    { scope: "user", window: "day", limit: limits.userDay },
    { scope: "user", window: "week", limit: limits.userWeek },
    { scope: "global", window: "hour", limit: limits.globalHour },
    { scope: "global", window: "day", limit: limits.globalDay },
    { scope: "global", window: "week", limit: limits.globalWeek },
  ];
}
