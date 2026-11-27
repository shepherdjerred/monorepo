import { Prisma } from "#generated/prisma/client/index.js";
import {
  LeaguePuuidSchema,
  RegionSchema,
  type LeaguePuuid,
  type Region,
} from "@scout-for-lol/data";
import { z } from "zod";
import type { ExtendedPrismaClient } from "#src/database/index.ts";

/** A tracked player with a rank recorded in this window is not refreshed. */
export const RANK_EVIDENCE_WINDOW_DAYS = 7;

/** Players one Activity batch refreshes at most. */
export const RANK_REFRESH_BATCH_SIZE = 50;

const DAY_MS = 86_400_000;

export type DueRankPlayer = {
  puuid: LeaguePuuid;
  region: Region;
};

const DueRowsSchema = z.array(
  z.object({ puuid: LeaguePuuidSchema, region: RegionSchema }),
);

/**
 * The tracked players whose rank Scout last learned more than
 * {@link RANK_EVIDENCE_WINDOW_DAYS} days ago, or never.
 *
 * A tracked player is an `Account` row; one PUUID tracked by several servers
 * is one player. Rank evidence is either a ranked game's `rankAfter` recorded
 * in the window (`MatchRankHistory.capturedAt`, the instant `latestRanksByPuuid`
 * compares) or a `CurrentRankSnapshot` fetched in the window. A snapshot of an
 * unranked player counts: it records that Riot was asked, so an unranked
 * player is asked once a window rather than once a day, and a player refreshed
 * today is not due again.
 *
 * Players never asked come first, then the longest-unrefreshed, with the PUUID
 * as the tie-break so a retried batch selects in the same order.
 */
export async function selectDueRankPlayers(
  prisma: ExtendedPrismaClient,
  input: { now: Date; limit: number },
): Promise<DueRankPlayer[]> {
  const cutoff = new Date(
    input.now.getTime() - RANK_EVIDENCE_WINDOW_DAYS * DAY_MS,
  );
  return DueRowsSchema.parse(
    await prisma.$queryRaw(
      Prisma.sql`
        SELECT a.puuid AS puuid, MIN(a.region) AS region
        FROM "Account" a
        LEFT JOIN "CurrentRankSnapshot" s ON s.puuid = a.puuid
        WHERE (s.puuid IS NULL OR s."fetchedAt" < ${cutoff})
          AND NOT EXISTS (
            SELECT 1
            FROM "MatchRankHistory" h
            WHERE h.puuid = a.puuid
              AND h."rankAfter" IS NOT NULL
              AND h."capturedAt" >= ${cutoff}
          )
        GROUP BY a.puuid, s."fetchedAt"
        ORDER BY s."fetchedAt" ASC NULLS FIRST, a.puuid ASC
        LIMIT ${input.limit}
      `,
    ),
  );
}
