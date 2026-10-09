import {
  type QueueType,
  type RawCurrentGameInfo,
  type RawCurrentGameParticipant,
  type LoadingScreenData,
  type LoadingScreenParticipant,
  type ClassicLoadingScreenParticipant,
  type NonStandardLoadingScreenParticipant,
  type LoadingScreenBan,
  type LoadingScreenLayout,
  type LoadingScreenTeam,
  type Region,
  type StandardLoadingScreenParticipant,
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
  getModernChampionIdForClassic,
  loadingScreenLayoutForQueueType,
  isClassicAssetMode,
} from "@scout-for-lol/data/index.ts";

import {
  getChampionDisplayName,
  resolveChampionKey,
} from "#src/utils/champion.ts";
import {
  getRankByPuuid,
  type RankLookupResult,
} from "#src/league/model/rank.ts";
import { createLogger } from "#src/logger.ts";
import { classicAssetResolutionFailuresTotal } from "#src/metrics/index.ts";
import {
  RecoverableLoadingScreenDataError,
  UnsupportedLoadingScreenQueueError,
  buildIncompleteLobbyMessage,
  buildLopsidedTeamMessage,
} from "./loading-screen-errors.ts";
import { orderClassicParticipants } from "./loading-screen-classic.ts";
import {
  fetchParticipantMasteries,
  withSelectedChampionMastery,
  type ParticipantMasteries,
} from "./loading-screen-mastery.ts";
import type { ObservedLobbyBot } from "#src/scout-client/lobby-payload.ts";
import {
  buildBotParticipant,
  buildStandardBotParticipant,
} from "./loading-screen-bots.ts";

const logger = createLogger("prematch-loading-screen-builder");

const RANKED_SOLO_QUEUE_ID = 420;
const RANKED_FLEX_QUEUE_ID = 440;
const RANKED_5S_QUEUE_ID = 710;

type BuildParticipantContext = {
  trackedPuuids: ReadonlySet<string>;
  layout: LoadingScreenLayout;
};

type BaseBuiltParticipant = Omit<
  NonStandardLoadingScreenParticipant,
  "rankState" | "mastery"
>;
type RankedBuiltParticipant = NonStandardLoadingScreenParticipant;
export type ParticipantRanks = ReadonlyMap<string, RankLookupResult>;

/** Inputs to {@link buildLoadingScreenData} that most callers do not have. */
export type BuildLoadingScreenOptions = {
  /** A rank snapshot already fetched for this roster, to avoid a second one. */
  readonly prefetchedRanks?: ParticipantRanks | undefined;
  /**
   * Bots the local client saw in this game's lobby, which Riot's Spectator
   * roster leaves out entirely. Empty for every matchmade game.
   */
  readonly observedBots?: readonly ObservedLobbyBot[] | undefined;
};

/** Fetch the lobby rank snapshot used by the loading-screen presentation. */
export async function fetchParticipantRanks(
  gameInfo: RawCurrentGameInfo,
  region: Region,
): Promise<ParticipantRanks> {
  // Classic assets do not display modern ranked data. Preserve the existing
  // zero-request path.
  if (isClassicAssetMode(gameInfo.gameQueueConfigId, gameInfo.gameMode)) {
    return new Map();
  }
  logger.info(
    `Fetching ranks for ${gameInfo.participants.length.toString()} participants`,
  );
  const lookups = gameInfo.participants.flatMap((participant) =>
    participant.puuid === null
      ? []
      : [
          {
            puuid: participant.puuid,
            request: getRankByPuuid(
              LeaguePuuidSchema.parse(participant.puuid),
              region,
            ),
          },
        ],
  );
  const results = await Promise.allSettled(
    lookups.map((lookup) => lookup.request),
  );
  const ranksByPuuid = new Map<string, RankLookupResult>();
  for (const [index, lookup] of lookups.entries()) {
    const result = results[index];
    if (result === undefined) {
      throw new Error(`Missing settled rank result for ${lookup.puuid}`);
    }
    if (result.status === "fulfilled") {
      ranksByPuuid.set(lookup.puuid, result.value);
    } else {
      logger.error("Participant rank lookup rejected", result.reason, {
        puuid: lookup.puuid,
      });
      ranksByPuuid.set(lookup.puuid, { status: "error" });
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
    return participant.playerSubteamId === undefined
      ? { arenaTeam: null }
      : { arenaTeam: ArenaTeamIdSchema.parse(participant.playerSubteamId) };
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
  masteries: ParticipantMasteries,
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
    ...withSelectedChampionMastery(
      puuid,
      getModernChampionIdForClassic(championId),
      masteries,
    ),
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

/**
 * Assign lanes to a standard roster, keeping its shape honest.
 *
 * `bots` are already final — they carry the lane the client assigned — so they
 * are never handed to the inference. They still count as occupying their side:
 * in a game against bots, Riot's roster can leave a whole side empty, and that
 * side is not empty at all.
 */
function inferStandardParticipants(
  participants: readonly RankedBuiltParticipant[],
  bots: readonly StandardLoadingScreenParticipant[],
  gameInfo: RawCurrentGameInfo,
  queueType: QueueType | undefined,
): StandardLoadingScreenParticipant[] {
  // A custom lobby is legitimately not a full ten — a tournament code carries
  // a teamSize of 1-5. Every other queue arriving short is the partial
  // pre-start-lobby snapshot the poller defers on, so it must keep raising.
  const isCustomLobby = queueType === "custom";
  const rosterSize = participants.length + bots.length;

  if (!isCustomLobby && rosterSize !== 10) {
    throw new RecoverableLoadingScreenDataError(
      buildIncompleteLobbyMessage(rosterSize, gameInfo),
    );
  }

  const result = new Map<number, StandardLoadingScreenParticipant>();

  for (const team of ["blue", "red"]) {
    const indexedTeam = participants
      .map((participant, index) => ({ participant, index }))
      .filter((entry) => entry.participant.team === team);
    const sideBots = bots.filter((bot) => bot.team === team).length;
    const sideSize = indexedTeam.length + sideBots;
    // Nobody on a side is broken in every mode, custom included.
    if (sideSize === 0 || (!isCustomLobby && sideSize !== 5)) {
      throw new RecoverableLoadingScreenDataError(
        buildLopsidedTeamMessage(team, sideSize, gameInfo),
      );
    }

    // The lane-prior model reads summoner spells, so it can only speak for a
    // participant who has them. Riot reports them for every real player; a
    // participant without them is one no lane can be inferred for.
    const inferable = indexedTeam.flatMap((entry) =>
      entry.participant.spell1Id === undefined ||
      entry.participant.spell2Id === undefined
        ? []
        : [
            {
              participantKey: laneInferenceKey(entry.index),
              championId: entry.participant.championId,
              spell1Id: entry.participant.spell1Id,
              spell2Id: entry.participant.spell2Id,
            },
          ],
    );

    if (
      indexedTeam.length !== 5 ||
      sideBots > 0 ||
      inferable.length !== indexedTeam.length
    ) {
      // The lane-prior model assigns one player per role across a full five.
      // On a shorter side, one shared with bots, or one it cannot read in
      // full, its answer would be invented, so omit the lane.
      for (const entry of indexedTeam) {
        result.set(
          entry.index,
          buildStandardParticipant(entry.participant, undefined),
        );
      }
      continue;
    }

    const inference = inferStandardLanesWithCurrentPriors(inferable);

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

  return [...inferred, ...bots];
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
  options: BuildLoadingScreenOptions = {},
): Promise<LoadingScreenData> {
  const { prefetchedRanks, observedBots = [] } = options;
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

  const masteriesByPuuid = await fetchParticipantMasteries(gameInfo, region);

  if (layout === "classic") {
    const participants = orderClassicParticipants(
      gameInfo.participants.map((participant) => {
        try {
          return buildClassicParticipant(
            participant,
            trackedPuuids,
            masteriesByPuuid,
          );
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

  // Build base participant data (without rank lookup state)
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
          rankState: { status: "hidden" },
        };
      }
      const rankState = ranksByPuuid.get(base.puuid);
      if (rankState === undefined) {
        throw new Error(`Missing rank lookup result for ${base.puuid}`);
      }
      return {
        ...base,
        rankState,
        ...withSelectedChampionMastery(
          base.puuid,
          base.championId,
          masteriesByPuuid,
        ),
      };
    },
  );

  // Bots skip the rank and mastery lookups — there is no PUUID to look either
  // up by — and arrive already carrying their lane.
  const participants: LoadingScreenParticipant[] =
    layout === "standard"
      ? inferStandardParticipants(
          rankedParticipants,
          observedBots.map((bot) => buildStandardBotParticipant(bot)),
          gameInfo,
          queueType,
        )
      : [
          ...rankedParticipants,
          ...observedBots.map((bot) => buildBotParticipant(bot)),
        ];

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
