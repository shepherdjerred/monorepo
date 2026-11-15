import { createHash } from "node:crypto";
import type { CrawlRecord } from "./crawl-records.ts";

/** Every crawl object lives under this prefix and nowhere else. */
export const CRAWL_OBJECT_PREFIX = "crawl/v1/";

export type EncodedSegment = {
  sha256: string;
  objectKey: string;
  route: string;
  dt: string;
  bytes: Uint8Array;
  matchCount: number;
};

/** `crawl/v1/route=<route>/dt=<YYYY-MM-DD>/seg-<sha256>.ndjson.zst` */
export function crawlSegmentKey(input: {
  route: string;
  dt: string;
  sha256: string;
}): string {
  return `${CRAWL_OBJECT_PREFIX}route=${input.route}/dt=${input.dt}/seg-${input.sha256}.ndjson.zst`;
}

/**
 * Minified NDJSON (one record a line), zstd-compressed. The key is the SHA-256
 * of the compressed bytes, so a re-write of the same segment is idempotent and
 * the key itself is the integrity check.
 */
export function encodeSegment(input: {
  route: string;
  dt: string;
  records: readonly CrawlRecord[];
}): EncodedSegment {
  if (input.records.length === 0) {
    throw new Error("A crawl segment holds at least one record");
  }
  const ndjson = `${input.records.map((record) => JSON.stringify(record)).join("\n")}\n`;
  const bytes = Bun.zstdCompressSync(new TextEncoder().encode(ndjson));
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  return {
    sha256,
    objectKey: crawlSegmentKey({ route: input.route, dt: input.dt, sha256 }),
    route: input.route,
    dt: input.dt,
    bytes,
    matchCount: input.records.length,
  };
}

/** Decode a segment back to its records; the reader the later lake fold will use. */
export function decodeSegment(bytes: Uint8Array): unknown[] {
  const text = new TextDecoder().decode(Bun.zstdDecompressSync(bytes));
  return text
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line): unknown => JSON.parse(line));
}
