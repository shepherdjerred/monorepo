import { z } from "zod/v4";
import type { PromotionStore } from "#activities/promotion/store.ts";
import { validateRedditFeedPageUrl } from "./browser-reader.ts";

const WindowSchema = z.strictObject({
  since: z.iso.datetime(),
  until: z.iso.datetime(),
  after: z.url().nullable(),
  visited: z.array(z.url()),
});
export const RedditScanCheckpointSchema = z.strictObject({
  version: z.literal(1),
  completedThrough: z.iso.datetime(),
  pending: WindowSchema.nullable(),
  settled: z.record(z.string(), z.iso.datetime()),
});
export type RedditScanCheckpoint = z.infer<typeof RedditScanCheckpointSchema>;
export type RedditScanWindow = z.infer<typeof WindowSchema>;
export type RedditCheckpointInput = {
  store: PromotionStore;
  subreddit: string;
  preview: boolean;
  now: number;
  maxAgeHours: number;
};

export function redditCheckpointKey(subreddit: string, preview: boolean) {
  const name = z
    .string()
    .regex(/^\w{3,21}$/u)
    .parse(subreddit)
    .toLowerCase();
  return `reddit-outreach/checkpoints/${preview ? "preview" : "live"}/${name}.json`;
}

async function updateCheckpoint(
  input: RedditCheckpointInput,
  change: (checkpoint: RedditScanCheckpoint) => RedditScanCheckpoint,
) {
  const key = redditCheckpointKey(input.subreddit, input.preview);
  for (let attempt = 0; attempt < 5; attempt++) {
    const current = await input.store.read(key, RedditScanCheckpointSchema);
    const checkpoint: RedditScanCheckpoint = current?.value ?? {
      version: 1,
      completedThrough: new Date(input.now - 15 * 60_000).toISOString(),
      pending: null,
      settled: {},
    };
    const next = RedditScanCheckpointSchema.parse(change(checkpoint));
    if (await input.store.put(key, next, current?.etag)) return next;
  }
  throw new Error("Concurrent Reddit scan checkpoint update did not settle");
}

/** A pending sweep keeps its original end while older unread work expires at 24h. */
export async function openRedditScanWindow(input: RedditCheckpointInput) {
  z.number().int().min(1).max(24).parse(input.maxAgeHours);
  return await updateCheckpoint(input, (checkpoint) => {
    const cutoff = input.now - input.maxAgeHours * 3_600_000;
    const settled = Object.fromEntries(
      Object.entries(checkpoint.settled).filter(
        ([, createdAt]) => Date.parse(createdAt) >= cutoff,
      ),
    );
    const existing = checkpoint.pending;
    if (existing !== null && Date.parse(existing.until) >= cutoff) {
      if (existing.after !== null)
        validateRedditFeedPageUrl(existing.after, input.subreddit);
      return {
        ...checkpoint,
        settled,
        pending: {
          ...existing,
          since: new Date(
            Math.max(Date.parse(existing.since), cutoff),
          ).toISOString(),
        },
      };
    }
    const since = Math.max(Date.parse(checkpoint.completedThrough), cutoff);
    return {
      ...checkpoint,
      settled,
      pending: {
        since: new Date(since).toISOString(),
        until: new Date(input.now).toISOString(),
        after: null,
        visited: [],
      },
    };
  });
}

function ownedWindow(
  checkpoint: RedditScanCheckpoint,
  expected: RedditScanWindow,
) {
  const pending = checkpoint.pending;
  if (
    pending?.until !== expected.until ||
    pending.since !== expected.since ||
    pending.after !== expected.after
  )
    throw new Error("Reddit scan page no longer owns its checkpoint window");
  return pending;
}

/** The caller settles each row only after its durable disposition exists. */
export async function settleRedditScanRows(
  input: RedditCheckpointInput,
  window: RedditScanWindow,
  rows: readonly { id: string; createdAt: string }[],
) {
  return await updateCheckpoint(input, (checkpoint) => {
    ownedWindow(checkpoint, window);
    return {
      ...checkpoint,
      settled: {
        ...checkpoint.settled,
        ...Object.fromEntries(
          rows.map((row) => [row.id, new Date(row.createdAt).toISOString()]),
        ),
      },
    };
  });
}

export async function advanceRedditScanPage(
  input: RedditCheckpointInput,
  window: RedditScanWindow,
  next: string | null,
) {
  if (next !== null) validateRedditFeedPageUrl(next, input.subreddit);
  return await updateCheckpoint(input, (checkpoint) => {
    const pending = ownedWindow(checkpoint, window);
    if (next === null)
      return { ...checkpoint, completedThrough: pending.until, pending: null };
    if (pending.visited.includes(next) || next === pending.after)
      throw new Error("Reddit listing repeated its pagination cursor");
    return {
      ...checkpoint,
      pending: { ...pending, after: next, visited: [...pending.visited, next] },
    };
  });
}

export async function restartRedditScanPage(
  input: RedditCheckpointInput,
  window: RedditScanWindow,
) {
  return await updateCheckpoint(input, (checkpoint) => {
    const pending = ownedWindow(checkpoint, window);
    return { ...checkpoint, pending: { ...pending, after: null, visited: [] } };
  });
}
