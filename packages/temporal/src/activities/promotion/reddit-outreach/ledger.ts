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
const DAY_MS = 24 * 60 * 60 * 1000;

function dailyReplyKey(day: string) {
  return `reddit-outreach/daily/${day}.json`;
}

export async function remainingRedditReplyAllowance(
  store: PromotionStore,
  limit: number,
  now: Date,
) {
  const reservations = await readRedditReplyReservations(
    store,
    promotionSpendDay(now),
  );
  return Math.max(0, limit - reservations.length);
}

export async function readRedditReplyReservations(
  store: PromotionStore,
  day: string,
) {
  const current = await store.read(dailyReplyKey(day), DailySchema);
  return Object.keys(current?.value.reservations ?? {});
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

function normalizeReplyText(text: string) {
  return text.replaceAll(/\s+/gu, " ").trim();
}

/** Check under the Reddit account lock, before reserving a new reply. */
export async function hasRecentRedditReply(
  store: PromotionStore,
  subreddit: string,
  replyText: string,
  now: Date,
): Promise<boolean> {
  const cutoff = now.getTime() - DAY_MS;
  // Iterate Pacific calendar date labels in UTC. A 24-hour window across
  // spring-forward can intersect three Pacific dates.
  const firstDay = Date.parse(promotionSpendDay(new Date(cutoff)));
  const lastDay = Date.parse(promotionSpendDay(now));
  const days: string[] = [];
  for (let day = firstDay; day <= lastDay; day += DAY_MS)
    days.push(new Date(day).toISOString().slice(0, 10));
  const reservations = await Promise.all(
    days.map((day) => readRedditReplyReservations(store, day)),
  );
  // Proven no-send outcomes release their reservation. Retained reservations
  // still count when the record is claimed, uncertain, or blocked.
  const records = await Promise.all(
    [...new Set(reservations.flat())].map((id) =>
      readRedditReplyRecord(store, id),
    ),
  );
  const community = subreddit.toLowerCase();
  const content = normalizeReplyText(replyText);
  return records.some(
    (record) =>
      record?.post.subreddit.toLowerCase() === community &&
      Date.parse(record.completedAt ?? record.claimedAt) > cutoff &&
      normalizeReplyText(record.replyText) === content,
  );
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
  const key = dailyReplyKey(promotionSpendDay(now));
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
