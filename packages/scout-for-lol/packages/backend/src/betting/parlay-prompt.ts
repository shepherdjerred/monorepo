import { z } from "zod";
import {
  rankToString,
  type LoadingScreenData,
  type QueueType,
} from "@scout-for-lol/data";
import { createLogger } from "#src/logger.ts";
import { promptFieldCatalog } from "#src/betting/parlay-catalog.ts";
import type { ParlaySubject } from "#src/betting/parlay-criteria.ts";
import { fetchRecentQueueGamesForPuuids } from "#src/reports/duckdb/lake-reads.ts";
import { ReportQueryTimeoutError } from "#src/reports/duckdb/instance.ts";

const logger = createLogger("betting-parlay-prompt");

export const PARLAY_PROMPT_VERSION = "1";
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

export const PARLAY_SYSTEM_PROMPT = `You create one entertaining but plausible League of Legends live parlay. Return only the requested structured object. The parlay is an AND: YES wins only when every leg is true. Use only the supplied subjects and closed field catalog. Never emit paths, code, SQL, expressions, IDs, or settlement prose.`;

export function buildParlayPrompt(context: ParlayGenerationContext): string {
  return [
    "Create one fixed-odds parlay with 2-6 distinct conditions.",
    "Every selected tracked subject must appear in at least one participant condition.",
    "Do not repeat a subject/field or team/objective target, even with another operator.",
    "Do not combine incompatible win booleans, multiple players getting the same first kill, or first-objective true with zero objective kills.",
    "Use only the selected team for team conditions. Keep thresholds plausible for this lobby and recent form.",
    "Every condition must include every structured slot. Fill the slots used by its kind and set every irrelevant slot to null.",
    "Set yesProbabilityBps from 1000 through 9000. NO is the complement. Do not try to calculate bookmaker-grade odds.",
    "A remake refunds the market even if an early-surrender or lifecycle condition would otherwise be true.",
    `Anonymous lobby and recent form:\n${JSON.stringify(context)}`,
    `Complete allowed field catalog:\n${JSON.stringify(promptFieldCatalog())}`,
  ].join("\n\n");
}
