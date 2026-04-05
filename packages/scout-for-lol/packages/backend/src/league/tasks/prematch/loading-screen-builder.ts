import type {
  RawCurrentGameInfo,
  RawCurrentGameParticipant,
  LoadingScreenData,
  LoadingScreenParticipant,
  LoadingScreenBan,
  LoadingScreenLayout,
  Region,
} from "@scout-for-lol/data/index.ts";
import {
  parseQueueType,
  queueTypeToDisplayString,
  LoadingScreenDataSchema,
} from "@scout-for-lol/data/index.ts";
import { getChampionDisplayName } from "#src/utils/champion.ts";
import { getRankByPuuid } from "#src/league/model/rank.ts";
import { resolveSkinNum } from "#src/league/tasks/prematch/skin-resolver.ts";
import { resolveChampionKey } from "#src/league/tasks/prematch/champion-resolver.ts";
import { createLogger } from "#src/logger.ts";
import { match } from "ts-pattern";

const logger = createLogger("prematch-loading-screen-builder");

/**
 * Determine the layout mode based on queue config ID.
 */
function determineLayout(gameQueueConfigId: number): LoadingScreenLayout {
  return match(gameQueueConfigId)
    .with(450, () => "aram" as const) // ARAM
    .with(720, () => "aram" as const) // ARAM Clash
    .with(1700, () => "arena" as const) // Arena
    .otherwise(() => "standard" as const);
}

/**
 * Map ID to human-readable name.
 */
function mapIdToName(mapId: number): string {
  return match(mapId)
    .with(11, () => "Summoner's Rift")
    .with(12, () => "Howling Abyss")
    .with(30, () => "Rings of Wrath")
    .otherwise(() => `Map ${mapId.toString()}`);
}

/**
 * Convert a spectator API participant to a loading screen participant.
 * Rank is fetched separately and injected afterward.
 */
function buildParticipant(
  participant: RawCurrentGameParticipant,
  trackedPuuids: Set<string>,
): Omit<LoadingScreenParticipant, "rank"> {
  const championName = resolveChampionKey(participant.championId);
  const championDisplayName = getChampionDisplayName(participant.championId);
  const skinNum = resolveSkinNum(participant, championName);

  return {
    puuid: participant.puuid,
    summonerName: participant.summonerName,
    championName,
    championDisplayName,
    skinNum,
    teamId: participant.teamId,
    spell1Id: participant.spell1Id,
    spell2Id: participant.spell2Id,
    keystoneRuneId: participant.perks?.perkIds?.[0],
    secondaryTreeId: participant.perks?.perkSubStyle,
    isTrackedPlayer: trackedPuuids.has(participant.puuid),
  };
}

/**
 * Resolve banned champions to loading screen ban objects.
 */
function buildBans(
  gameInfo: RawCurrentGameInfo,
): LoadingScreenBan[] {
  return gameInfo.bannedChampions
    .filter((ban) => ban.championId > 0) // -1 means no ban in that slot
    .map((ban) => ({
      championId: ban.championId,
      championName: resolveChampionKey(ban.championId),
      teamId: ban.teamId,
    }));
}

/**
 * Build complete LoadingScreenData from spectator API response.
 * Fetches ranks for all participants in parallel.
 *
 * @param gameInfo - Raw spectator API response
 * @param trackedPuuids - Set of PUUIDs that are tracked by the bot
 * @param region - Region for rank API calls (e.g., "na1")
 */
export async function buildLoadingScreenData(
  gameInfo: RawCurrentGameInfo,
  trackedPuuids: Set<string>,
  region: Region,
): Promise<LoadingScreenData> {
  const queueType = parseQueueType(gameInfo.gameQueueConfigId);
  const queueDisplayName = queueType
    ? queueTypeToDisplayString(queueType)
    : gameInfo.gameMode;
  const isRanked =
    gameInfo.gameQueueConfigId === 420 ||
    gameInfo.gameQueueConfigId === 440;
  const layout = determineLayout(gameInfo.gameQueueConfigId);
  const mapName = mapIdToName(gameInfo.mapId);

  // Build base participant data (without ranks)
  const baseParticipants = gameInfo.participants.map((p) =>
    buildParticipant(p, trackedPuuids),
  );

  // Fetch ranks for all participants in parallel
  logger.info(
    `Fetching ranks for ${gameInfo.participants.length.toString()} participants`,
  );
  const rankResults = await Promise.allSettled(
    gameInfo.participants.map((p) => getRankByPuuid(p.puuid, region)),
  );

  // Combine base participants with rank results
  const participants: LoadingScreenParticipant[] = baseParticipants.map(
    (base, idx) => {
      const rankResult = rankResults[idx];
      const rank =
        rankResult?.status === "fulfilled" ? rankResult.value : undefined;
      return { ...base, rank };
    },
  );

  // Build bans (skip for ARAM/Arena which don't have bans)
  const bans = layout === "standard" ? buildBans(gameInfo) : [];

  const data = {
    gameId: gameInfo.gameId,
    queueType,
    queueDisplayName,
    isRanked,
    layout,
    mapName,
    participants,
    bans,
    gameStartTime: gameInfo.gameStartTime,
  };

  // Validate with Zod schema
  return LoadingScreenDataSchema.parse(data);
}
