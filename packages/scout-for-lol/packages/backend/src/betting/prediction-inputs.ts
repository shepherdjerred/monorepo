import type {
  LoadingScreenData,
  LoadingScreenParticipant,
  QueueType,
  Rank,
  Team,
} from "@scout-for-lol/data";
import { createLogger } from "#src/logger.ts";
import { fetchRecentGamesForPuuids } from "#src/reports/duckdb/lake-reads.ts";
import {
  predictWin,
  type PredictionForm,
  type PredictionParticipant,
} from "#src/betting/prediction.ts";
import type { BucksPrediction } from "@scout-for-lol/data";

const logger = createLogger("betting-prediction-inputs");

/**
 * Assembles the inputs `predictWin` needs, at prematch time, for free.
 *
 * The cost model is the whole point of this file:
 *
 * - **Ranks are already fetched.** `buildLoadingScreenData` calls
 *   `getRankByPuuid` for all ten participants and attaches the result to each
 *   `LoadingScreenParticipant`. This function reads that structure and must
 *   NEVER re-fetch. The prematch poll runs every 30 seconds across up to 50
 *   players; ten Riot calls per game per poll would be thousands of requests a
 *   minute and would blow the rate limit immediately.
 * - **Form is one local read.** A single DuckDB query against the report lake
 *   for the tracked subject only, bounded by a short timeout, and dropped
 *   entirely on failure. The formula degrades rather than blocking the
 *   notification.
 */

/** The lake read is best-effort garnish on a message that must go out on time,
 * so it gets a short leash. */
const LAKE_TIMEOUT_MS = 1500;
const RECENT_GAMES_LIMIT = 30;

/** Which of the two ranked queues a rank should be read from. */
function rankForQueue(
  participant: LoadingScreenParticipant,
  queueType: QueueType,
): Rank | undefined {
  if (queueType === "solo") {
    return participant.ranks?.solo;
  }
  if (queueType === "flex") {
    return participant.ranks?.flex;
  }
  return undefined;
}

export function toPredictionParticipants(input: {
  participants: readonly LoadingScreenParticipant[];
  queueType: QueueType;
  subjectTeam: Team;
}): PredictionParticipant[] {
  return input.participants.map((participant) => ({
    rank: rankForQueue(participant, input.queueType),
    isSubjectTeam: participant.team === input.subjectTeam,
  }));
}

function summarize(rows: readonly { win: boolean }[]): PredictionForm {
  return {
    wins: rows.filter((row) => row.win).length,
    games: rows.length,
  };
}

/**
 * Recent overall form and form on the champion being played, from one lake
 * read.
 *
 * Returns undefined for both on any failure — a missing lake directory, a
 * DuckDB error, or the timeout. That is deliberate: the report lake is
 * disposable derived data, and a prematch notification must not wait on it or
 * fail because of it.
 */
export async function fetchSubjectForm(input: {
  subjectPuuid: string;
  championName: string;
  excludeMatchId: string;
}): Promise<{
  recentForm: PredictionForm | undefined;
  championForm: PredictionForm | undefined;
}> {
  const empty = { recentForm: undefined, championForm: undefined };

  try {
    const rows = await Promise.race([
      fetchRecentGamesForPuuids({
        puuids: [input.subjectPuuid],
        excludeMatchId: input.excludeMatchId,
        limit: RECENT_GAMES_LIMIT,
      }),
      new Promise<undefined>((resolve) => {
        setTimeout(() => {
          resolve(undefined);
        }, LAKE_TIMEOUT_MS);
      }),
    ]);

    if (rows === undefined) {
      logger.debug(
        `⏱️ Lake form lookup timed out for ${input.excludeMatchId}; predicting without it`,
      );
      return empty;
    }

    return {
      recentForm: summarize(rows),
      // Champion form comes from the same rows rather than a second query.
      championForm: summarize(
        rows.filter((row) => row.champion_name === input.championName),
      ),
    };
  } catch (error) {
    logger.warn(
      `⚠️ Lake form lookup failed for ${input.excludeMatchId}; predicting without it`,
      error,
    );
    return empty;
  }
}

/**
 * Build Scout's call for one tracked player in a live game.
 *
 * Returns undefined when the lobby is not a standard ranked 5v5 — the same
 * games the market refuses — so a caller never has to decide separately
 * whether a prediction is meaningful.
 */
export async function buildPrediction(input: {
  loadingScreenData: LoadingScreenData;
  subject: { puuid: string; alias: string; team: Team; championName: string };
  matchId: string;
}): Promise<BucksPrediction | undefined> {
  const { loadingScreenData } = input;
  if (loadingScreenData.layout !== "standard") {
    return undefined;
  }

  const participants = toPredictionParticipants({
    participants: loadingScreenData.participants,
    queueType: loadingScreenData.queueType,
    subjectTeam: input.subject.team,
  });

  const { recentForm, championForm } = await fetchSubjectForm({
    subjectPuuid: input.subject.puuid,
    championName: input.subject.championName,
    excludeMatchId: input.matchId,
  });

  // The stored prediction records which side it was made about, so a later
  // reader (the post-match recap, or a calibration pass) never has to guess
  // whether "63%" meant blue or red.
  return {
    ...predictWin({
      subjectAlias: input.subject.alias,
      participants,
      recentForm,
      championForm,
    }),
    subjectTeamId: input.subject.team === "blue" ? 100 : 200,
  };
}
