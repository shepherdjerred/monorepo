import { z } from "zod";
import { type RawMatch } from "@scout-for-lol/data/index.ts";
import {
  createRawMatchS3Source,
  RawMatchS3ConfigSchema,
} from "./raw-match-s3.ts";

export const QueueActivityS3ConfigSchema = z.strictObject(
  RawMatchS3ConfigSchema.shape,
);

export type QueueActivityS3Config = z.infer<typeof QueueActivityS3ConfigSchema>;

/** raw queueId string → `YYYY-MM-DD` (UTC game date) → match count. */
export type QueueActivityCounts = Record<string, Record<string, number>>;

/** UTC calendar date a match was played, from its game start timestamp. */
export function matchDateString(match: RawMatch): string {
  return new Date(match.info.gameStartTimestamp).toISOString().slice(0, 10);
}

/**
 * Fold one match into the running counts.
 *
 * This is the single classification rule, shared by the pure aggregator and the
 * live S3 walk. They used to be two copies of the same loop, and only the pure
 * one had tests — so every assertion about custom-game exclusion and UTC date
 * derivation was made against code that never runs in production.
 */
function accumulateMatch(counts: QueueActivityCounts, match: RawMatch): void {
  // Custom lobbies reuse queue ids from real modes (observed: queueId 3130
  // with gameType CUSTOM_GAME) — they say nothing about a mode being live,
  // so they must not feed availability windows.
  if (match.info.gameType.toUpperCase().startsWith("CUSTOM")) {
    return;
  }
  const queueId = match.info.queueId.toString();
  const date = matchDateString(match);
  const byDate = counts[queueId] ?? {};
  byDate[date] = (byDate[date] ?? 0) + 1;
  counts[queueId] = byDate;
}

/**
 * Pure aggregation of RawMatch records into per-queue, per-day counts. Split
 * from the S3 walk so it can be unit-tested against fixtures with no live S3.
 */
export function aggregateQueueActivity(
  matches: readonly RawMatch[],
): QueueActivityCounts {
  const counts: QueueActivityCounts = {};
  for (const match of matches) {
    accumulateMatch(counts, match);
  }
  return counts;
}

/**
 * Walk the `games/YYYY/MM/DD/**` partitions across a date range and count every
 * match by its raw queue id and UTC game date. No queue filtering — the drift
 * engine needs the full picture (including unmapped queue ids).
 */
export async function collectQueueActivity(
  rawConfig: QueueActivityS3Config,
): Promise<QueueActivityCounts> {
  const config = QueueActivityS3ConfigSchema.parse(rawConfig);
  const counts: QueueActivityCounts = {};

  // Stream matches one at a time rather than collecting them before folding:
  // a 28-day lookback is tens of thousands of matches and buffering them just
  // to classify them is pointless.
  await createRawMatchS3Source(config).visitMatches((match) => {
    accumulateMatch(counts, match);
  });

  return counts;
}
