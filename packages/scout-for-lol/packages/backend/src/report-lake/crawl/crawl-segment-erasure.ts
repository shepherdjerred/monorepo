import type { RiotMatchId } from "@scout-for-lol/data";
import { puuidHash } from "#src/league/crawl/crawl-config.ts";
import {
  crawlSegmentKey,
  type EncodedSegment,
} from "#src/league/crawl/crawl-segment.ts";
import {
  crawlLinePuuids,
  segmentSha256,
  type ErasedPuuidHashes,
} from "#src/report-lake/crawl/crawl-rows.ts";

/**
 * One raw crawl segment without the matches that name an erased player.
 *
 * Every other line is kept byte for byte, in order, and the result is encoded
 * exactly as `encodeSegment` encodes a new segment (NDJSON with a trailing
 * newline, zstd at the default level), so the same input always yields the
 * same bytes and SHA-256: rewriting a segment twice converges on one object.
 */
export type SegmentErasure =
  | { kind: "clean" }
  | {
      kind: "rewritten";
      segment: EncodedSegment;
      removedMatchIds: RiotMatchId[];
    }
  | { kind: "emptied"; removedMatchIds: RiotMatchId[] };

export function eraseFromSegment(input: {
  bytes: Uint8Array;
  route: string;
  dt: string;
  erased: ErasedPuuidHashes;
}): SegmentErasure {
  if (input.erased.size === 0) return { kind: "clean" };
  const text = new TextDecoder().decode(Bun.zstdDecompressSync(input.bytes));
  const kept: string[] = [];
  const removedMatchIds: RiotMatchId[] = [];
  for (const line of text.split("\n")) {
    if (line.length === 0) continue;
    const { matchId, puuids } = crawlLinePuuids(JSON.parse(line));
    if (puuids.some((puuid) => input.erased.has(puuidHash(puuid)))) {
      removedMatchIds.push(matchId);
    } else {
      kept.push(line);
    }
  }
  if (removedMatchIds.length === 0) return { kind: "clean" };
  if (kept.length === 0) return { kind: "emptied", removedMatchIds };
  const bytes = Bun.zstdCompressSync(
    new TextEncoder().encode(`${kept.join("\n")}\n`),
  );
  const sha256 = segmentSha256(bytes);
  return {
    kind: "rewritten",
    removedMatchIds,
    segment: {
      sha256,
      objectKey: crawlSegmentKey({ route: input.route, dt: input.dt, sha256 }),
      route: input.route,
      dt: input.dt,
      bytes,
      matchCount: kept.length,
    },
  };
}
