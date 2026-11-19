import type { RiotMatchId } from "@scout-for-lol/data";
import type { EncodedSegment } from "#src/league/crawl/crawl-segment.ts";
import type { ErasedPuuidHashes } from "#src/report-lake/crawl/crawl-rows.ts";
import { eraseFromSegment } from "#src/report-lake/crawl/crawl-segment-erasure.ts";

/**
 * The erasure sweep over raw crawl segments (`crawl/v1/`).
 *
 * Every committed segment is read once per pending erasure, in
 * (`createdAt`, `sha256`) order, and rewritten without each match that names
 * any erased player. Progress is a cursor on each pending `ErasedPuuid` row,
 * saved after every page, so a sweep that stops (a run's segment budget, a
 * deploy, a failure) resumes where it left off. Re-reading a segment is
 * harmless: a clean segment is left alone, and a rewrite of the same bytes
 * yields the same object.
 *
 * A segment is replaced in this order, each step idempotent:
 *
 * 1. put the rewritten object (content-addressed, so a retry re-puts it);
 * 2. one transaction: add the new `CrawlSegment` row (keeping the original
 *    `createdAt`), repoint the kept `CrawlMatch` rows, delete the removed ones
 *    and the old row, and queue the old object in `CrawlObjectDeletion`;
 * 3. delete the old object, then its queue row.
 *
 * A crash after step 2 leaves only a queued delete, which the next sweep
 * drains before anything else.
 */

export type SweepCursor = { createdAt: Date; sha256: string };

export type SweepSegment = SweepCursor & {
  objectKey: string;
  route: string;
  dt: string;
};

export type PendingRawSweep = {
  puuidHash: string;
  cursor: SweepCursor | null;
};

export type SegmentReplacement = {
  dt: string;
  oldSha256: string;
  /** Null when no match was left and the segment was deleted outright. */
  newSha256: string | null;
};

export type RawErasureStore = {
  pending: () => Promise<PendingRawSweep[]>;
  erasedHashes: () => Promise<ErasedPuuidHashes>;
  segmentsAfter: (
    cursor: SweepCursor | null,
    limit: number,
  ) => Promise<SweepSegment[]>;
  replaceSegment: (input: {
    old: SweepSegment;
    replacement: EncodedSegment | null;
    removedMatchIds: readonly RiotMatchId[];
  }) => Promise<void>;
  saveProgress: (
    updates: readonly {
      puuidHash: string;
      cursor: SweepCursor | null;
      swept: boolean;
      segmentsRewritten: number;
      matchesRemoved: number;
    }[],
  ) => Promise<void>;
  queuedDeletions: (limit: number) => Promise<string[]>;
  forgetDeletion: (objectKey: string) => Promise<void>;
};

export type RawErasureObjects = {
  read: (objectKey: string) => Promise<Uint8Array>;
  put: (segment: EncodedSegment) => Promise<void>;
  /** Deleting an object that is already gone succeeds. */
  delete: (objectKey: string) => Promise<void>;
};

export type RawErasureSummary = {
  deletedObjects: number;
  segmentsChecked: number;
  segmentsRewritten: number;
  matchesRemoved: number;
  replacements: SegmentReplacement[];
  /** Hashes whose sweep reached the last committed segment in this run. */
  swept: string[];
};

const PAGE_SIZE = 100;
const DELETION_BATCH = 500;

function compareCursor(left: SweepCursor, right: SweepCursor): number {
  const byTime = left.createdAt.getTime() - right.createdAt.getTime();
  return byTime === 0 ? left.sha256.localeCompare(right.sha256) : byTime;
}

function laterCursor(
  left: SweepCursor | null,
  right: SweepCursor | null,
): SweepCursor | null {
  return left === null || right === null
    ? (left ?? right)
    : compareCursor(left, right) >= 0
      ? left
      : right;
}

/** Where a sweep covering every pending erasure starts: the least-advanced cursor. */
function startCursor(pending: readonly PendingRawSweep[]): SweepCursor | null {
  let start: SweepCursor | undefined;
  for (const row of pending) {
    if (row.cursor === null) return null;
    if (start === undefined || compareCursor(row.cursor, start) < 0) {
      start = row.cursor;
    }
  }
  return start ?? null;
}

async function drainDeletions(
  store: RawErasureStore,
  objects: RawErasureObjects,
  abortSignal: AbortSignal | undefined,
): Promise<number> {
  let deleted = 0;
  for (;;) {
    const keys = await store.queuedDeletions(DELETION_BATCH);
    for (const key of keys) {
      abortSignal?.throwIfAborted();
      await objects.delete(key);
      await store.forgetDeletion(key);
      deleted += 1;
    }
    if (keys.length < DELETION_BATCH) return deleted;
  }
}

/** Erase one segment; returns the replacement it made, if any. */
async function eraseSegment(input: {
  store: RawErasureStore;
  objects: RawErasureObjects;
  segment: SweepSegment;
  erased: ErasedPuuidHashes;
}): Promise<(SegmentReplacement & { removed: number }) | undefined> {
  const { store, objects, segment } = input;
  const result = eraseFromSegment({
    bytes: await objects.read(segment.objectKey),
    route: segment.route,
    dt: segment.dt,
    erased: input.erased,
  });
  if (result.kind === "clean") return undefined;
  const replacement = result.kind === "rewritten" ? result.segment : null;
  if (replacement !== null) await objects.put(replacement);
  await store.replaceSegment({
    old: segment,
    replacement,
    removedMatchIds: result.removedMatchIds,
  });
  await objects.delete(segment.objectKey);
  await store.forgetDeletion(segment.objectKey);
  return {
    dt: segment.dt,
    oldSha256: segment.sha256,
    newSha256: replacement?.sha256 ?? null,
    removed: result.removedMatchIds.length,
  };
}

/**
 * Drain queued object deletions, then sweep up to `segmentBudget` segments
 * for every pending erasure. Returns the replacements made, which the lake
 * step applies to its build's crawl ledger.
 */
export async function runRawErasureSweep(input: {
  store: RawErasureStore;
  objects: RawErasureObjects;
  segmentBudget: number;
  abortSignal?: AbortSignal | undefined;
}): Promise<RawErasureSummary> {
  const { store, objects } = input;
  const summary: RawErasureSummary = {
    deletedObjects: await drainDeletions(store, objects, input.abortSignal),
    segmentsChecked: 0,
    segmentsRewritten: 0,
    matchesRemoved: 0,
    replacements: [],
    swept: [],
  };
  const pending = await store.pending();
  if (pending.length === 0) return summary;
  const erased = await store.erasedHashes();

  let cursor = startCursor(pending);
  let reachedEnd = false;
  while (summary.segmentsChecked < input.segmentBudget) {
    input.abortSignal?.throwIfAborted();
    const limit = Math.min(
      PAGE_SIZE,
      input.segmentBudget - summary.segmentsChecked,
    );
    const page = await store.segmentsAfter(cursor, limit);
    let pageRewritten = 0;
    let pageRemoved = 0;
    for (const segment of page) {
      input.abortSignal?.throwIfAborted();
      const replaced = await eraseSegment({ store, objects, segment, erased });
      summary.segmentsChecked += 1;
      cursor = segment;
      if (replaced === undefined) continue;
      const { removed, ...replacement } = replaced;
      pageRewritten += 1;
      pageRemoved += removed;
      summary.replacements.push(replacement);
    }
    summary.segmentsRewritten += pageRewritten;
    summary.matchesRemoved += pageRemoved;
    reachedEnd = page.length < limit;
    await store.saveProgress(
      pending.map((row) => ({
        puuidHash: row.puuidHash,
        cursor: laterCursor(row.cursor, cursor),
        swept: reachedEnd,
        segmentsRewritten: pageRewritten,
        matchesRemoved: pageRemoved,
      })),
    );
    if (reachedEnd) break;
  }
  if (reachedEnd) summary.swept = pending.map((row) => row.puuidHash);
  return summary;
}
