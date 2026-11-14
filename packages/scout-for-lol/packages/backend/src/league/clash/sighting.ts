import { z } from "zod";
import {
  ClashCupQueueSchema,
  LeaguePuuidSchema,
  PlatformRouteSchema,
  isClashQueueType,
  resolveClashCupFromCalendar,
  resolveQueueTypeFromGame,
  type ClashCupQueue,
  type LeaguePuuid,
  type PlatformRoute,
  type QueueType,
  type RawCurrentGameInfo,
} from "@scout-for-lol/data";
import { prisma } from "#src/database/index.ts";
import {
  MatchDataSourceSchema,
  type MatchDataSource,
} from "@scout-for-lol/domain/match-processing/states.ts";
import {
  canonicalClashGameId,
  recordClashGameIdentity,
} from "#src/league/clash/identity.ts";

const ClashSightingSourceSchema = z.enum(["prematch", "match"]);
type ClashSightingSource = z.infer<typeof ClashSightingSourceSchema>;

export type ClashSightingWrite = {
  platform: PlatformRoute;
  gameId: string;
  puuid: LeaguePuuid;
  source: ClashSightingSource;
  resultSource?: MatchDataSource;
  queue: ClashCupQueue;
  championId: number;
  teamId: number;
  observedAt: Date;
  win: boolean | null;
};

export type ClashSightingLabels = {
  cupKey: string | null;
  cupDay: string | null;
  teamRiotId: string | null;
};

export function mergeClashSighting(input: {
  existing:
    | {
        source: string;
        win: boolean | null;
        cupKey: string | null;
        cupDay: string | null;
        teamRiotId: string | null;
      }
    | undefined;
  incoming: ClashSightingWrite;
  labels: ClashSightingLabels;
}): {
  source: ClashSightingSource;
  win: boolean | null;
  cupKey: string | null;
  cupDay: string | null;
  teamRiotId: string | null;
} {
  const existing = input.existing;
  if (existing === undefined) {
    return {
      source: input.incoming.source,
      win: input.incoming.win,
      cupKey: input.labels.cupKey,
      cupDay: input.labels.cupDay,
      teamRiotId: input.labels.teamRiotId,
    };
  }
  const keepMatch =
    existing.source === "match" && input.incoming.source === "prematch";
  return {
    source: keepMatch ? "match" : input.incoming.source,
    win: keepMatch ? existing.win : input.incoming.win,
    cupKey: input.labels.cupKey ?? existing.cupKey,
    cupDay: input.labels.cupDay ?? existing.cupDay,
    teamRiotId: input.labels.teamRiotId ?? existing.teamRiotId,
  };
}

export async function resolveClashSightingLabels(input: {
  puuid: LeaguePuuid;
  platform: PlatformRoute;
  queue: QueueType;
  observedAt: Date;
}): Promise<ClashSightingLabels> {
  const membership = await prisma.clashMembershipHistory.findFirst({
    where: {
      puuid: input.puuid,
      platform: input.platform,
      windowStartAt: { lte: input.observedAt },
      windowEndAt: { gte: input.observedAt },
    },
    orderBy: { lastSeenAt: "desc" },
  });
  if (membership !== null) {
    return {
      cupKey: membership.nameKey,
      cupDay: membership.nameKeySecondary,
      teamRiotId: membership.teamRiotId,
    };
  }
  const cup = resolveClashCupFromCalendar({
    queue: input.queue,
    at: input.observedAt,
    platform: input.platform,
  });
  return cup === undefined
    ? { cupKey: null, cupDay: null, teamRiotId: null }
    : { cupKey: cup.nameKey, cupDay: cup.cupDay, teamRiotId: null };
}

/**
 * Riot's published id of a Clash game resolves to the live game it aliases,
 * so a prematch lobby, a client result and Riot's result share one row.
 */
export async function upsertClashGameSighting(
  write: ClashSightingWrite,
): Promise<void> {
  const incoming = {
    ...write,
    gameId: await canonicalClashGameId(write),
  };
  const labels = await resolveClashSightingLabels({
    puuid: incoming.puuid,
    platform: incoming.platform,
    queue: incoming.queue,
    observedAt: incoming.observedAt,
  });
  // Precedence is decided in the same statement as the write, including
  // concurrent Riot and desktop uploads.
  await prisma.$executeRaw`
    INSERT INTO "ClashGameSighting"
      ("platform", "gameId", "puuid", "source", "resultSource", "queue",
       "championId", "teamId", "observedAt", "win", "teamRiotId", "cupKey", "cupDay", "updatedAt")
    VALUES
      (${incoming.platform}, ${incoming.gameId}, ${incoming.puuid}, ${incoming.source},
       ${incoming.resultSource ?? "RIOT"}, ${incoming.queue}, ${incoming.championId},
       ${incoming.teamId}, ${incoming.observedAt}, ${incoming.win},
       ${labels.teamRiotId}, ${labels.cupKey}, ${labels.cupDay}, NOW())
    ON CONFLICT ("platform", "gameId", "puuid") DO UPDATE SET
      "updatedAt" = NOW(),
      "source" = EXCLUDED."source",
      "resultSource" = EXCLUDED."resultSource",
      "queue" = EXCLUDED."queue",
      "championId" = EXCLUDED."championId",
      "teamId" = EXCLUDED."teamId",
      "observedAt" = EXCLUDED."observedAt",
      "resultConflict" = EXCLUDED."resultSource" = 'SCOUT_CLIENT' AND
        ("ClashGameSighting"."resultConflict" OR
          ("ClashGameSighting"."source" = 'match' AND
            ("ClashGameSighting"."win" IS DISTINCT FROM EXCLUDED."win"
              OR "ClashGameSighting"."teamId" <> EXCLUDED."teamId"
              OR "ClashGameSighting"."championId" <> EXCLUDED."championId"
              OR "ClashGameSighting"."queue" <> EXCLUDED."queue"))),
      "win" = CASE WHEN EXCLUDED."resultSource" = 'SCOUT_CLIENT' AND
        ("ClashGameSighting"."resultConflict" OR
          ("ClashGameSighting"."source" = 'match' AND
            ("ClashGameSighting"."win" IS DISTINCT FROM EXCLUDED."win"
              OR "ClashGameSighting"."teamId" <> EXCLUDED."teamId"
              OR "ClashGameSighting"."championId" <> EXCLUDED."championId"
              OR "ClashGameSighting"."queue" <> EXCLUDED."queue")))
        THEN NULL ELSE EXCLUDED."win" END,
      "teamRiotId" = COALESCE(EXCLUDED."teamRiotId", "ClashGameSighting"."teamRiotId"),
      "cupKey" = COALESCE(EXCLUDED."cupKey", "ClashGameSighting"."cupKey"),
      "cupDay" = COALESCE(EXCLUDED."cupDay", "ClashGameSighting"."cupDay")
    WHERE NOT (
      "ClashGameSighting"."source" = 'match'
      AND (EXCLUDED."source" = 'prematch'
        OR ("ClashGameSighting"."resultSource" = 'RIOT'
          AND EXCLUDED."resultSource" = 'SCOUT_CLIENT'))
    )
  `;
}

export async function recordClashPrematchSightings(
  gameInfo: RawCurrentGameInfo,
  trackedPuuids: ReadonlySet<string>,
): Promise<void> {
  const queue = resolveQueueTypeFromGame(
    gameInfo.gameQueueConfigId,
    gameInfo.gameMode,
    gameInfo.gameType,
  );
  if (queue === undefined || !isClashQueueType(queue)) {
    return;
  }
  const clashQueue = ClashCupQueueSchema.parse(queue);
  const platform = PlatformRouteSchema.parse(gameInfo.platformId);
  const observedAt = new Date(
    gameInfo.gameStartTime > 0 ? gameInfo.gameStartTime : Date.now(),
  );
  const gameId = gameInfo.gameId.toString();
  await recordClashGameIdentity({
    platform,
    gameId,
    queueId: gameInfo.gameQueueConfigId,
    participants: gameInfo.participants,
    startAt: observedAt,
  });
  for (const participant of gameInfo.participants) {
    if (participant.puuid === null || !trackedPuuids.has(participant.puuid)) {
      continue;
    }
    await upsertClashGameSighting({
      platform,
      gameId,
      puuid: LeaguePuuidSchema.parse(participant.puuid),
      source: "prematch",
      queue: clashQueue,
      championId: participant.championId,
      teamId: participant.teamId,
      observedAt,
      win: null,
    });
  }
}

/**
 * Fold sightings written under a Riot alias into the live game's row, then
 * drop the alias row. Each row re-enters through `upsertClashGameSighting`,
 * so Riot-over-client and match-over-prematch precedence still holds, and a
 * rerun after a crash between the two writes repeats an idempotent upsert.
 * Returns the number of alias rows merged.
 */
export async function mergeClashAliasSightings(
  riotMatchId: string | null = null,
): Promise<number> {
  const rows = await prisma.$queryRaw<{ id: number }[]>`
    SELECT s."id" FROM "ClashGameSighting" s
    JOIN "ClashGameIdentity" i ON i."riotMatchId" = s."platform" || '_' || s."gameId"
    WHERE ${riotMatchId}::text IS NULL OR i."riotMatchId" = ${riotMatchId}::text
    ORDER BY s."id"`;
  for (const { id } of rows) {
    const row = await prisma.clashGameSighting.findUnique({ where: { id } });
    if (row === null) continue;
    await upsertClashGameSighting({
      platform: PlatformRouteSchema.parse(row.platform),
      gameId: row.gameId,
      puuid: LeaguePuuidSchema.parse(row.puuid),
      source: ClashSightingSourceSchema.parse(row.source),
      resultSource: MatchDataSourceSchema.parse(row.resultSource),
      queue: ClashCupQueueSchema.parse(row.queue),
      championId: row.championId,
      teamId: row.teamId,
      observedAt: row.observedAt,
      win: row.win,
    });
    await prisma.clashGameSighting.delete({ where: { id } });
  }
  return rows.length;
}
