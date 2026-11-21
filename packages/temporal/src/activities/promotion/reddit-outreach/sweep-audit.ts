import { z } from "zod/v4";
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

export async function recordSweep(
  store: PromotionStore,
  summary: SweepSummary,
) {
  const key = `reddit-outreach/sweeps/${encodeURIComponent(summary.occurrenceId)}.json`;
  if (!(await store.put(key, summary, undefined)))
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

export async function readRedditSweepDay(store: PromotionStore, day: string) {
  const current = await store.read(
    `reddit-outreach/sweep-days/${day}.json`,
    DailySweeps,
  );
  return Object.values(current?.value ?? {}).sort((a, b) =>
    a.completedAt.localeCompare(b.completedAt),
  );
}
