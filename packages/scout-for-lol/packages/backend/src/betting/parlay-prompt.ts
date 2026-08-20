import { z } from "zod";
import {
  rankToString,
  type LoadingScreenData,
  type QueueType,
} from "@scout-for-lol/data";
import { createLogger } from "#src/logger.ts";
import { promptFieldCatalog } from "#src/betting/parlay-catalog.ts";
import {
  groundedParticipantFields,
  groundedTeamObjectives,
} from "#src/betting/parlay-stat-fields.ts";
import type { ParlaySubject } from "#src/betting/parlay-criteria.ts";
import { fetchRecentQueueGamesForPuuids } from "#src/reports/duckdb/lake-reads.ts";
import { ReportQueryTimeoutError } from "#src/reports/duckdb/instance.ts";

const logger = createLogger("betting-parlay-prompt");

export const PARLAY_PROMPT_VERSION = "2";
const HISTORY_TIMEOUT_MS = 1500;
const HISTORY_LIMIT = 30;

const FormSummarySchema = z.strictObject({
  available: z.boolean(),
  games: z.number().int().nonnegative(),
  wins: z.number().int().nonnegative(),
  averageKills: z.number().nonnegative(),
  averageDeaths: z.number().nonnegative(),
  averageAssists: z.number().nonnegative(),
  averageCreepScore: z.number().nonnegative(),
});

const SubjectHistorySchema = z.strictObject({
  subject: z.string().regex(/^P[1-5]$/),
  overall: FormSummarySchema,
  currentChampion: FormSummarySchema,
});

const LobbyParticipantSchema = z.strictObject({
  key: z.string().min(1),
  team: z.enum(["selected", "opponent"]),
  champion: z.string().min(1),
  role: z.string().min(1),
  rank: z.string().min(1),
  tracked: z.boolean(),
});

export const ParlayGenerationContextSchema = z.strictObject({
  queue: z.enum(["solo", "flex"]),
  selectedSubjects: z
    .array(z.string().regex(/^P[1-5]$/))
    .min(1)
    .max(5),
  lobby: z.array(LobbyParticipantSchema).length(10),
  history: z.array(SubjectHistorySchema).min(1).max(5),
});

export type ParlayGenerationContext = z.infer<
  typeof ParlayGenerationContextSchema
>;

function currentRank(
  participant: Extract<
    LoadingScreenData,
    { layout: "standard" }
  >["participants"][number],
  queue: QueueType,
): string {
  const rank =
    queue === "solo" ? participant.ranks?.solo : participant.ranks?.flex;
  return rank === undefined ? "unranked or unavailable" : rankToString(rank);
}

function roundedAverage(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const total = values.reduce((sum, value) => sum + value, 0);
  return Math.round((total / values.length) * 10) / 10;
}

function summarize(
  rows: readonly {
    win: boolean;
    kills: number;
    deaths: number;
    assists: number;
    creep_score: number;
  }[],
  available: boolean,
) {
  return FormSummarySchema.parse({
    available,
    games: rows.length,
    wins: rows.filter((row) => row.win).length,
    averageKills: roundedAverage(rows.map((row) => row.kills)),
    averageDeaths: roundedAverage(rows.map((row) => row.deaths)),
    averageAssists: roundedAverage(rows.map((row) => row.assists)),
    averageCreepScore: roundedAverage(rows.map((row) => row.creep_score)),
  });
}

async function recentHistory(input: {
  matchId: string;
  queue: "solo" | "flex";
  subjects: readonly ParlaySubject[];
  championByPuuid: ReadonlyMap<string, string>;
}) {
  try {
    const rows = await fetchRecentQueueGamesForPuuids({
      puuids: input.subjects.map((subject) => subject.puuid),
      queue: input.queue,
      excludeMatchId: input.matchId,
      limitPerPlayer: HISTORY_LIMIT,
      timeoutMs: HISTORY_TIMEOUT_MS,
    });
    return input.subjects.map((subject) => {
      const subjectRows = rows.filter((row) => row.puuid === subject.puuid);
      const champion = input.championByPuuid.get(subject.puuid);
      const championRows = subjectRows.filter(
        (row) => row.champion_name === champion,
      );
      return SubjectHistorySchema.parse({
        subject: subject.key,
        overall: summarize(subjectRows, true),
        currentChampion: summarize(championRows, true),
      });
    });
  } catch (error) {
    if (error instanceof ReportQueryTimeoutError) {
      logger.debug(`⏱️ Parlay history lookup timed out for ${input.matchId}`);
    } else {
      logger.warn(
        `⚠️ Parlay history lookup failed for ${input.matchId}; continuing without it`,
        error,
      );
    }
    return input.subjects.map((subject) =>
      SubjectHistorySchema.parse({
        subject: subject.key,
        overall: summarize([], false),
        currentChampion: summarize([], false),
      }),
    );
  }
}

export async function buildParlayGenerationContext(input: {
  matchId: string;
  queue: "solo" | "flex";
  loadingScreenData: LoadingScreenData;
  selectedTeamId: 100 | 200;
  subjects: readonly ParlaySubject[];
}): Promise<ParlayGenerationContext | undefined> {
  if (input.loadingScreenData.layout !== "standard") return;
  const selectedTeam = input.selectedTeamId === 100 ? "blue" : "red";
  const subjectByPuuid = new Map(
    input.subjects.map((subject) => [subject.puuid, subject]),
  );
  let selectedAnonymous = 0;
  let opponentAnonymous = 0;
  const lobby = input.loadingScreenData.participants.map((participant) => {
    const subject =
      participant.puuid === null
        ? undefined
        : subjectByPuuid.get(participant.puuid);
    const selected = participant.team === selectedTeam;
    const anonymousIndex = selected
      ? (selectedAnonymous += 1)
      : (opponentAnonymous += 1);
    return LobbyParticipantSchema.parse({
      key:
        subject?.key ?? `${selected ? "S" : "O"}${anonymousIndex.toString()}`,
      team: selected ? "selected" : "opponent",
      champion: participant.championDisplayName,
      role: participant.lane,
      rank: currentRank(participant, input.queue),
      tracked: subject !== undefined,
    });
  });
  const championByPuuid = new Map(
    input.loadingScreenData.participants.flatMap((participant) =>
      participant.puuid === null
        ? []
        : [[participant.puuid, participant.championName]],
    ),
  );
  const history = await recentHistory({
    matchId: input.matchId,
    queue: input.queue,
    subjects: input.subjects,
    championByPuuid,
  });
  return ParlayGenerationContextSchema.parse({
    queue: input.queue,
    selectedSubjects: input.subjects.map((subject) => subject.key),
    lobby,
    history,
  });
}

export const PARLAY_SYSTEM_PROMPT = `You create one entertaining but plausible League of Legends live parlay. Return only the requested structured object. The parlay is an AND: YES wins only when every leg is true. Use only the supplied subjects and closed field catalog. Never emit paths, code, SQL, expressions, IDs, or settlement prose. You never set odds: the harness measures the price from recorded history after you choose the legs.`;

/**
 * Pass one: choose the legs, with no numbers.
 *
 * Deliberately no thresholds here. Every threshold the model used to invent was
 * a guess about a distribution it had not been shown, and the ones on fields the
 * prompt never carried backtested as near-certainties. Choosing the shape first
 * lets the harness fetch exactly the statistics these legs need.
 */
export function buildParlayProposalPrompt(
  context: ParlayGenerationContext,
): string {
  return [
    "Choose 2-6 distinct conditions for one fixed-odds parlay. Do NOT choose any numbers yet.",
    "Every selected tracked subject must appear in at least one participant condition.",
    "Do not repeat a subject/field or team/objective target, even with another operator.",
    "Pick the operator for each condition: gte for an over, lte for an under.",
    "Aim for a mix: some ordinary lines, some genuinely surprising ones.",
    "Opponent ping conditions are about the ENEMY team and are a good source of the surprising kind.",
    "Every condition must include every structured slot. Fill the slots used by its kind and set every irrelevant slot to null.",
    "Do not combine incompatible win booleans or first-objective true with zero objective kills.",
    `Anonymous lobby and recent form:\n${JSON.stringify(context)}`,
    `Complete allowed field catalog:\n${JSON.stringify(
      promptFieldCatalog({
        participantNumericFields: groundedParticipantFields(),
        teamObjectives: groundedTeamObjectives(),
      }),
    )}`,
  ].join("\n\n");
}

/**
 * Pass two: choose the numbers, against measured distributions.
 *
 * The statistics are expressed as "the threshold that lands N% of the time",
 * already resolved for each leg's own operator, so the model reads the number it
 * wants rather than inverting a percentile.
 */
export function buildParlayThresholdPrompt(input: {
  context: ParlayGenerationContext;
  proposal: unknown;
  statistics: unknown;
}): string {
  return [
    "Set a threshold for each condition below. Return the same conditions in the same order, changing only the numbers.",
    "Do not add, remove, reorder, or re-target a condition. Do not change any field, subject, or operator.",
    "Aim for legs that land roughly 40-70% of the time individually, so the parlay is a real bet rather than a formality.",
    "The statistics give, for each condition, the threshold that lands a given percentage of the time, already oriented to that condition's operator.",
    "player rows are that player's own games; population rows are every tracked player's, sliced by lane and game length. n is how many games each row rests on - prefer a row with more games when they disagree.",
    "Conditions with no threshold slot (a team win) keep their expected value.",
    `Conditions to fill:\n${JSON.stringify(input.proposal)}`,
    `Measured statistics:\n${JSON.stringify(input.statistics)}`,
    `Anonymous lobby and recent form:\n${JSON.stringify(input.context)}`,
  ].join("\n\n");
}
