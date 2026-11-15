import { createHash } from "node:crypto";
import { LeaguePuuidSchema, RiotMatchIdSchema } from "@scout-for-lol/data";
import { describe, expect, test } from "vitest";
import type { CrawlRecord } from "./crawl-records.ts";
import {
  CRAWL_OBJECT_PREFIX,
  crawlSegmentKey,
  decodeSegment,
  encodeSegment,
} from "./crawl-segment.ts";

function record(id: string): CrawlRecord {
  const matchId = RiotMatchIdSchema.parse(id);
  return {
    v: 1,
    matchId,
    platform: "NA1",
    crawledAt: "2026-11-14T00:00:00.000Z",
    depth: 0,
    visited: {
      puuid: LeaguePuuidSchema.parse("p".repeat(78)),
      tier: "GOLD",
      division: "II",
    },
    match: { metadata: { matchId }, info: { queueId: 420 } },
    timeline: null,
  };
}

describe("crawl segment", () => {
  test("is keyed by route, day and the SHA-256 of its compressed bytes", () => {
    const segment = encodeSegment({
      route: "na1",
      dt: "2026-11-14",
      records: [record("NA1_1"), record("NA1_2")],
    });
    const digest = createHash("sha256").update(segment.bytes).digest("hex");
    expect(segment.sha256).toBe(digest);
    expect(segment.objectKey).toBe(
      `crawl/v1/route=na1/dt=2026-11-14/seg-${digest}.ndjson.zst`,
    );
    expect(segment.objectKey.startsWith(CRAWL_OBJECT_PREFIX)).toBe(true);
    expect(segment.matchCount).toBe(2);
  });

  test("round-trips minified NDJSON, one record a line", () => {
    const records = [record("NA1_1"), record("NA1_2")];
    const segment = encodeSegment({ route: "na1", dt: "2026-11-14", records });
    expect(decodeSegment(segment.bytes)).toEqual(records);
    const text = new TextDecoder().decode(
      Bun.zstdDecompressSync(segment.bytes),
    );
    expect(text.endsWith("\n")).toBe(true);
    expect(text.trimEnd().split("\n")).toHaveLength(2);
    expect(text).not.toContain("  ");
  });

  test("is idempotent: the same records give the same key", () => {
    const input = {
      route: "na1",
      dt: "2026-11-14",
      records: [record("NA1_1")],
    };
    expect(encodeSegment(input).objectKey).toBe(encodeSegment(input).objectKey);
  });

  test("refuses an empty segment", () => {
    expect(() =>
      encodeSegment({ route: "na1", dt: "2026-11-14", records: [] }),
    ).toThrow("at least one record");
  });

  test("builds the documented key shape", () => {
    expect(
      crawlSegmentKey({ route: "euw1", dt: "2026-01-02", sha256: "ab" }),
    ).toBe("crawl/v1/route=euw1/dt=2026-01-02/seg-ab.ndjson.zst");
  });
});
