import { RiotMatchIdSchema } from "@scout-for-lol/data";
import type { Db, ExtendedPrismaClient } from "#src/database/index.ts";
import {
  CRAWL_MAX_DEPTH,
  crawlCooldownEnd,
  puuidHash,
} from "./crawl-config.ts";
import type {
  CommitInput,
  CrawlStore,
  NewFrontierPlayer,
  SeedCursor,
} from "./crawl-store.ts";

const CONTROL_ID = "default";
const DAY_MS = 86_400_000;

/** Players seen more than once in one batch enter once, at their shallowest depth. */
function shallowestFirst(
  players: readonly NewFrontierPlayer[],
): NewFrontierPlayer[] {
  const byPuuid = new Map<string, NewFrontierPlayer>();
  for (const player of players) {
    const existing = byPuuid.get(player.puuid);
    if (existing === undefined || player.depth < existing.depth) {
      byPuuid.set(player.puuid, player);
    }
  }
  return [...byPuuid.values()];
}

async function erasedHashes(
  db: Pick<Db, "erasedPuuid">,
  puuids: readonly string[],
): Promise<Set<string>> {
  if (puuids.length === 0) return new Set();
  const rows = await db.erasedPuuid.findMany({
    where: { puuidHash: { in: puuids.map((puuid) => puuidHash(puuid)) } },
    select: { puuidHash: true },
  });
  return new Set(rows.map((row) => row.puuidHash));
}

async function admitPlayers(
  db: Pick<Db, "erasedPuuid" | "crawlFrontier">,
  players: readonly NewFrontierPlayer[],
  now: Date,
): Promise<{ admitted: number; erased: number }> {
  const candidates = shallowestFirst(players).filter(
    (player) => player.depth <= CRAWL_MAX_DEPTH,
  );
  const erased = await erasedHashes(
    db,
    candidates.map((player) => player.puuid),
  );
  const allowed = candidates.filter(
    (player) => !erased.has(puuidHash(player.puuid)),
  );
  if (allowed.length === 0) return { admitted: 0, erased: erased.size };
  const result = await db.crawlFrontier.createMany({
    data: allowed.map((player) => ({
      puuid: player.puuid,
      platformRoute: player.platformRoute,
      depth: player.depth,
      seedMatchId: player.seedMatchId,
      nextEligibleAt: now,
    })),
    skipDuplicates: true,
  });
  return { admitted: result.count, erased: erased.size };
}

/** The PostgreSQL-backed crawl store. */
export function createPrismaCrawlStore(
  prisma: ExtendedPrismaClient,
): CrawlStore {
  return {
    async seedCursor(now: Date): Promise<SeedCursor> {
      const row = await prisma.crawlControl.upsert({
        where: { id: CONTROL_ID },
        update: {},
        create: {
          id: CONTROL_ID,
          seedCursorObservedAt: new Date(now.getTime() - DAY_MS),
        },
      });
      return {
        observedAt: row.seedCursorObservedAt,
        matchId:
          row.seedCursorMatchId === ""
            ? null
            : RiotMatchIdSchema.parse(row.seedCursorMatchId),
      };
    },

    async observationsAfter(cursor, since, limit) {
      const rows = await prisma.matchObservation.findMany({
        where: {
          processingPolicy: "FULL",
          matchObjectKey: { not: null },
          gameCreatedAt: { gte: since },
          OR: [
            { observedAt: { gt: cursor.observedAt } },
            // The cursor's match id is empty until the first observation is read.
            ...(cursor.matchId === null
              ? []
              : [
                  {
                    observedAt: cursor.observedAt,
                    riotMatchId: {
                      gt: cursor.matchId,
                    },
                  },
                ]),
          ],
        },
        orderBy: [{ observedAt: "asc" }, { riotMatchId: "asc" }],
        take: limit,
        select: { riotMatchId: true, matchObjectKey: true, observedAt: true },
      });
      return rows.flatMap((row) =>
        row.matchObjectKey === null
          ? []
          : [
              {
                riotMatchId: row.riotMatchId,
                matchObjectKey: row.matchObjectKey,
                observedAt: row.observedAt,
              },
            ],
      );
    },

    async advanceSeedCursor(cursor) {
      await prisma.crawlControl.update({
        where: { id: CONTROL_ID },
        data: {
          seedCursorObservedAt: cursor.observedAt,
          seedCursorMatchId: cursor.matchId ?? "",
        },
      });
    },

    admit: (players, now) => admitPlayers(prisma, players, now),

    async claimEligible(now, limit) {
      const rows = await prisma.crawlFrontier.findMany({
        where: { nextEligibleAt: { lte: now } },
        orderBy: [{ depth: "asc" }, { nextEligibleAt: "asc" }],
        take: limit * 3,
        select: { puuid: true, platformRoute: true, depth: true },
      });
      const erased = await erasedHashes(
        prisma,
        rows.map((row) => row.puuid),
      );
      return rows
        .filter((row) => !erased.has(puuidHash(row.puuid)))
        .slice(0, limit);
    },

    async erasedAmong(puuids) {
      const hashes = await erasedHashes(prisma, puuids);
      return new Set(puuids.filter((puuid) => hashes.has(puuidHash(puuid))));
    },

    async unknownMatchIds(matchIds) {
      if (matchIds.length === 0) return [];
      const known = await prisma.crawlMatch.findMany({
        where: { riotMatchId: { in: [...matchIds] } },
        select: { riotMatchId: true },
      });
      const knownIds = new Set(known.map((row) => row.riotMatchId));
      return matchIds.filter((id) => !knownIds.has(id));
    },

    async matchesCrawledSince(since) {
      return await prisma.crawlMatch.count({
        where: { crawledAt: { gte: since } },
      });
    },

    async commit(input: CommitInput) {
      await prisma.$transaction(async (tx) => {
        for (const { segment, matches } of input.segments) {
          await tx.crawlSegment.createMany({
            data: [
              {
                sha256: segment.sha256,
                objectKey: segment.objectKey,
                route: segment.route,
                dt: segment.dt,
                matchCount: segment.matchCount,
                bytes: segment.bytes.length,
              },
            ],
            skipDuplicates: true,
          });
          await tx.crawlMatch.createMany({
            data: matches.map((match) => ({
              ...match,
              segmentSha256: segment.sha256,
              crawledAt: input.now,
            })),
            skipDuplicates: true,
          });
        }
        for (const visit of input.visits) {
          await tx.crawlFrontier.update({
            where: { puuid: visit.puuid },
            data: {
              lastVisitedAt: input.now,
              nextEligibleAt: crawlCooldownEnd(input.now),
              visitCount: { increment: 1 },
              rankTier: visit.rank?.tier ?? null,
              rankDivision: visit.rank?.division ?? null,
              rankedAt: input.now,
            },
          });
        }
        await admitPlayers(tx, input.children, input.now);
      });
    },

    async frontierSizeByDepth() {
      const rows = await prisma.crawlFrontier.groupBy({
        by: ["depth"],
        _count: { _all: true },
      });
      return Object.fromEntries(
        rows.map((row) => [row.depth, row._count._all]),
      );
    },
  };
}
