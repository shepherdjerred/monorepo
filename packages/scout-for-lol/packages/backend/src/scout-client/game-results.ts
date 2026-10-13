import {
  GameResultSchema,
  resolveGameResult,
  type GameResult,
} from "@scout-for-lol/domain/artifacts/game-result.ts";
import {
  RiotMatchIdSchema,
  type RiotMatchId,
} from "@scout-for-lol/domain/identity/brands.ts";
import { LeaguePuuidSchema } from "@scout-for-lol/domain/identity/league-account.ts";
import {
  ClashCupQueueSchema,
  PlatformRouteSchema,
  resolveQueueTypeFromGame,
  type ScoutClientObservation,
} from "@scout-for-lol/data";
import type { DiscordAccountId } from "@scout-for-lol/domain/identity/discord.ts";
import { prisma } from "#src/database/index.ts";
import { isFeatureHardDisabled } from "#src/configuration/flags.ts";
import { upsertClashGameSighting } from "#src/league/clash/sighting.ts";
import { parseLocalGameResult } from "./canonical/local-result.ts";
import { gameResultFromMatch } from "./canonical/riot-result.ts";
import { storedRawArchiveDescriptor } from "#src/report-lake/durable-receipts.ts";
import { readArchivedMatchPayload } from "#src/report-lake/receipted-archive.ts";

const NORMALIZER_VERSION = 1;

/** Projection only: never dispatch settlement, progression or notifications here. */
export async function projectClientGameResult(
  observation: ScoutClientObservation,
): Promise<void> {
  if (isFeatureHardDisabled("scout_client_ingestion")) return;
  if (
    observation.kind !== "post_game" ||
    observation.localPuuid === undefined ||
    observation.platformId === undefined ||
    observation.gameId === undefined
  )
    return;
  const matchId = RiotMatchIdSchema.safeParse(
    `${observation.platformId.toUpperCase()}_${observation.gameId}`,
  );
  if (!matchId.success) return;
  const result = parseLocalGameResult(
    matchId.data,
    observation.payload,
    observation.localPuuid,
    observation.observationId,
  );
  if (result === null) return;
  await prisma.scoutClientGameResult.upsert({
    where: { observationId: observation.observationId },
    create: {
      observationId: observation.observationId,
      riotMatchId: result.matchId,
      observerPuuid: observation.localPuuid,
      result,
      normalizerVersion: NORMALIZER_VERSION,
      capturedAt: new Date(observation.capturedAt),
    },
    update: { result, normalizerVersion: NORMALIZER_VERSION },
  });
  const queue = ClashCupQueueSchema.safeParse(
    resolveQueueTypeFromGame(result.queueId, result.gameMode, result.gameType),
  );
  if (!queue.success) return;
  // Guild visibility is still the intersection with that guild's tracked accounts.
  const puuids = result.participants.flatMap((player) =>
    player.identity.kind === "riot" ? [player.identity.puuid] : [],
  );
  const accounts = await prisma.account.findMany({
    where: { puuid: { in: puuids } },
    distinct: ["puuid"],
    select: { puuid: true },
  });
  const tracked = new Set(accounts.map((account) => account.puuid));
  for (const player of result.participants) {
    if (
      player.identity.kind !== "riot" ||
      !tracked.has(LeaguePuuidSchema.parse(player.identity.puuid))
    )
      continue;
    await upsertClashGameSighting({
      platform: PlatformRouteSchema.parse(observation.platformId),
      gameId: observation.gameId,
      puuid: LeaguePuuidSchema.parse(player.identity.puuid),
      source: "match",
      resultSource: "SCOUT_CLIENT",
      queue: queue.data,
      championId: player.championId,
      teamId: player.teamId,
      observedAt: new Date(result.gameCreation),
      win: player.win,
    });
  }
}

/** Only the caller's registered accounts can reveal their recovered results. */
export async function readClientGameResults(
  ownerId: DiscordAccountId,
  limit: number,
): Promise<{
  results: GameResult[];
  conflicts: { matchId: RiotMatchId; sourceIds: string[] }[];
}> {
  if (isFeatureHardDisabled("scout_client_ingestion"))
    return { results: [], conflicts: [] };
  const accounts = await prisma.account.findMany({
    where: { player: { discordId: ownerId } },
    distinct: ["puuid"],
    select: { puuid: true },
  });
  const where = {
    observerPuuid: { in: accounts.map((account) => account.puuid) },
    observation: { device: { ownerId }, disposition: "ACCEPTED" as const },
  };
  const selected = await prisma.scoutClientGameResult.groupBy({
    by: ["riotMatchId"],
    where,
    _max: { capturedAt: true },
    orderBy: [{ _max: { capturedAt: "desc" } }, { riotMatchId: "asc" }],
    take: limit,
  });
  // Page games, then load all their evidence. A row limit can hide a conflict.
  const rows = await prisma.scoutClientGameResult.findMany({
    where: {
      ...where,
      riotMatchId: { in: selected.map((game) => game.riotMatchId) },
    },
    orderBy: [{ capturedAt: "desc" }, { observationId: "asc" }],
  });
  const games = new Map<string, GameResult[]>();
  for (const row of rows) {
    const result = GameResultSchema.parse(row.result);
    const candidates = games.get(result.matchId) ?? [];
    candidates.push(result);
    games.set(result.matchId, candidates);
  }
  const resolutions = await Promise.all(
    [...games.values()].map(async (candidates) => {
      const first = candidates[0];
      if (first === undefined) throw new Error("Result group has no evidence");
      const archive = await storedRawArchiveDescriptor(
        prisma,
        first.matchId,
        "match",
      );
      // Completed processing pinned these bytes. Late client facts remain evidence,
      // while the already-published scoreboard remains exactly the same.
      const result =
        archive === null
          ? resolveGameResult(candidates)
          : gameResultFromMatch(
              await readArchivedMatchPayload(archive, first.matchId),
            );
      return {
        result,
        matchId: first.matchId,
        sourceIds: candidates.map((candidate) => candidate.sourceId),
      };
    }),
  );
  return {
    results: resolutions.flatMap((resolution) =>
      resolution.result === null ? [] : [resolution.result],
    ),
    conflicts: resolutions.flatMap((resolution) =>
      resolution.result === null
        ? [{ matchId: resolution.matchId, sourceIds: resolution.sourceIds }]
        : [],
    ),
  };
}
