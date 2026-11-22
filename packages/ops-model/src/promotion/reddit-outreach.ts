import { z } from "zod";

const count = z.number().int().nonnegative();
const timestamp = z.iso.datetime().nullable();

export const RedditOutreachReasonSchema = z.enum([
  "listing-ineligible",
  "already-handled",
  "rules-exclude-replies",
  "thread-ineligible",
  "intent-unconfirmed",
  "permission-unconfirmed",
  "requirements-unconfirmed",
  "score-too-low",
  "decision-declined",
  "draft-rejected",
  "publish-blocked",
  "publish-duplicate",
  "publish-deferred",
  "publish-verified",
]);
export type RedditOutreachReason = z.infer<typeof RedditOutreachReasonSchema>;

export const RedditOutreachMetricsSchema = z.object({
  draftsPrepared: count,
  reasons: z.partialRecord(RedditOutreachReasonSchema, count),
});
export type RedditOutreachMetrics = z.infer<typeof RedditOutreachMetricsSchema>;

export const RedditOutreachStopReasonSchema = z.enum([
  "exhausted",
  "scan-limit",
  "listing-page-limit",
  "unsettled-page",
  "deadline",
  "disabled",
  "browser-budget",
  "thread-budget",
  "reply-limit",
  "daily-limit",
  "publish-deferred",
  "rate-limit",
  "decisions-rate-limit",
  "challenge",
  "identity",
  "logged-out",
  "page",
  "cursor",
  "account-busy",
  "blocked",
  "other",
]);
export type RedditOutreachStopReason = z.infer<
  typeof RedditOutreachStopReasonSchema
>;

export const RedditOutreachFailureCategorySchema = z.enum([
  "browser",
  "decisions",
  "storage",
  "workflow",
  "other",
]);
export type RedditOutreachFailureCategory = z.infer<
  typeof RedditOutreachFailureCategorySchema
>;

export const RedditOutreachCoverageSchema = z
  .object({
    subreddit: z.string().regex(/^\w{3,21}$/u),
    since: z.iso.datetime(),
    until: z.iso.datetime(),
    found: count,
    scored: count,
    skipped: count,
    pending: count,
    complete: z.boolean(),
  })
  .refine(
    (row) =>
      row.found === row.scored + row.skipped + row.pending &&
      (!row.complete || row.pending === 0),
    "Reddit coverage counts must account for every found post",
  );
export type RedditOutreachCoverage = z.infer<
  typeof RedditOutreachCoverageSchema
>;

export const REDDIT_OUTREACH_POST_LIMIT = 1500;
export const REDDIT_OUTREACH_POST_PAGE_SIZE = 50;

export const RedditOutreachPostSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9]+$/u),
    subreddit: z.string().regex(/^\w{3,21}$/u),
    title: z.string().min(1).max(1000),
    url: z.string(),
    score: z.number().min(0).max(1).nullable(),
    result: z.enum([
      "pending",
      "skipped",
      "no-match",
      "draft-rejected",
      "draft-ready",
      "publish-verified",
      "publish-blocked",
      "publish-duplicate",
      "publish-deferred",
    ]),
    reason: z.string().max(1000).nullable(),
  })
  .refine(
    ({ url, subreddit, id }) =>
      url === `https://www.reddit.com/r/${subreddit}/comments/${id}/`,
    "Reddit post URL must identify the recorded post",
  );
export type RedditOutreachPost = z.infer<typeof RedditOutreachPostSchema>;

export const RedditOutreachPostPageSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("unavailable") }),
  z.object({
    status: z.literal("available"),
    posts: z
      .array(RedditOutreachPostSchema)
      .max(REDDIT_OUTREACH_POST_PAGE_SIZE),
    nextOffset: z
      .number()
      .int()
      .positive()
      .max(REDDIT_OUTREACH_POST_LIMIT)
      .nullable(),
  }),
]);
export type RedditOutreachPostPage = z.infer<
  typeof RedditOutreachPostPageSchema
>;

export const RedditOutreachRunSchema = z.object({
  id: z.string().min(1),
  at: z.iso.datetime(),
  elapsedMs: count.nullable(),
  status: z.enum(["recorded", "running", "failed", "missing", "unknown"]),
  stopReason: RedditOutreachStopReasonSchema.nullable(),
  deferUntil: timestamp.optional(),
  inspected: count.nullable(),
  assessed: count.nullable(),
  cached: count.nullable(),
  metrics: RedditOutreachMetricsSchema.nullable(),
  coverage: z.array(RedditOutreachCoverageSchema).optional(),
  verifiedReceipts: z.array(
    z.url({ protocol: /^https$/, hostname: /^(www\.)?reddit\.com$/ }),
  ),
  unresolvedReplies: count,
  failureCategory: RedditOutreachFailureCategorySchema.nullable(),
});
export type RedditOutreachRun = z.infer<typeof RedditOutreachRunSchema>;

export const RedditOutreachOverviewSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("unavailable") }),
  z.object({
    status: z.literal("available"),
    schedule: z.object({
      state: z.enum(["active", "paused", "missing", "unavailable"]),
      lastRunAt: timestamp,
      nextRunAt: timestamp,
    }),
    publishing: z.enum(["enabled", "disabled", "unavailable"]),
    account: z.object({
      hold: z.enum(["logged-out", "challenge"]).nullable(),
      retryAt: timestamp,
    }),
    today: z.object({
      day: z.iso.date(),
      inspected: count,
      assessed: count,
      cached: count,
      draftsPrepared: count.nullable(),
      verifiedReplies: count,
      unresolvedReplies: count,
      remainingSlots: count.nullable(),
    }),
    runs: z.array(RedditOutreachRunSchema).max(12),
  }),
]);
export type RedditOutreachOverview = z.infer<
  typeof RedditOutreachOverviewSchema
>;
