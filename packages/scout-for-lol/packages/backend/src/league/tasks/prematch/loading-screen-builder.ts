import type {
  RawCurrentGameInfo,
  RawCurrentGameParticipant,
  LoadingScreenData,
  LoadingScreenParticipant,
  LoadingScreenBan,
  LoadingScreenLayout,
  LoadingScreenTeam,
  Region,
  Ranks,
} from "@scout-for-lol/data/index.ts";
import {
  parseQueueType,
  parseTeam,
  mapIdToName,
  makeQueueDisplayName,
  LeaguePuuidSchema,
  LoadingScreenDataSchema,
  SummonerSpellIdSchema,
  RuneIdSchema,
  LoadingScreenChampionIdSchema,
  ArenaTeamIdSchema,
  GameIdSchema,
} from "@scout-for-lol/data/index.ts";
import {
  getChampionDisplayName,
  resolveChampionKey,
} from "#src/utils/champion.ts";
import { getRankByPuuid } from "#src/league/model/rank.ts";
import { resolveSkinNum } from "#src/league/tasks/prematch/skin-resolver.ts";
import { createLogger } from "#src/logger.ts";
import { match } from "ts-pattern";

const logger = createLogger("prematch-loading-screen-builder");

const RANKED_SOLO_QUEUE_ID = 420;
const RANKED_FLEX_QUEUE_ID = 440;
const ARENA_QUEUE_ID = 1700;

/**
 * Determine the layout mode based on queue config ID.
 * Throws on unknown queue IDs — caller is responsible for ensuring
 * we only attempt to render known queue types.
 */
function determineLayout(gameQueueConfigId: number): LoadingScreenLayout {
  return match(gameQueueConfigId)
    .with(450, () => "aram" as const) // ARAM
    .with(720, () => "aram" as const) // ARAM Clash
    .with(ARENA_QUEUE_ID, () => "arena" as const) // Arena
    .with(0, () => "standard" as const) // Custom
    .with(400, () => "standard" as const) // Draft Pick
    .with(RANKED_SOLO_QUEUE_ID, () => "standard" as const) // Ranked Solo
    .with(RANKED_FLEX_QUEUE_ID, () => "standard" as const) // Ranked Flex
    .with(480, () => "standard" as const) // Swiftplay
    .with(490, () => "standard" as const) // Quickplay
    .with(700, () => "standard" as const) // Clash
    .with(900, () => "standard" as const) // ARURF
    .with(1900, () => "standard" as const) // URF
    .with(2300, () => "standard" as const) // Brawl
    .with(3130, () => "standard" as const) // Easy Doom Bots
    .with(4220, () => "standard" as const) // Normal Doom Bots
    .with(4250, () => "standard" as const) // Hard Doom Bots
    .otherwise((id) => {
      throw new Error(
        `Unknown queue config ID ${id.toString()} — cannot determine loading screen layout`,
      );
    });
}

/**
 * Resolve team assignment for a participant.
 * Standard/ARAM: returns "blue" | "red" via parseTeam.
 * Arena: returns { arenaTeam: 1..8 }.
 * Throws on invalid team IDs.
 */
function resolveTeam(
  teamId: number,
  layout: LoadingScreenLayout,
): LoadingScreenTeam {
  if (layout === "arena") {
    return { arenaTeam: ArenaTeamIdSchema.parse(teamId) };
  }
  const team = parseTeam(teamId);
  if (team === undefined) {
    throw new Error(
      `Unknown team ID ${teamId.toString()} for ${layout} layout — expected 100 (blue) or 200 (red)`,
    );
  }
  return team;
}

/**
 * Convert a spectator API participant to a loading screen participant.
 * Ranks are fetched separately and injected afterward.
 */
async function buildParticipant(
  participant: RawCurrentGameParticipant,
  trackedPuuids: ReadonlySet<string>,
  layout: LoadingScreenLayout,
): Promise<Omit<LoadingScreenParticipant, "ranks">> {
  const championName = resolveChampionKey(participant.championId);
  const championDisplayName = getChampionDisplayName(participant.championId);
  const skinNum = await resolveSkinNum(participant, championName);

  const puuid =
    participant.puuid === null
      ? null
      : LeaguePuuidSchema.parse(participant.puuid);

  return {
    puuid,
    summonerName: participant.riotId,
    championName,
    championDisplayName,
    skinNum,
    team: resolveTeam(participant.teamId, layout),
    spell1Id: SummonerSpellIdSchema.parse(participant.spell1Id),
    spell2Id: SummonerSpellIdSchema.parse(participant.spell2Id),
    keystoneRuneId:
      participant.perks?.perkIds?.[0] === undefined
        ? undefined
        : RuneIdSchema.parse(participant.perks.perkIds[0]),
    secondaryTreeId:
      participant.perks?.perkSubStyle === undefined
        ? undefined
        : RuneIdSchema.parse(participant.perks.perkSubStyle),
    isTrackedPlayer: puuid !== null && trackedPuuids.has(puuid),
  };
}

/**
 * Resolve banned champions to loading screen ban objects.
 */
function buildBans(gameInfo: RawCurrentGameInfo): LoadingScreenBan[] {
  const bans: LoadingScreenBan[] = [];
  for (const ban of gameInfo.bannedChampions) {
    if (ban.championId <= 0) {
      continue; // -1 means no ban in that slot
    }
    const team = parseTeam(ban.teamId);
    if (team === undefined) {
      throw new Error(
        `Unknown ban team ID ${ban.teamId.toString()} — expected 100 (blue) or 200 (red)`,
      );
    }
    bans.push({
      championId: LoadingScreenChampionIdSchema.parse(ban.championId),
      championName: resolveChampionKey(ban.championId),
      team,
    });
  }
  return bans;
}

/**
 * Build complete LoadingScreenData from spectator API response.
 * Fetches ranks for all participants in parallel.
 *
 * @param gameInfo - Raw spectator API response
 * @param trackedPuuids - Set of PUUIDs that are tracked by the bot
 * @param region - Region for rank API calls
 */
export async function buildLoadingScreenData(
  gameInfo: RawCurrentGameInfo,
  trackedPuuids: ReadonlySet<string>,
  region: Region,
): Promise<LoadingScreenData> {
  const queueType = parseQueueType(gameInfo.gameQueueConfigId);
  if (queueType === undefined) {
    throw new Error(
      `Unknown queue type for queue config ID ${gameInfo.gameQueueConfigId.toString()}`,
    );
  }

  const queueDisplayName = makeQueueDisplayName(queueType);
  const isRanked =
    gameInfo.gameQueueConfigId === RANKED_SOLO_QUEUE_ID ||
    gameInfo.gameQueueConfigId === RANKED_FLEX_QUEUE_ID;
  const layout = determineLayout(gameInfo.gameQueueConfigId);
  const mapName = mapIdToName(gameInfo.mapId);

  // Build base participant data (without ranks)
  const baseParticipants = await Promise.all(
    gameInfo.participants.map((p) =>
      buildParticipant(p, trackedPuuids, layout),
    ),
  );

  // Fetch ranks for all participants in parallel
  logger.info(
    `Fetching ranks for ${gameInfo.participants.length.toString()} participants`,
  );
  const rankResults = await Promise.allSettled(
    gameInfo.participants.map(async (p): Promise<Ranks | undefined> => {
      if (p.puuid === null) {
        return;
      }
      return getRankByPuuid(p.puuid, region);
    }),
  );

  // Combine base participants with rank results
  const participants: LoadingScreenParticipant[] = baseParticipants.map(
    (base, idx) => {
      const rankResult = rankResults[idx];
      const ranks: Ranks | undefined =
        rankResult?.status === "fulfilled" ? rankResult.value : undefined;
      return { ...base, ranks };
    },
  );

  // Build bans (skip for ARAM/Arena which don't have bans)
  const bans = layout === "standard" ? buildBans(gameInfo) : [];

  const data = {
    gameId: GameIdSchema.parse(gameInfo.gameId),
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
