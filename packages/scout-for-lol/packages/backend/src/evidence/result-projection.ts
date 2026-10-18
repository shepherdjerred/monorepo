import {
  GameResultSchema,
  gameResultTimestamp,
  type GameResult,
} from "@scout-for-lol/domain/artifacts/game-result.ts";
import { LeaguePuuidSchema } from "@scout-for-lol/domain/identity/league-account.ts";
import {
  ClashCupQueueSchema,
  PlatformRouteSchema,
  resolveQueueTypeFromGame,
} from "@scout-for-lol/data";
import { prisma } from "#src/database/index.ts";
import { upsertClashGameSighting } from "#src/league/clash/sighting.ts";
import { registeredResultPuuids } from "./result-accounts.ts";

/** Independent result projection; no source selection, dispatch or game effects. */
export async function projectResultEvidence(
  input: GameResult,
  capturedAt: Date,
): Promise<void> {
  const result = GameResultSchema.parse(input);
  await prisma.matchResultEvidence.upsert({
    where: {
      source_sourceId: { source: result.source, sourceId: result.sourceId },
    },
    create: {
      source: result.source,
      sourceId: result.sourceId,
      riotMatchId: result.matchId,
      result,
      capturedAt,
      ...(result.source === "RIOT"
        ? { riotCaptureId: result.sourceId }
        : { clientObservationId: result.sourceId }),
    },
    update: { result },
  });
  const queue = ClashCupQueueSchema.safeParse(
    resolveQueueTypeFromGame(result.queueId, result.gameMode, result.gameType),
  );
  if (!queue.success) return;
  const tracked = new Set<string>(await registeredResultPuuids(result));
  const [platform, gameId] = result.matchId.split("_");
  if (gameId === undefined)
    throw new Error("Validated match has no game identity");
  for (const player of result.participants) {
    if (player.identity.kind !== "riot" || !tracked.has(player.identity.puuid))
      continue;
    await upsertClashGameSighting({
      platform: PlatformRouteSchema.parse(platform),
      gameId,
      puuid: LeaguePuuidSchema.parse(player.identity.puuid),
      source: "match",
      resultSource: result.source,
      queue: queue.data,
      championId: player.championId,
      teamId: player.teamId,
      observedAt: new Date(gameResultTimestamp(result)),
      win: player.win,
    });
  }
}
