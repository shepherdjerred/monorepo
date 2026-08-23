import type {
  RawCurrentGameInfo,
  RawCurrentGameParticipant,
  LoadingScreenData,
  LoadingScreenParticipant,
  ClassicLoadingScreenParticipant,
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
  QueueDisplayNameSchema,
  LeaguePuuidSchema,
  LoadingScreenDataSchema,
  SummonerSpellIdSchema,
  RuneIdSchema,
  LoadingScreenChampionIdSchema,
  ArenaTeamIdSchema,
  GameIdSchema,
  inferStandardLanesWithCurrentPriors,
  resolveQueueTypeFromGame,
  resolveClassicChampionKey,
  getClassicChampionId,
  getClassicSpellId,
  loadingScreenLayoutForQueueType,
  isClassicAssetMode,
} from "@scout-for-lol/data/index.ts";

import {
  getChampionDisplayName,
  resolveChampionKey,
} from "#src/utils/champion.ts";
import { getRankByPuuid } from "#src/league/model/rank.ts";
import { createLogger } from "#src/logger.ts";
import { classicAssetResolutionFailuresTotal } from "#src/metrics/index.ts";

const logger = createLogger("prematch-loading-screen-builder");

const RANKED_SOLO_QUEUE_ID = 420;
const RANKED_FLEX_QUEUE_ID = 440;
const RANKED_5S_QUEUE_ID = 710;

import {
  RecoverableLoadingScreenDataError,
  UnsupportedLoadingScreenQueueError,
  buildIncompleteLobbyMessage,
  buildLopsidedTeamMessage,
} from "./loading-screen-errors.ts";
import { orderClassicParticipants } from "./loading-screen-classic.ts";

type BuildParticipantContext = {
  trackedPuuids: ReadonlySet<string>;
  layout: LoadingScreenLayout;
};

type BaseBuiltParticipant = Omit<NonStandardLoadingScreenParticipant, "ranks">;
type RankedBuiltParticipant = BaseBuiltParticipant & { ranks?: Ranks };
export type ParticipantRanks = ReadonlyMap<string, Ranks>;

/** Fetch the lobby rank snapshot once so prediction and presentation share it. */
export async function fetchParticipantRanks(
  gameInfo: RawCurrentGameInfo,
  region: Region,
): Promise<ParticipantRanks> {
  // Classic assets do not display modern ranked data and prediction treats
  // rank/season as inapplicable there. Preserve the existing zero-request path.
  if (isClassicAssetMode(gameInfo.gameQueueConfigId, gameInfo.gameMode)) {
    return new Map();
  }
  logger.info(
    `Fetching ranks for ${gameInfo.participants.length.toString()} participants`,
  );
  const results = await Promise.allSettled(
    gameInfo.participants.map(async (participant) => {
      if (participant.puuid === null) {
        return;
      }
      const ranks = await getRankByPuuid(participant.puuid, region);
      return { puuid: participant.puuid, ranks };
    }),
  );
  const ranksByPuuid = new Map<string, Ranks>();
  for (const result of results) {
    if (result.status === "fulfilled" && result.value !== undefined) {
      ranksByPuuid.set(result.value.puuid, result.value.ranks);
    }
  }
  return ranksByPuuid;
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
    // Tracked players can only be matched by puuid. KNOWN LIMITATION: Riot's
    // Spectator-V5 returns `puuid: null` for privacy-scrubbed participants (and
    // their `riotId` is just the champion name, not a real Riot ID), so a
    // tracked player who has privacy enabled is unidentifiable here and is
    // intentionally absent from the pre-match image. They still appear
    // post-match because Match-V5 always returns full puuids. We accept this
    // data loss — there is no usable identity to match on.
    isTrackedPlayer: puuid !== null && context.trackedPuuids.has(puuid),
  };
}

function buildClassicParticipant(
  participant: RawCurrentGameParticipant,
  trackedPuuids: ReadonlySet<string>,
): ClassicLoadingScreenParticipant {
  const championId = getClassicChampionId(participant.championId);
  const championName = resolveClassicChampionKey(championId);
  const puuid =
    participant.puuid === null
      ? null
      : LeaguePuuidSchema.parse(participant.puuid);
  const team = resolveTeam(participant, "classic");
  if (team !== "blue" && team !== "red") {
    throw new Error("Classic participant has a non-standard team");
  }
  return {
    puuid,
    summonerName: participant.riotId,
    championId: LoadingScreenChampionIdSchema.parse(championId),
    championName,
    championDisplayName: getChampionDisplayName(participant.championId),
    team,
    spell1Id: SummonerSpellIdSchema.parse(
      getClassicSpellId(participant.spell1Id),
    ),
    spell2Id: SummonerSpellIdSchema.parse(
      getClassicSpellId(participant.spell2Id),
    ),
    isTrackedPlayer: puuid !== null && trackedPuuids.has(puuid),
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
  gameInfo: RawCurrentGameInfo,
): StandardLoadingScreenParticipant[] {
  if (participants.length !== 10) {
    throw new RecoverableLoadingScreenDataError(
      buildIncompleteLobbyMessage(participants.length, gameInfo),
    );
  }

  const result = new Map<number, StandardLoadingScreenParticipant>();

  for (const team of ["blue", "red"]) {
    const indexedTeam = participants
      .map((participant, index) => ({ participant, index }))
      .filter((entry) => entry.participant.team === team);
    if (indexedTeam.length !== 5) {
      throw new RecoverableLoadingScreenDataError(
        buildLopsidedTeamMessage(team, indexedTeam.length, gameInfo),
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
  prefetchedRanks?: ParticipantRanks,
): Promise<LoadingScreenData> {
  const queueType = resolveQueueTypeFromGame(
    gameInfo.gameQueueConfigId,
    gameInfo.gameMode,
    gameInfo.gameType,
  );
  if (queueType === undefined) {
    throw new UnsupportedLoadingScreenQueueError(
      `Unknown queue type for queue config ID ${gameInfo.gameQueueConfigId.toString()} (gameId=${gameInfo.gameId.toString()}, mapId=${gameInfo.mapId.toString()}, gameMode=${gameInfo.gameMode}, gameType=${gameInfo.gameType})`,
    );
  }

  const isClassicAsset = isClassicAssetMode(
    gameInfo.gameQueueConfigId,
    gameInfo.gameMode,
  );
  const isOrdinaryClassicQueue = queueType === "normal" && !isClassicAsset;
  const queueDisplayName = isOrdinaryClassicQueue
    ? QueueDisplayNameSchema.parse("Summoner's Rift")
    : makeQueueDisplayName(queueType);
  const isRanked =
    gameInfo.gameQueueConfigId === RANKED_SOLO_QUEUE_ID ||
    gameInfo.gameQueueConfigId === RANKED_FLEX_QUEUE_ID ||
    gameInfo.gameQueueConfigId === RANKED_5S_QUEUE_ID;
  const layout = isOrdinaryClassicQueue
    ? "standard"
    : loadingScreenLayoutForQueueType(queueType);
  let mapName: ReturnType<typeof mapIdToName>;
  try {
    mapName =
      queueType === "classic aram mayhem" &&
      (gameInfo.mapId === 12 || gameInfo.mapId === 35)
        ? "The Bandlewood"
        : mapIdToName(gameInfo.mapId);
  } catch (error) {
    throw new Error(
      `${error instanceof Error ? error.message : String(error)} (gameId=${gameInfo.gameId.toString()}, queueConfigId=${gameInfo.gameQueueConfigId.toString()}, gameMode=${gameInfo.gameMode})`,
      { cause: error },
    );
  }

  if (layout === "classic") {
    const participants = orderClassicParticipants(
      gameInfo.participants.map((participant) => {
        try {
          return buildClassicParticipant(participant, trackedPuuids);
        } catch (error) {
          const reason =
            error instanceof Error && error.message.includes("asset")
              ? "asset"
              : "mapping";
          classicAssetResolutionFailuresTotal.inc({
            phase: "prematch",
            reason,
          });
          logger.error(
            "Classic prematch champion asset resolution failed",
            error,
            { championId: participant.championId },
          );
          throw error;
        }
      }),
    );
    return LoadingScreenDataSchema.parse({
      gameId: GameIdSchema.parse(gameInfo.gameId),
      queueType,
      queueDisplayName,
      layout: "classic",
      mapName,
      participants,
      gameStartTime: gameInfo.gameStartTime,
    });
  }

  // Build base participant data (without ranks)
  const baseParticipants = gameInfo.participants.map((p) =>
    buildParticipant(p, {
      trackedPuuids,
      layout,
    }),
  );

  const ranksByPuuid =
    prefetchedRanks ?? (await fetchParticipantRanks(gameInfo, region));

  // Combine base participants with the shared rank snapshot.
  const rankedParticipants: RankedBuiltParticipant[] = baseParticipants.map(
    (base) => {
      if (base.puuid === null) {
        return {
          ...base,
          ranks: {
            solo: undefined,
            flex: undefined,
            soloStatus: "hidden",
            flexStatus: "hidden",
            hidden: true,
          },
        };
      }
      const ranks = ranksByPuuid.get(base.puuid);
      return ranks === undefined ? base : { ...base, ranks };
    },
  );

  const participants: LoadingScreenParticipant[] =
    layout === "standard"
      ? inferStandardParticipants(rankedParticipants, gameInfo)
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
