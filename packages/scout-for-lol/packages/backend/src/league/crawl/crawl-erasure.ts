import type { LeaguePuuid } from "@scout-for-lol/data";
import type { ExtendedPrismaClient } from "#src/database/index.ts";
import {
  countExploreCopies,
  redactExploreCopies,
  type ExploreCopyCounts,
} from "#src/explore/inspection/erasure-redaction.ts";
import { puuidHash } from "./crawl-config.ts";

/**
 * The erasure request for a crawled player: the immediate half of the
 * deletion pipeline. The durable half (raw segments and lake day files) runs
 * in every lake fold and rebuild (`report-lake/crawl/crawl-erasure-step.ts`).
 *
 * Applying a request, in one transaction:
 *
 * - records the PUUID's SHA-256 in `ErasedPuuid`, which every crawl check
 *   reads (admission, claim, commit, segment read, fold, day rebuild,
 *   compaction) and which global crawl reads treat as a tombstone until the
 *   lake erasure publishes;
 * - deletes the player's `CrawlFrontier` row, so the crawl never visits them.
 *
 * Then it redacts Explore's stored copies, which can only be found while the
 * plain identifiers are at hand: the list keeps hashes only. Applying the
 * same request again changes nothing it already changed.
 *
 * The tracked corpus (players Scout's servers follow) is out of scope.
 */

export type CrawlErasureTarget = {
  puuid: LeaguePuuid;
  /** The player's `gameName#tagLine`, when known, so copies naming only it are found. */
  riotId?: string | undefined;
};

export type CrawlErasureProgress = {
  erasedAt: Date;
  rawSweptAt: Date | null;
  lakeErasedAt: Date | null;
  segmentsRewritten: number;
  matchesRemoved: number;
  copiesRedacted: number;
  queuedObjectDeletions: number;
};

export type CrawlErasurePlan = {
  puuidHash: string;
  /** Null until the erasure is recorded. */
  progress: CrawlErasureProgress | null;
  frontierRow: boolean;
  matchesVisited: number;
  copies: ExploreCopyCounts;
};

export type CrawlErasureResult = {
  puuidHash: string;
  newlyRecorded: boolean;
  frontierRowsDeleted: number;
  copies: ExploreCopyCounts;
};

function needles(target: CrawlErasureTarget): string[] {
  return [
    target.puuid,
    ...(target.riotId === undefined ? [] : [target.riotId]),
  ];
}

async function progressOf(
  prisma: ExtendedPrismaClient,
  hash: string,
): Promise<CrawlErasureProgress | null> {
  const row = await prisma.erasedPuuid.findUnique({
    where: { puuidHash: hash },
  });
  if (row === null) return null;
  return {
    erasedAt: row.erasedAt,
    rawSweptAt: row.rawSweptAt,
    lakeErasedAt: row.lakeErasedAt,
    segmentsRewritten: row.segmentsRewritten,
    matchesRemoved: row.matchesRemoved,
    copiesRedacted: row.copiesRedacted,
    queuedObjectDeletions: await prisma.crawlObjectDeletion.count(),
  };
}

/** What applying the request would do, and how far an earlier one has got. */
export async function planCrawlErasure(
  prisma: ExtendedPrismaClient,
  target: CrawlErasureTarget,
): Promise<CrawlErasurePlan> {
  const hash = puuidHash(target.puuid);
  const [progress, frontier, matchesVisited, copies] = await Promise.all([
    progressOf(prisma, hash),
    prisma.crawlFrontier.findUnique({
      where: { puuid: target.puuid },
      select: { puuid: true },
    }),
    prisma.crawlMatch.count({ where: { visitedPuuid: target.puuid } }),
    countExploreCopies(prisma, needles(target)),
  ]);
  return {
    puuidHash: hash,
    progress,
    frontierRow: frontier !== null,
    matchesVisited,
    copies,
  };
}

export async function applyCrawlErasure(
  prisma: ExtendedPrismaClient,
  target: CrawlErasureTarget,
): Promise<CrawlErasureResult> {
  const hash = puuidHash(target.puuid);
  const { recorded, frontierRowsDeleted } = await prisma.$transaction(
    async (tx) => {
      const created = await tx.erasedPuuid.createMany({
        data: [{ puuidHash: hash }],
        skipDuplicates: true,
      });
      const deleted = await tx.crawlFrontier.deleteMany({
        where: { puuid: target.puuid },
      });
      return { recorded: created.count, frontierRowsDeleted: deleted.count };
    },
  );
  const copies = await redactExploreCopies(prisma, needles(target));
  const redacted = copies.toolPayloads + copies.messages + copies.runs;
  if (redacted > 0) {
    await prisma.erasedPuuid.update({
      where: { puuidHash: hash },
      data: { copiesRedacted: { increment: redacted } },
    });
  }
  return {
    puuidHash: hash,
    newlyRecorded: recorded === 1,
    frontierRowsDeleted,
    copies,
  };
}

/** Whether every durable step has finished: no tombstone, no raw segment left, no object queued. */
export function crawlErasureComplete(
  progress: CrawlErasureProgress | null,
): boolean {
  return (
    progress?.rawSweptAt != null &&
    progress.lakeErasedAt !== null &&
    progress.queuedObjectDeletions === 0
  );
}
