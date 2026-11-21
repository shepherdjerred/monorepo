import { z } from "zod/v4";
import { promotionSpendDay } from "#activities/promotion/control/budget.ts";
import type { PromotionStore } from "#activities/promotion/store.ts";
import {
  RedditRequestPostSchema,
  type RedditRequestPost,
} from "#activities/promotion/reddit-discovery/model.ts";

export const RedditReplyRecordSchema = z.strictObject({
  postId: z.string().regex(/^[a-z0-9]+$/),
  occurrenceId: z.string().min(1),
  status: z.enum(["claimed", "verified", "blocked", "uncertain"]),
  claimedAt: z.iso.datetime(),
  completedAt: z.iso.datetime().nullable(),
  receiptUrl: z.url().nullable(),
  summary: z.string(),
  post: RedditRequestPostSchema,
  replyText: z.string().min(1).max(1000),
  relevanceReason: z.string().min(1),
});
export type RedditReplyRecord = z.infer<typeof RedditReplyRecordSchema>;
const DailySchema = z.strictObject({
  reservations: z.record(z.string(), z.literal(true)),
});

function dailyReplyKey(now: Date) {
  return `reddit-outreach/daily/${promotionSpendDay(now)}.json`;
}

export async function remainingRedditReplyAllowance(
  store: PromotionStore,
  limit: number,
  now: Date,
) {
  const current = await store.read(dailyReplyKey(now), DailySchema);
  return Math.max(
    0,
    limit - Object.keys(current?.value.reservations ?? {}).length,
  );
}

export function redditReplyKey(postId: string) {
  return `reddit-outreach/posts/${z
    .string()
    .regex(/^[a-z0-9]+$/)
    .parse(postId)}.json`;
}

export async function readRedditReplyRecord(
  store: PromotionStore,
  postId: string,
) {
  const record = await store.read(
    redditReplyKey(postId),
    RedditReplyRecordSchema,
  );
  return record?.value;
}

/** Conditional creation is global across sweeps, workflow retries and workers. */
export async function claimRedditReply(
  store: PromotionStore,
  occurrenceId: string,
  now: Date,
  assignment: {
    post: RedditRequestPost;
    replyText: string;
    relevanceReason: string;
  },
): Promise<boolean> {
  const postId = assignment.post.id;
  const record: RedditReplyRecord = {
    postId,
    occurrenceId,
    status: "claimed",
    claimedAt: now.toISOString(),
    completedAt: null,
    receiptUrl: null,
    summary: "Reply execution claimed; never replay an unfinished claim",
    ...assignment,
  };
  return await store.put(
    redditReplyKey(postId),
    RedditReplyRecordSchema.parse(record),
    undefined,
  );
}

export async function finishRedditReply(
  store: PromotionStore,
  input: Pick<
    RedditReplyRecord,
    | "postId"
    | "occurrenceId"
    | "status"
    | "completedAt"
    | "receiptUrl"
    | "summary"
  >,
) {
  const key = redditReplyKey(input.postId);
  const current = await store.read(key, RedditReplyRecordSchema);
  if (
    current?.value.occurrenceId !== input.occurrenceId ||
    !["claimed", "uncertain"].includes(current.value.status)
  )
    throw new Error("Reddit reply no longer owns its original claim");
  if (!(await store.put(key, { ...current.value, ...input }, current.etag)))
    throw new Error("Concurrent Reddit reply settlement");
}

/** Reservations count uncertain sends; only a proven no-send releases a slot. */
export async function reserveRedditReplyAllowance(
  store: PromotionStore,
  postId: string,
  maxRepliesPerDay: number,
  now: Date,
): Promise<(() => Promise<void>) | null> {
  z.number().int().nonnegative().max(100).parse(maxRepliesPerDay);
  const key = dailyReplyKey(now);
  for (let attempt = 0; attempt < 5; attempt++) {
    const current = await store.read(key, DailySchema);
    const reservations = current?.value.reservations ?? {};
    if (reservations[postId] === true) return null;
    if (Object.keys(reservations).length >= maxRepliesPerDay) return null;
    if (
      !(await store.put(
        key,
        { reservations: { ...reservations, [postId]: true } },
        current?.etag,
      ))
    )
      continue;
    return async () => {
      for (let release = 0; release < 5; release++) {
        const held = await store.read(key, DailySchema);
        if (held === undefined)
          throw new Error("Reddit daily allowance disappeared");
        const next = Object.fromEntries(
          Object.entries(held.value.reservations).filter(
            ([id]) => id !== postId,
          ),
        );
        if (await store.put(key, { reservations: next }, held.etag)) return;
      }
      throw new Error("Reddit daily allowance release did not settle");
    };
  }
  throw new Error("Concurrent Reddit daily allowance update did not settle");
}
