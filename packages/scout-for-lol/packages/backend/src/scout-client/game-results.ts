import {
  GameResultSchema,
  type GameResult,
} from "@scout-for-lol/domain/artifacts/game-result.ts";
import { admitMatchEvidence } from "#src/evidence/admission.ts";
import {
  RiotMatchIdSchema,
  type RiotMatchId,
} from "@scout-for-lol/domain/identity/brands.ts";
import type { ScoutClientObservation } from "@scout-for-lol/data";
import type { DiscordAccountId } from "@scout-for-lol/domain/identity/discord.ts";
import { prisma } from "#src/database/index.ts";
import { isFeatureHardDisabled } from "#src/configuration/flags.ts";
import { projectResultEvidence } from "#src/evidence/result-projection.ts";
import {
  localResultCompletionTime,
  parseLocalGameResult,
} from "./canonical/local-result.ts";
import { postGameDeliveryMode } from "./dispatch-policy.ts";
import { resolveResultEvidence } from "#src/evidence/results.ts";

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
  const completedAt = localResultCompletionTime(observation.payload, result);
  if (completedAt === null) return;
  const discoveredAt = new Date();
  const deliveryMode = postGameDeliveryMode(
    observation,
    completedAt,
    discoveredAt,
  );
  if (deliveryMode === null) return;
  await admitMatchEvidence({
    matchId: matchId.data,
    completedAt,
    discoveredAt,
    historical: deliveryMode === "silent-backfill",
  });
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
  await projectResultEvidence(result, new Date(observation.capturedAt));
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
  const authorizedPuuids = new Set<string>(
    accounts.map((account) => account.puuid),
  );
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
      const resolved = await resolveResultEvidence(first.matchId, candidates);
      const result =
        resolved.kind === "available" &&
        resolved.value.participants.some(
          (player) =>
            player.identity.kind === "riot" &&
            authorizedPuuids.has(player.identity.puuid),
        )
          ? resolved.value
          : null;
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
