import { describe, expect, test } from "vitest";
import { puuidHash } from "#src/league/crawl/crawl-config.ts";
import { decodeSegment } from "#src/league/crawl/crawl-segment.ts";
import { eraseFromSegment } from "#src/report-lake/crawl/crawl-segment-erasure.ts";
import { segmentSha256 } from "#src/report-lake/crawl/crawl-rows.ts";
import {
  crawlSegmentOf,
  distinctCrawlPuuid,
} from "#src/testing/report-lake/crawl-segments.ts";

/** Raw segment rewrite on in-memory bytes: no S3, no PostgreSQL. */

const DAY = "2026-11-13";
const ERASED = distinctCrawlPuuid("erased");
const OTHER = distinctCrawlPuuid("other");
const ERASED_SET = new Set([puuidHash(ERASED)]);

function lines(bytes: Uint8Array): string[] {
  return new TextDecoder()
    .decode(Bun.zstdDecompressSync(bytes))
    .split("\n")
    .filter((line) => line.length > 0);
}

describe("eraseFromSegment", () => {
  test("drops only the matches naming the erased player and keeps every other line byte for byte", async () => {
    const original = await crawlSegmentOf(DAY, [
      { matchId: "NA1_9400000001" },
      { matchId: "NA1_9400000002", player: ERASED },
      { matchId: "NA1_9400000003", player: OTHER },
    ]);
    const result = eraseFromSegment({
      bytes: original.bytes,
      route: original.route,
      dt: original.dt,
      erased: ERASED_SET,
    });
    if (result.kind !== "rewritten") throw new Error(`got ${result.kind}`);
    expect(result.removedMatchIds).toEqual(["NA1_9400000002"]);

    const before = lines(original.bytes);
    expect(lines(result.segment.bytes)).toEqual([before[0], before[2]]);
    expect(
      new TextDecoder().decode(Bun.zstdDecompressSync(result.segment.bytes)),
    ).not.toContain(ERASED);
    expect(result.segment).toMatchObject({
      route: "na1",
      dt: DAY,
      matchCount: 2,
      sha256: segmentSha256(result.segment.bytes),
      objectKey: `crawl/v1/route=na1/dt=${DAY}/seg-${result.segment.sha256}.ndjson.zst`,
    });
    expect(decodeSegment(result.segment.bytes)).toHaveLength(2);
  });

  test("a second pass over the rewritten segment is a no-op", async () => {
    const original = await crawlSegmentOf(DAY, [
      { matchId: "NA1_9400000011" },
      { matchId: "NA1_9400000012", player: ERASED },
    ]);
    const first = eraseFromSegment({
      bytes: original.bytes,
      route: "na1",
      dt: DAY,
      erased: ERASED_SET,
    });
    if (first.kind !== "rewritten") throw new Error(`got ${first.kind}`);
    expect(
      eraseFromSegment({
        bytes: first.segment.bytes,
        route: "na1",
        dt: DAY,
        erased: ERASED_SET,
      }),
    ).toEqual({ kind: "clean" });
    // Rewriting the original again converges on the same object.
    const again = eraseFromSegment({
      bytes: original.bytes,
      route: "na1",
      dt: DAY,
      erased: ERASED_SET,
    });
    if (again.kind !== "rewritten") throw new Error(`got ${again.kind}`);
    expect(again.segment.sha256).toBe(first.segment.sha256);
  });

  test("reports a segment whose every match names the player as emptied", async () => {
    const original = await crawlSegmentOf(DAY, [
      { matchId: "NA1_9400000021", player: ERASED },
    ]);
    expect(
      eraseFromSegment({
        bytes: original.bytes,
        route: "na1",
        dt: DAY,
        erased: ERASED_SET,
      }),
    ).toEqual({ kind: "emptied", removedMatchIds: ["NA1_9400000021"] });
  });

  test("leaves a segment without the player, or with no erasures, untouched", async () => {
    const original = await crawlSegmentOf(DAY, [
      { matchId: "NA1_9400000031", player: OTHER },
    ]);
    for (const erased of [ERASED_SET, new Set<string>()]) {
      expect(
        eraseFromSegment({
          bytes: original.bytes,
          route: "na1",
          dt: DAY,
          erased,
        }),
      ).toEqual({ kind: "clean" });
    }
  });
});
