import type {
  RawCurrentGameInfo,
  RawCurrentGameParticipant,
  LoadingScreenData,
  LoadingScreenParticipant,
  NonStandardLoadingScreenParticipant,
  LoadingScreenBan,
  LoadingScreenLayout,
  LoadingScreenTeam,
  Region,
  Ranks,
  StandardLoadingScreenParticipant,
} from "@scout-for-lol/data/index.ts";
import {
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
  inferStandardLanesWithCurrentPriors,
  isArenaQueueOrMode,
  resolveQueueTypeFromGame,
} from "@scout-for-lol/data/index.ts";
import {
  getChampionDisplayName,
  resolveChampionKey,
} from "#src/utils/champion.ts";
import { getRankByPuuid } from "#src/league/model/rank.ts";
import { createLogger } from "#src/logger.ts";
import { match } from "ts-pattern";

const logger = createLogger("prematch-loading-screen-builder");

const RANKED_SOLO_QUEUE_ID = 420;
const RANKED_FLEX_QUEUE_ID = 440;
const DEFAULT_LOADING_SCREEN_SKIN_NUM = 0;

export class RecoverableLoadingScreenDataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RecoverableLoadingScreenDataError";
  }
}

type BuildParticipantContext = {
  trackedPuuids: ReadonlySet<string>;
  layout: LoadingScreenLayout;
};

type BaseBuiltParticipant = Omit<NonStandardLoadingScreenParticipant, "ranks">;
type RankedBuiltParticipant = BaseBuiltParticipant & { ranks?: Ranks };

/**
 * Determine the layout mode based on queue config ID.
 * Throws on unknown queue IDs — caller is responsible for ensuring
 * we only attempt to render known queue types.
 */
function determineLayout(gameInfo: RawCurrentGameInfo): LoadingScreenLayout {
  if (isArenaQueueOrMode(gameInfo.gameQueueConfigId, gameInfo.gameMode)) {
    return "arena";
  }

  return (
    match(gameInfo.gameQueueConfigId)
      .with(450, () => "aram" as const) // ARAM
      .with(720, () => "aram" as const) // ARAM Clash
      .with(2400, () => "aram" as const) // ARAM: Mayhem
      .with(3200, () => "aram" as const) // ARAM: Mayhem MMR variant
      .with(3270, () => "aram" as const) // ARAM: Mayhem
      .with(0, () => "standard" as const) // Custom
      .with(3100, () => "standard" as const) // Custom
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
      // Unknown queue ID (e.g. custom games, which carry ad-hoc queue IDs like
      // 3110 that are absent from queues.json): fall back to the game mode + map
      // to pick a layout, so custom games on standard maps still render.
      .otherwise(() => layoutFromModeAndMap(gameInfo))
  );
}

const ARAM_MAP_ID = 12;
const SUMMONERS_RIFT_MAP_ID = 11;

/**
 * Derive a layout from game mode and map for queue IDs that aren't enumerated
 * above. Custom games are structurally identical to their ranked/normal
 * counterparts (a custom Summoner's Rift draft is a 5v5; a custom ARAM is an
 * ARAM), so the mode/map is a reliable signal. Arena is already handled by the
 * `isArenaQueueOrMode` check at the top of `determineLayout`.
 */
function layoutFromModeAndMap(
  gameInfo: RawCurrentGameInfo,
): LoadingScreenLayout {
  if (gameInfo.gameMode === "ARAM" || gameInfo.mapId === ARAM_MAP_ID) {
    return "aram";
  }
  if (
    gameInfo.gameMode === "CLASSIC" ||
    gameInfo.mapId === SUMMONERS_RIFT_MAP_ID
  ) {
    return "standard";
  }
  throw new Error(
    `Unknown queue config ID ${gameInfo.gameQueueConfigId.toString()} — cannot determine loading screen layout (gameId=${gameInfo.gameId.toString()}, mapId=${gameInfo.mapId.toString()}, gameMode=${gameInfo.gameMode})`,
  );
}

/**
 * Resolve team assignment for a participant.
 * Standard/ARAM: returns "blue" | "red" via parseTeam (from teamId 100/200).
 * Arena: returns { arenaTeam: 1..8 | null } from playerSubteamId. Spectator
 * reports teamId as 100/200 or even all 100 for Arena games, so we do not
 * infer subteams when Riot omits the dedicated playerSubteamId field.
 */
function resolveTeam(
  participant: RawCurrentGameParticipant,
  layout: LoadingScreenLayout,
): LoadingScreenTeam {
  if (layout === "arena") {
    if (participant.playerSubteamId === undefined) {
      return { arenaTeam: null };
    }
    return { arenaTeam: ArenaTeamIdSchema.parse(participant.playerSubteamId) };
  }
  const team = parseTeam(participant.teamId);
  if (team === undefined) {
    throw new Error(
      `Unknown team ID ${participant.teamId.toString()} for ${layout} layout — expected 100 (blue) or 200 (red)`,
    );
  }
  return team;
}

/**
 * Convert a spectator API participant to a loading screen participant.
 * Ranks are fetched separately and injected afterward.
 */
function buildParticipant(
  participant: RawCurrentGameParticipant,
  context: BuildParticipantContext,
): BaseBuiltParticipant {
  const championName = resolveChampionKey(participant.championId);
  const championDisplayName = getChampionDisplayName(participant.championId);

  const puuid =
    participant.puuid === null
      ? null
      : LeaguePuuidSchema.parse(participant.puuid);

  return {
    puuid,
    summonerName: participant.riotId,
    championId: LoadingScreenChampionIdSchema.parse(participant.championId),
    championName,
    championDisplayName,
    skinNum: DEFAULT_LOADING_SCREEN_SKIN_NUM,
    team: resolveTeam(participant, context.layout),
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
    isTrackedPlayer: puuid !== null && context.trackedPuuids.has(puuid),
  };
}

function laneInferenceKey(index: number): string {
  return `participant:${index.toString()}`;
}

function buildStandardParticipant(
  participant: RankedBuiltParticipant,
  lane: StandardLoadingScreenParticipant["lane"],
): StandardLoadingScreenParticipant {
  if (participant.team !== "blue" && participant.team !== "red") {
    throw new Error(
      "Standard loading-screen participant has non-standard team",
    );
  }
  return {
    ...participant,
    team: participant.team,
    lane,
  };
}

function inferStandardParticipants(
  participants: readonly RankedBuiltParticipant[],
): StandardLoadingScreenParticipant[] {
  if (participants.length !== 10) {
    throw new Error(
      `Standard loading screen requires exactly 10 participants; received ${participants.length.toString()}`,
    );
  }

  const result = new Map<number, StandardLoadingScreenParticipant>();

  for (const team of ["blue", "red"]) {
    const indexedTeam = participants
      .map((participant, index) => ({ participant, index }))
      .filter((entry) => entry.participant.team === team);
    if (indexedTeam.length !== 5) {
      throw new Error(
        `Standard loading screen requires exactly 5 ${team} participants; received ${indexedTeam.length.toString()}`,
      );
    }

    const inference = inferStandardLanesWithCurrentPriors(
      indexedTeam.map((entry) => ({
        participantKey: laneInferenceKey(entry.index),
        championId: entry.participant.championId,
        spell1Id: entry.participant.spell1Id,
        spell2Id: entry.participant.spell2Id,
      })),
    );

    for (const assignment of inference.assignments) {
      const parsedIndex = Number(
        assignment.participantKey.replace("participant:", ""),
      );
      const participant = participants[parsedIndex];
      if (participant === undefined) {
        throw new Error(`Missing participant for ${assignment.participantKey}`);
      }
      result.set(
        parsedIndex,
        buildStandardParticipant(participant, assignment.lane),
      );
    }
  }

  const inferred = participants.map((_, index) => {
    const participant = result.get(index);
    if (participant === undefined) {
      throw new Error(
        `Lane inference did not produce participant at index ${index.toString()}`,
      );
    }
    return participant;
  });

  return inferred;
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
  const queueType = resolveQueueTypeFromGame(
    gameInfo.gameQueueConfigId,
    gameInfo.gameMode,
    gameInfo.gameType,
  );
  if (queueType === undefined) {
    throw new Error(
      `Unknown queue type for queue config ID ${gameInfo.gameQueueConfigId.toString()} (gameId=${gameInfo.gameId.toString()}, mapId=${gameInfo.mapId.toString()}, gameMode=${gameInfo.gameMode}, gameType=${gameInfo.gameType})`,
    );
  }

  const queueDisplayName = makeQueueDisplayName(queueType);
  const isRanked =
    gameInfo.gameQueueConfigId === RANKED_SOLO_QUEUE_ID ||
    gameInfo.gameQueueConfigId === RANKED_FLEX_QUEUE_ID;
  const layout = determineLayout(gameInfo);
  let mapName: ReturnType<typeof mapIdToName>;
  try {
    mapName = mapIdToName(gameInfo.mapId);
  } catch (error) {
    throw new Error(
      `${error instanceof Error ? error.message : String(error)} (gameId=${gameInfo.gameId.toString()}, queueConfigId=${gameInfo.gameQueueConfigId.toString()}, gameMode=${gameInfo.gameMode})`,
      { cause: error },
    );
  }

  // Build base participant data (without ranks)
  const baseParticipants = gameInfo.participants.map((p) =>
    buildParticipant(p, {
      trackedPuuids,
      layout,
    }),
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
  const rankedParticipants: RankedBuiltParticipant[] = baseParticipants.map(
    (base, idx) => {
      const rankResult = rankResults[idx];
      const ranks: Ranks | undefined =
        rankResult?.status === "fulfilled" ? rankResult.value : undefined;
      return ranks === undefined ? base : { ...base, ranks };
    },
  );
  const participants: LoadingScreenParticipant[] =
    layout === "standard"
      ? inferStandardParticipants(rankedParticipants)
      : rankedParticipants;

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
