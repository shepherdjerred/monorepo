import { z } from "zod/v4";
import {
  REDDIT_OUTREACH_POST_LIMIT,
  REDDIT_OUTREACH_POST_PAGE_SIZE,
  RedditOutreachCoverageSchema,
  RedditOutreachFailureCategorySchema,
  RedditOutreachMetricsSchema,
  RedditOutreachPostSchema,
  type RedditOutreachPost,
  type RedditOutreachPostPage,
} from "@shepherdjerred/ops-model/promotion/reddit-outreach.ts";
import { promotionSpendDay } from "#activities/promotion/control/budget.ts";
import type { PromotionStore } from "#activities/promotion/store.ts";

const RedditSweepSummarySchema = z.object({
  occurrenceId: z.string(),
  completedAt: z.iso.datetime(),
  preview: z.boolean(),
  inspected: z.number(),
  assessed: z.number(),
  cached: z.number(),
  listingPages: z.number().optional(),
  threadReads: z.number().optional(),
  pageOpens: z.number().optional(),
  elapsedMs: z.number().optional(),
  stopReason: z.string().optional(),
  deferUntil: z.iso.datetime().nullable().optional(),
  metrics: RedditOutreachMetricsSchema.optional(),
  coverage: z.array(RedditOutreachCoverageSchema).optional(),
  failureCategory: RedditOutreachFailureCategorySchema.optional(),
  failures: z.array(z.object({ subreddit: z.string(), reason: z.string() })),
  replies: z.array(
    z.object({
      postId: z.string(),
      status: z.string(),
      summary: z.string(),
      receiptUrl: z.string().optional(),
    }),
  ),
  drafts: z.array(
    z.object({
      postId: z.string(),
      reply: z.string(),
      matchProbability: z.number().optional(),
    }),
  ),
});
export type SweepSummary = z.infer<typeof RedditSweepSummarySchema>;
const DailySweeps = z.record(z.string(), RedditSweepSummarySchema);
const SweepPostsSchema = z.object({
  preview: z.boolean(),
  posts: z
    .array(RedditOutreachPostSchema)
    .max(REDDIT_OUTREACH_POST_LIMIT)
    .optional(),
});

function sweepKey(occurrenceId: string) {
  return `reddit-outreach/sweeps/${encodeURIComponent(occurrenceId)}.json`;
}

export async function recordSweep(
  store: PromotionStore,
  summary: SweepSummary,
  posts?: readonly RedditOutreachPost[],
) {
  const audit =
    posts === undefined
      ? summary
      : {
          ...summary,
          ...SweepPostsSchema.parse({ preview: summary.preview, posts }),
        };
  if (!(await store.put(sweepKey(summary.occurrenceId), audit, undefined)))
    throw new Error("Reddit sweep audit already exists");
  if (summary.preview) return;
  const day = promotionSpendDay(new Date(summary.completedAt));
  const dayKey = `reddit-outreach/sweep-days/${day}.json`;
  for (let attempt = 0; attempt < 5; attempt++) {
    const current = await store.read(dayKey, DailySweeps);
    if (
      await store.put(
        dayKey,
        {
          ...current?.value,
          [summary.occurrenceId]: { ...summary, drafts: [] },
        },
        current?.etag,
      )
    )
      return;
  }
  throw new Error("Concurrent Reddit daily sweep report update");
}

export async function readRedditSweep(
  store: PromotionStore,
  occurrenceId: string,
) {
  const result = await store.read(
    sweepKey(occurrenceId),
    RedditSweepSummarySchema,
  );
  return result?.value;
}

export async function readRedditSweepDay(store: PromotionStore, day: string) {
  const current = await store.read(
    `reddit-outreach/sweep-days/${day}.json`,
    DailySweeps,
  );
  return Object.values(current?.value ?? {}).sort((a, b) =>
    a.completedAt.localeCompare(b.completedAt),
  );
}

export async function readRedditSweepPostPage(
  store: PromotionStore,
  occurrenceId: string,
  offset: number,
): Promise<RedditOutreachPostPage> {
  const audit = await store.read(sweepKey(occurrenceId), SweepPostsSchema);
  const posts = audit?.value.posts;
  if (posts === undefined || audit?.value.preview !== false)
    return { status: "unavailable" };
  const end = offset + REDDIT_OUTREACH_POST_PAGE_SIZE;
  return {
    status: "available",
    posts: posts.slice(offset, end),
    nextOffset: end < posts.length ? end : null,
  };
}
