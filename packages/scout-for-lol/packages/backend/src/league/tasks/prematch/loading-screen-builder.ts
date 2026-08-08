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
  getModernChampionIdForClassic,
  getModernSpellIdForClassic,
  loadingScreenLayoutForQueueType,
} from "@scout-for-lol/data/index.ts";
import {
  getChampionDisplayName,
  resolveChampionKey,
} from "#src/utils/champion.ts";
import { getRankByPuuid } from "#src/league/model/rank.ts";
import { createLogger } from "#src/logger.ts";

const logger = createLogger("prematch-loading-screen-builder");

const RANKED_SOLO_QUEUE_ID = 420;
const RANKED_FLEX_QUEUE_ID = 440;
const RANKED_5S_QUEUE_ID = 710;

export class RecoverableLoadingScreenDataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RecoverableLoadingScreenDataError";
  }
}

export class UnsupportedLoadingScreenQueueError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsupportedLoadingScreenQueueError";
  }
}

type BuildParticipantContext = {
  trackedPuuids: ReadonlySet<string>;
  layout: LoadingScreenLayout;
};

type BaseBuiltParticipant = Omit<NonStandardLoadingScreenParticipant, "ranks">;
type RankedBuiltParticipant = BaseBuiltParticipant & { ranks?: Ranks };

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
    // data loss — there is no usable identity to match on. See
    // packages/docs/decisions/2026-06-07_scout-arena-prematch-scrubbed-players.md
    isTrackedPlayer: puuid !== null && context.trackedPuuids.has(puuid),
  };
}

function buildClassicParticipant(
  participant: RawCurrentGameParticipant,
  trackedPuuids: ReadonlySet<string>,
): ClassicLoadingScreenParticipant {
  const championName = resolveClassicChampionKey(participant.championId);
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
    championId: LoadingScreenChampionIdSchema.parse(participant.championId),
    championName,
    championDisplayName: getChampionDisplayName(participant.championId),
    team,
    spell1Id: SummonerSpellIdSchema.parse(participant.spell1Id),
    spell2Id: SummonerSpellIdSchema.parse(participant.spell2Id),
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

function gameInfoContextSuffix(gameInfo: RawCurrentGameInfo): string {
  return (
    `gameId=${gameInfo.gameId.toString()}, ` +
    `queueConfigId=${gameInfo.gameQueueConfigId.toString()}, ` +
    `mapId=${gameInfo.mapId.toString()}, ` +
    `gameMode=${gameInfo.gameMode}, ` +
    `gameType=${gameInfo.gameType}, ` +
    `gameLength=${gameInfo.gameLength.toString()}`
  );
}

function buildIncompleteLobbyMessage(
  participants: readonly RankedBuiltParticipant[],
  gameInfo: RawCurrentGameInfo,
): string {
  const presentPuuids = gameInfo.participants
    .map((p) => p.puuid ?? "scrubbed")
    .join(",");
  return (
    `Standard loading screen requires exactly 10 participants; ` +
    `received ${participants.length.toString()} ` +
    `(${gameInfoContextSuffix(gameInfo)}, participants=[${presentPuuids}])`
  );
}

function buildLopsidedTeamMessage(
  team: string,
  received: number,
  gameInfo: RawCurrentGameInfo,
): string {
  return (
    `Standard loading screen requires exactly 5 ${team} participants; ` +
    `received ${received.toString()} ` +
    `(${gameInfoContextSuffix(gameInfo)})`
  );
}

function inferStandardParticipants(
  participants: readonly RankedBuiltParticipant[],
  gameInfo: RawCurrentGameInfo,
): StandardLoadingScreenParticipant[] {
  if (participants.length !== 10) {
    throw new RecoverableLoadingScreenDataError(
      buildIncompleteLobbyMessage(participants, gameInfo),
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

const CLASSIC_LANE_ORDER = [
  "top",
  "jungle",
  "middle",
  "adc",
  "support",
] as const;

function orderFullClassicTeam(
  participants: ClassicLoadingScreenParticipant[],
): ClassicLoadingScreenParticipant[] {
  const inference = inferStandardLanesWithCurrentPriors(
    participants.map((participant, index) => ({
      participantKey: laneInferenceKey(index),
      championId: LoadingScreenChampionIdSchema.parse(
        getModernChampionIdForClassic(participant.championId),
      ),
      spell1Id: SummonerSpellIdSchema.parse(
        getModernSpellIdForClassic(participant.spell1Id) ??
          participant.spell1Id,
      ),
      spell2Id: SummonerSpellIdSchema.parse(
        getModernSpellIdForClassic(participant.spell2Id) ??
          participant.spell2Id,
      ),
    })),
  );
  const laneByIndex = new Map(
    inference.assignments.map((assignment) => [
      Number(assignment.participantKey.replace("participant:", "")),
      assignment.lane,
    ]),
  );
  return participants
    .map((participant, index) => ({
      participant,
      lane: laneByIndex.get(index),
    }))
    .toSorted(
      (left, right) =>
        CLASSIC_LANE_ORDER.indexOf(left.lane ?? "support") -
        CLASSIC_LANE_ORDER.indexOf(right.lane ?? "support"),
    )
    .map((entry) => entry.participant);
}

function orderClassicParticipants(
  participants: ClassicLoadingScreenParticipant[],
): ClassicLoadingScreenParticipant[] {
  const blue = participants.filter(
    (participant) => participant.team === "blue",
  );
  const red = participants.filter((participant) => participant.team === "red");
  if (blue.length !== 5 || red.length !== 5) {
    return participants;
  }
  return [...orderFullClassicTeam(blue), ...orderFullClassicTeam(red)];
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
    throw new UnsupportedLoadingScreenQueueError(
      `Unknown queue type for queue config ID ${gameInfo.gameQueueConfigId.toString()} (gameId=${gameInfo.gameId.toString()}, mapId=${gameInfo.mapId.toString()}, gameMode=${gameInfo.gameMode}, gameType=${gameInfo.gameType})`,
    );
  }

  const queueDisplayName = makeQueueDisplayName(queueType);
  const isRanked =
    gameInfo.gameQueueConfigId === RANKED_SOLO_QUEUE_ID ||
    gameInfo.gameQueueConfigId === RANKED_FLEX_QUEUE_ID ||
    gameInfo.gameQueueConfigId === RANKED_5S_QUEUE_ID;
  const layout = loadingScreenLayoutForQueueType(queueType);
  let mapName: ReturnType<typeof mapIdToName>;
  try {
    mapName = mapIdToName(gameInfo.mapId);
  } catch (error) {
    throw new Error(
      `${error instanceof Error ? error.message : String(error)} (gameId=${gameInfo.gameId.toString()}, queueConfigId=${gameInfo.gameQueueConfigId.toString()}, gameMode=${gameInfo.gameMode})`,
      { cause: error },
    );
  }

  if (layout === "classic") {
    const participants = orderClassicParticipants(
      gameInfo.participants.map((participant) =>
        buildClassicParticipant(participant, trackedPuuids),
      ),
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
