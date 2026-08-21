import {
  BucksPredictionObservationSchema,
  LeaguePuuidSchema,
  RiotTeamIdSchema,
  type BucksPredictionFeature,
  type BucksPredictionObservation,
  type QueueType,
  type Rank,
  type Ranks,
  type RawCurrentGameInfo,
  type RawCurrentGameParticipant,
  inferStandardLanesWithCurrentPriors,
  parseLane,
  rankToLeaguePoints,
} from "@scout-for-lol/data";
import { BLUE_TEAM_ID, RED_TEAM_ID } from "#src/betting/constants.ts";
import { isStandardLobby } from "#src/betting/eligibility.ts";
import type { ParticipantRanks } from "#src/league/tasks/prematch/loading-screen-builder.ts";
import { predictWin } from "#src/betting/prediction.ts";
import { createLogger } from "#src/logger.ts";
import {
  fetchPredictionHistory,
  type LakePredictionHistoryRow,
} from "#src/reports/duckdb/prediction-history.ts";
import { ReportQueryTimeoutError } from "#src/reports/duckdb/instance.ts";

const logger = createLogger("betting-prediction-inputs");

const LAKE_TIMEOUT_MS = 1500;
const HISTORY_LIMIT_PER_PLAYER = 30;
const RECENT_FORM_LIMIT = 20;

export type PredictionInputDependencies = {
  fetchHistory: typeof fetchPredictionHistory;
};

const defaultDependencies: PredictionInputDependencies = {
  fetchHistory: fetchPredictionHistory,
};

function rankForQueue(
  ranks: Ranks | undefined,
  queueType: QueueType,
): Rank | undefined {
  if (queueType === "solo") {
    return ranks?.solo;
  }
  if (queueType === "flex") {
    return ranks?.flex;
  }
  return undefined;
}

function summarize(rows: readonly LakePredictionHistoryRow[]): {
  wins: number;
  games: number;
} {
  return {
    wins: rows.filter((row) => row.win).length,
    games: rows.length,
  };
}

async function fetchLobbyHistory(
  input: {
    puuids: string[];
    matchId: string;
    queueType: QueueType;
    observedAt: Date;
  },
  dependencies: PredictionInputDependencies,
): Promise<LakePredictionHistoryRow[]> {
  try {
    return await dependencies.fetchHistory({
      puuids: input.puuids,
      excludeMatchId: input.matchId,
      queue: input.queueType,
      beforeMs: input.observedAt.getTime(),
      limitPerPlayer: HISTORY_LIMIT_PER_PLAYER,
      timeoutMs: LAKE_TIMEOUT_MS,
    });
  } catch (error) {
    if (error instanceof ReportQueryTimeoutError) {
      logger.debug(
        `⏱️ Lake history lookup timed out for ${input.matchId}; predicting from ranks only`,
      );
      return [];
    }
    throw error;
  }
}

function buildFeature(input: {
  participant: RawCurrentGameParticipant;
  lane: string;
  ranks: Ranks | undefined;
  queueType: QueueType;
  history: readonly LakePredictionHistoryRow[];
}): BucksPredictionFeature {
  const rank = rankForQueue(input.ranks, input.queueType);
  const recentRows = input.history.slice(0, RECENT_FORM_LIMIT);
  const laneRows = input.history.filter(
    (row) => parseLane(row.team_position) === input.lane,
  );
  const championRows = input.history.filter(
    (row) => row.champion_id === input.participant.championId,
  );
  return {
    puuid:
      input.participant.puuid === null
        ? null
        : LeaguePuuidSchema.parse(input.participant.puuid),
    teamId: RiotTeamIdSchema.parse(input.participant.teamId),
    championId: input.participant.championId,
    lane: input.lane,
    rankLeaguePoints: rank === undefined ? null : rankToLeaguePoints(rank),
    seasonWins: rank?.wins ?? null,
    seasonLosses: rank?.losses ?? null,
    recentForm: summarize(recentRows),
    laneForm: summarize(laneRows),
    championForm: summarize(championRows),
  };
}

function laneInferenceKey(index: number): string {
  return `participant:${index.toString()}`;
}

function inferLanes(
  participants: readonly RawCurrentGameParticipant[],
): string[] {
  const lanesByIndex = new Map<number, string>();
  for (const teamId of [BLUE_TEAM_ID, RED_TEAM_ID]) {
    const team = participants
      .map((participant, index) => ({ participant, index }))
      .filter((entry) => entry.participant.teamId === teamId);
    const inference = inferStandardLanesWithCurrentPriors(
      team.map((entry) => ({
        participantKey: laneInferenceKey(entry.index),
        championId: entry.participant.championId,
        spell1Id: entry.participant.spell1Id,
        spell2Id: entry.participant.spell2Id,
      })),
    );
    for (const assignment of inference.assignments) {
      const index = Number(
        assignment.participantKey.replace("participant:", ""),
      );
      lanesByIndex.set(index, assignment.lane);
    }
  }
  return participants.map((_participant, index) => {
    const lane = lanesByIndex.get(index);
    if (lane === undefined) {
      throw new Error(
        `Lane inference did not produce participant at index ${index.toString()}`,
      );
    }
    return lane;
  });
}

/** Build and freeze one canonical v2 estimate for a standard lobby. */
export async function buildPredictionObservation(
  input: {
    gameInfo: RawCurrentGameInfo;
    ranksByPuuid: ParticipantRanks;
    matchId: string;
    platformId: string;
    queueType: QueueType;
    observedAt: Date;
    gameStartAt: Date;
  },
  dependencies: PredictionInputDependencies = defaultDependencies,
): Promise<BucksPredictionObservation | undefined> {
  if (!isStandardLobby(input.gameInfo.participants)) {
    return undefined;
  }
  const puuids = input.gameInfo.participants.flatMap((participant) =>
    participant.puuid === null ? [] : [participant.puuid],
  );
  const history = await fetchLobbyHistory(
    {
      puuids,
      matchId: input.matchId,
      queueType: input.queueType,
      observedAt: input.observedAt,
    },
    dependencies,
  );
  const historyByPuuid = new Map<string, LakePredictionHistoryRow[]>();
  for (const row of history) {
    historyByPuuid.set(row.puuid, [
      ...(historyByPuuid.get(row.puuid) ?? []),
      row,
    ]);
  }
  const lanes = inferLanes(input.gameInfo.participants);
  const features = input.gameInfo.participants.map((participant, index) => {
    const lane = lanes[index];
    if (lane === undefined) {
      throw new Error(`Missing inferred lane at index ${index.toString()}`);
    }
    return buildFeature({
      participant,
      lane,
      ranks:
        participant.puuid === null
          ? undefined
          : input.ranksByPuuid.get(participant.puuid),
      queueType: input.queueType,
      history:
        participant.puuid === null
          ? []
          : (historyByPuuid.get(participant.puuid) ?? []),
    });
  });
  const prediction = predictWin({
    features,
    queueType: input.queueType,
  });
  return BucksPredictionObservationSchema.parse({
    version: 1,
    matchId: input.matchId,
    platformId: input.platformId,
    gameId: input.gameInfo.gameId.toString(),
    queueType: input.queueType,
    observedAt: input.observedAt.toISOString(),
    gameStartAt: input.gameStartAt.toISOString(),
    prediction,
    features,
  });
}
