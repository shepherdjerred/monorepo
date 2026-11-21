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
