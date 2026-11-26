import { z } from "zod";

/*
 * Decoded schemas for the JSON-encoded settings flags. Each mirrors the
 * consumer schema that reads the flag today (named per schema) minus parsing
 * transforms; deliberate tightenings are noted inline.
 */

/** Mirrors `ExploreQuotaLimitsSchema` (scout backend). Tightened: numbers, not coerced strings; no unknown keys. */
export const ExploreQuotaLimitsSchema = z
  .strictObject({
    userMinute: z.number().int().positive(),
    userHour: z.number().int().positive(),
    userDay: z.number().int().positive(),
    userWeek: z.number().int().positive(),
    globalHour: z.number().int().positive(),
    globalDay: z.number().int().positive(),
    globalWeek: z.number().int().positive(),
  })
  .superRefine((limits, context) => {
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
          context.addIssue({
            code: "custom",
            message: `${scope} quota windows must not shrink as they widen`,
          });
        }
      });
    }
    const shared = [
      ["hourly", "userHour", limits.userHour, limits.globalHour],
      ["daily", "userDay", limits.userDay, limits.globalDay],
      ["weekly", "userWeek", limits.userWeek, limits.globalWeek],
    ] as const;
    for (const [window, field, user, global] of shared) {
      if (user > global) {
        context.addIssue({
          code: "custom",
          path: [field],
          message: `user ${window} quota must not exceed the global ${window} quota`,
        });
      }
    }
  });

/** Mirrors `ExploreSpendPolicySchema` (scout backend). */
export const ExploreSpendPolicySchema = z.strictObject({
  globalMonthlyMicros: z.number().int().min(0).max(80_000_000),
  userMonthlyMicros: z.number().int().min(0).max(40_000_000),
  turnMicros: z.number().int().min(0).max(20_000_000),
});

/** Mirrors `temporal/src/config/promotion.ts`. Tightened: target ids are nonempty. */
export const PromotionSettingsSchema = z.strictObject({
  model: z.string().min(1),
  maxSteps: z.number().int().min(1).max(80),
  timeoutMinutes: z.number().int().min(1).max(15),
  monthlySolverUsd: z.number().min(0).max(10),
  enabledTargets: z.array(z.string().min(1)),
  dailySpendUsd: z.number().nonnegative().max(5).default(5),
});

/** Mirrors `RedditOutreachSettingsSchema` (temporal). */
export const RedditOutreachSettingsSchema = z.strictObject({
  subreddits: z
    .array(z.string().regex(/^\w{3,21}$/u))
    .min(1)
    .max(10)
    .refine(
      (names) =>
        new Set(names.map((name) => name.toLowerCase())).size === names.length,
      "Subreddit names must be unique",
    ),
  maxPostAgeHours: z.number().int().min(1).max(24),
  maxPostsPerSweep: z.number().int().min(1).max(1500),
  maxListingPagesPerSweep: z.number().int().min(1).max(100).default(12),
  maxThreadReadsPerSweep: z.number().int().min(1).max(100).default(20),
  maxRedditNavigationsPerSweep: z.number().int().min(1).max(300).default(60),
  maxRepliesPerSweep: z.number().int().min(0).max(10),
  maxRepliesPerDay: z.number().int().min(0).max(10),
});

const NonNegativeWeightSchema = z.number().int().min(0);
const PositiveSecondsSchema = z.number().int().min(1);

/**
 * Mirrors `CodeReviewSettingsSchema` (temporal `shared/ci/code-review.ts`).
 * The consumer's weights transform only drops absent providers, so the decoded
 * shape keeps them optional instead.
 */
export const CodeReviewSettingsSchema = z.strictObject({
  weights: z.strictObject({
    codex: NonNegativeWeightSchema.optional(),
    greptile: NonNegativeWeightSchema.optional(),
    qodo: NonNegativeWeightSchema.optional(),
    coderabbit: NonNegativeWeightSchema.optional(),
    cubic: NonNegativeWeightSchema.optional(),
    codeant: NonNegativeWeightSchema.optional(),
  }),
  quotaCooldownSeconds: PositiveSecondsSchema.default(3600),
  timeoutCooldownSeconds: PositiveSecondsSchema.default(900),
  requestRetrySeconds: PositiveSecondsSchema.default(720),
  providerTimeoutSeconds: PositiveSecondsSchema.default(1500),
});

/** Mirrors `MailSettingsSchema` (mail server). Tightened: no unknown keys. */
export const MailSettingsSchema = z.strictObject({
  retentionDays: z.number().int().positive().default(30),
  maxPerClientPerTenMinutes: z.number().int().positive().default(200),
  allowCleartextSmtpAuth: z.boolean().default(false),
});
