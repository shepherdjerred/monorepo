import { z } from "zod";

/**
 * How many Explore questions each window allows.
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
export const ExploreQuotaLimitsSchema = z
  .object({
    userMinute: z.coerce.number().int().positive(),
    userHour: z.coerce.number().int().positive(),
    userDay: z.coerce.number().int().positive(),
    userWeek: z.coerce.number().int().positive(),
    globalHour: z.coerce.number().int().positive(),
    globalDay: z.coerce.number().int().positive(),
    globalWeek: z.coerce.number().int().positive(),
  })
  .superRefine((limits, ctx) => {
    // A wider window that allows fewer questions than a narrower one is not a
    // stricter policy, it is an unreachable one: the narrow window can never
    // be the binding constraint, and the reason a request was refused stops
    // matching the window named in the refusal.
    const ordered: [string, number[]][] = [
      [
        "user",
        [limits.userMinute, limits.userHour, limits.userDay, limits.userWeek],
      ],
      ["global", [limits.globalHour, limits.globalDay, limits.globalWeek]],
    ];
    for (const [scope, windows] of ordered) {
      windows.forEach((limit, index) => {
        const narrower = index === 0 ? undefined : windows[index - 1];
        if (narrower !== undefined && limit < narrower) {
          ctx.addIssue({
            code: "custom",
            message: `${scope} quota windows must not shrink as they widen`,
          });
        }
      });
    }
    // The per-user ceiling is meaningless above the global one — the global
    // rule would refuse the request first, and every user would be told they
    // had allowance left right up until Explore said it was busy.
    if (limits.userHour > limits.globalHour) {
      ctx.addIssue({
        code: "custom",
        message: "user hourly quota must not exceed the global hourly quota",
      });
    }
  });

export type ExploreQuotaLimits = z.infer<typeof ExploreQuotaLimitsSchema>;

/**
 * The shipped policy, sized for gpt-5.6-luna's per-turn cost.
 *
 * The globals are three times the user rules on purpose rather than by
 * coincidence: they have to stay clear of one person's allowance or they
 * become the first wall for the second concurrent explorer.
 */
export const DEFAULT_EXPLORE_QUOTA_LIMITS: ExploreQuotaLimits = {
  userMinute: 12,
  userHour: 90,
  userDay: 300,
  userWeek: 900,
  globalHour: 360,
  globalDay: 1800,
  globalWeek: 6000,
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
