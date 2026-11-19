import { beforeEach, describe, expect, test } from "vitest";
import { puuidHash } from "#src/league/crawl/crawl-config.ts";
import type { EncodedSegment } from "#src/league/crawl/crawl-segment.ts";
import {
  runRawErasureSweep,
  type RawErasureObjects,
  type RawErasureStore,
  type SweepCursor,
  type SweepSegment,
} from "#src/report-lake/crawl/crawl-raw-erasure.ts";
import {
  crawlSegmentOf,
  distinctCrawlPuuid,
} from "#src/testing/report-lake/crawl-segments.ts";

/**
 * The raw-segment sweep against an in-memory stand-in for PostgreSQL
 * (`ErasedPuuid`, `CrawlSegment`, `CrawlMatch`, `CrawlObjectDeletion`) and S3.
 */

const DAY = "2026-11-13";
const ERASED = distinctCrawlPuuid("erased");
const HASH = puuidHash(ERASED);

type Progress = {
  cursor: SweepCursor | null;
  swept: boolean;
  segmentsRewritten: number;
  matchesRemoved: number;
};

class MemoryErasure implements RawErasureStore, RawErasureObjects {
  objects = new Map<string, Uint8Array>();
  segments: SweepSegment[] = [];
  /** riotMatchId → segment sha256 */
  matches = new Map<string, string>();
  deletions = new Set<string>();
  progress = new Map<string, Progress>();
  erased = new Set<string>();
  reads: string[] = [];
  /** Throw from `delete` once, as a crash between commit and cleanup would. */
  failNextDelete = false;

  add(segment: EncodedSegment, createdAt: Date, matchIds: readonly string[]) {
    this.objects.set(segment.objectKey, segment.bytes);
    this.segments.push({
      sha256: segment.sha256,
      objectKey: segment.objectKey,
      route: segment.route,
      dt: segment.dt,
      createdAt,
    });
    for (const id of matchIds) this.matches.set(id, segment.sha256);
  }

  erase(hash: string) {
    this.erased.add(hash);
    this.progress.set(hash, {
      cursor: null,
      swept: false,
      segmentsRewritten: 0,
      matchesRemoved: 0,
    });
  }

  pending() {
    return Promise.resolve(
      [...this.progress.entries()]
        .filter(([, row]) => !row.swept)
        .map(([hash, row]) => ({ puuidHash: hash, cursor: row.cursor })),
    );
  }
  erasedHashes() {
    return Promise.resolve(new Set(this.erased));
  }
  segmentsAfter(cursor: SweepCursor | null, limit: number) {
    const ordered = this.segments.toSorted(
      (left, right) =>
        left.createdAt.getTime() - right.createdAt.getTime() ||
        left.sha256.localeCompare(right.sha256),
    );
    return Promise.resolve(
      ordered
        .filter(
          (segment) =>
            cursor === null ||
            segment.createdAt > cursor.createdAt ||
            (segment.createdAt.getTime() === cursor.createdAt.getTime() &&
              segment.sha256 > cursor.sha256),
        )
        .slice(0, limit),
    );
  }
  replaceSegment(input: {
    old: SweepSegment;
    replacement: EncodedSegment | null;
    removedMatchIds: readonly string[];
  }) {
    const { old, replacement } = input;
    for (const id of input.removedMatchIds) this.matches.delete(id);
    for (const [id, sha] of this.matches) {
      if (sha !== old.sha256) continue;
      if (replacement === null) this.matches.delete(id);
      else this.matches.set(id, replacement.sha256);
    }
    this.segments = this.segments.filter((s) => s.sha256 !== old.sha256);
    if (replacement !== null) {
      this.segments.push({
        sha256: replacement.sha256,
        objectKey: replacement.objectKey,
        route: replacement.route,
        dt: replacement.dt,
        createdAt: old.createdAt,
      });
    }
    this.deletions.add(old.objectKey);
    return Promise.resolve();
  }
  saveProgress(
    updates: readonly {
      puuidHash: string;
      cursor: SweepCursor | null;
      swept: boolean;
      segmentsRewritten: number;
      matchesRemoved: number;
    }[],
  ) {
    for (const update of updates) {
      const row = this.progress.get(update.puuidHash);
      if (row === undefined) throw new Error("unknown erasure");
      row.cursor = update.cursor;
      row.swept ||= update.swept;
      row.segmentsRewritten += update.segmentsRewritten;
      row.matchesRemoved += update.matchesRemoved;
    }
    return Promise.resolve();
  }
  queuedDeletions(limit: number) {
    return Promise.resolve([...this.deletions].slice(0, limit));
  }
  forgetDeletion(objectKey: string) {
    this.deletions.delete(objectKey);
    return Promise.resolve();
  }

  read(objectKey: string) {
    this.reads.push(objectKey);
    const bytes = this.objects.get(objectKey);
    return bytes === undefined
      ? Promise.reject(new Error(`no object ${objectKey}`))
      : Promise.resolve(bytes);
  }
  put(segment: EncodedSegment) {
    this.objects.set(segment.objectKey, segment.bytes);
    return Promise.resolve();
  }
  delete(objectKey: string) {
    if (this.failNextDelete) {
      this.failNextDelete = false;
      return Promise.reject(new Error("crashed before the old object went"));
    }
    this.objects.delete(objectKey);
    return Promise.resolve();
  }
}

let memory: MemoryErasure;

function sweep(segmentBudget = 1000) {
  return runRawErasureSweep({ store: memory, objects: memory, segmentBudget });
}

function at(minute: number): Date {
  return new Date(Date.UTC(2026, 10, 13, 12, minute));
}

beforeEach(() => {
  memory = new MemoryErasure();
});

describe("runRawErasureSweep", () => {
  test("rewrites only the segments naming the player and repoints their kept matches", async () => {
    const mixed = await crawlSegmentOf(DAY, [
      { matchId: "NA1_9500000001" },
      { matchId: "NA1_9500000002", player: ERASED },
    ]);
    const clean = await crawlSegmentOf(DAY, [{ matchId: "NA1_9500000003" }]);
    const only = await crawlSegmentOf(DAY, [
      { matchId: "NA1_9500000004", player: ERASED },
    ]);
    memory.add(mixed, at(1), ["NA1_9500000001", "NA1_9500000002"]);
    memory.add(clean, at(2), ["NA1_9500000003"]);
    memory.add(only, at(3), ["NA1_9500000004"]);
    const cleanBytes = clean.bytes;
    memory.erase(HASH);

    const summary = await sweep();

    expect(summary).toMatchObject({
      segmentsRewritten: 2,
      matchesRemoved: 2,
      swept: [HASH],
    });
    const [rewritten, emptied] = summary.replacements;
    expect(emptied).toEqual({
      dt: DAY,
      oldSha256: only.sha256,
      newSha256: null,
    });
    expect(rewritten?.oldSha256).toBe(mixed.sha256);
    const newSha = rewritten?.newSha256;
    if (newSha === undefined || newSha === null) throw new Error("no rewrite");

    // The originals are gone from S3; the clean segment is the same bytes.
    expect(memory.objects.has(mixed.objectKey)).toBe(false);
    expect(memory.objects.has(only.objectKey)).toBe(false);
    expect(memory.objects.get(clean.objectKey)).toEqual(cleanBytes);
    expect(memory.deletions.size).toBe(0);
    for (const bytes of memory.objects.values()) {
      expect(
        new TextDecoder().decode(Bun.zstdDecompressSync(bytes)),
      ).not.toContain(ERASED);
    }
    expect(Object.fromEntries(memory.matches)).toEqual({
      NA1_9500000001: newSha,
      NA1_9500000003: clean.sha256,
    });
    // The replacement keeps its original's place in the sweep order.
    expect(memory.segments.find((s) => s.sha256 === newSha)?.createdAt).toEqual(
      at(1),
    );
    expect(memory.progress.get(HASH)).toMatchObject({
      swept: true,
      segmentsRewritten: 2,
      matchesRemoved: 2,
    });
  });

  test("a second run after the sweep finished is a no-op", async () => {
    memory.add(
      await crawlSegmentOf(DAY, [
        { matchId: "NA1_9500000011" },
        { matchId: "NA1_9500000012", player: ERASED },
      ]),
      at(1),
      ["NA1_9500000011", "NA1_9500000012"],
    );
    memory.erase(HASH);
    await sweep();
    const objects = new Map(memory.objects);
    const segments = [...memory.segments];
    memory.reads = [];

    const again = await sweep();

    expect(again).toEqual({
      deletedObjects: 0,
      segmentsChecked: 0,
      segmentsRewritten: 0,
      matchesRemoved: 0,
      replacements: [],
      swept: [],
    });
    expect(memory.reads).toEqual([]);
    expect(memory.objects).toEqual(objects);
    expect(memory.segments).toEqual(segments);
  });

  test("resumes from its saved cursor when a run's budget ends the sweep", async () => {
    const keys: string[] = [];
    for (let index = 0; index < 5; index += 1) {
      const id = `NA1_950000002${index.toString()}`;
      const segment = await crawlSegmentOf(DAY, [
        index === 3 ? { matchId: id, player: ERASED } : { matchId: id },
      ]);
      keys.push(segment.objectKey);
      memory.add(segment, at(index), [id]);
    }
    memory.erase(HASH);

    const first = await sweep(2);
    expect(first).toMatchObject({ segmentsChecked: 2, swept: [] });
    expect(memory.progress.get(HASH)?.swept).toBe(false);
    expect(memory.progress.get(HASH)?.cursor?.createdAt).toEqual(at(1));

    memory.reads = [];
    const second = await sweep(10);
    expect(second).toMatchObject({ segmentsRewritten: 1, swept: [HASH] });
    // Nothing before the cursor was read again; everything after it was.
    expect(memory.reads).not.toContain(keys[0]);
    expect(memory.reads).not.toContain(keys[1]);
    expect(memory.reads).toEqual(
      expect.arrayContaining([keys[2], keys[3], keys[4]]),
    );
  });

  test("a later erasure sweeps from the start while an earlier one keeps its place", async () => {
    const later = distinctCrawlPuuid("later");
    memory.add(
      await crawlSegmentOf(DAY, [{ matchId: "NA1_9500000031", player: later }]),
      at(1),
      ["NA1_9500000031"],
    );
    memory.add(
      await crawlSegmentOf(DAY, [{ matchId: "NA1_9500000032" }]),
      at(2),
      ["NA1_9500000032"],
    );
    memory.erase(HASH);
    await sweep(1);
    memory.erase(puuidHash(later));

    const summary = await sweep();

    expect(summary.swept.toSorted()).toEqual(
      [HASH, puuidHash(later)].toSorted(),
    );
    expect(summary.matchesRemoved).toBe(1);
    expect(memory.matches.has("NA1_9500000031")).toBe(false);
  });

  test("finishes a replacement whose old object was never deleted", async () => {
    const segment = await crawlSegmentOf(DAY, [
      { matchId: "NA1_9500000041" },
      { matchId: "NA1_9500000042", player: ERASED },
    ]);
    memory.add(segment, at(1), ["NA1_9500000041", "NA1_9500000042"]);
    memory.erase(HASH);
    memory.failNextDelete = true;
    await expect(sweep()).rejects.toThrow("crashed");
    // The row swap committed, so only the queued delete is left.
    expect([...memory.deletions]).toEqual([segment.objectKey]);
    expect(memory.objects.has(segment.objectKey)).toBe(true);

    const resumed = await sweep();

    expect(resumed.deletedObjects).toBe(1);
    expect(memory.objects.has(segment.objectKey)).toBe(false);
    expect(memory.deletions.size).toBe(0);
    expect(resumed.swept).toEqual([HASH]);
  });

  test("drains objects a fenced crawl tick queued even with no erasure pending", async () => {
    memory.objects.set(
      "crawl/v1/route=na1/dt=2026-11-13/seg-x.ndjson.zst",
      new Uint8Array([1]),
    );
    memory.deletions.add("crawl/v1/route=na1/dt=2026-11-13/seg-x.ndjson.zst");

    const summary = await sweep();

    expect(summary.deletedObjects).toBe(1);
    expect(memory.objects.size).toBe(0);
  });
});
