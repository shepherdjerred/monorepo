import { z } from "zod";
import type { RawMatch } from "#src/league/raw-match.schema.ts";
import { LaneSchema, parseLane, type Lane } from "#src/model/lane.ts";
import { inferStandardLanes } from "#src/lane-priors/inference.ts";
import {
  LanePriorArtifactSchema,
  type LaneInferenceParticipant,
  type LanePriorArtifact,
} from "#src/lane-priors/schema.ts";

export const LanePriorEvalExampleSchema = z.strictObject({
  matchId: z.string().min(1),
  queueId: z.number().int().positive(),
  participantKey: z.string().min(1),
  championId: z.number().int().positive(),
  spell1Id: z.number().int().nonnegative(),
  spell2Id: z.number().int().nonnegative(),
  actualLane: LaneSchema,
  guessedLane: LaneSchema,
});

export type LanePriorEvalExample = z.infer<typeof LanePriorEvalExampleSchema>;

const LaneConfusionRowSchema = z.strictObject({
  top: z.number().int().nonnegative(),
  jungle: z.number().int().nonnegative(),
  middle: z.number().int().nonnegative(),
  adc: z.number().int().nonnegative(),
  support: z.number().int().nonnegative(),
});

export const LanePriorEvalReportSchema = z.strictObject({
  generatedAt: z.iso.datetime({ offset: true }),
  source: z.strictObject({
    startDate: z.string().min(1),
    endDate: z.string().min(1),
    queueIds: z.array(z.number().int().positive()).min(1),
    sampleSize: z.number().int().positive(),
    seed: z.string().min(1),
  }),
  threshold: z.number().min(0).max(1),
  matchCount: z.number().int().nonnegative(),
  participantCount: z.number().int().nonnegative(),
  correctParticipantCount: z.number().int().nonnegative(),
  participantAccuracy: z.number().min(0).max(1),
  perLaneAccuracy: z.record(
    LaneSchema,
    z.strictObject({
      correct: z.number().int().nonnegative(),
      total: z.number().int().nonnegative(),
      accuracy: z.number().min(0).max(1),
    }),
  ),
  perQueueAccuracy: z.record(
    z.string(),
    z.strictObject({
      correct: z.number().int().nonnegative(),
      total: z.number().int().nonnegative(),
      accuracy: z.number().min(0).max(1),
    }),
  ),
  confusionMatrix: z.record(LaneSchema, LaneConfusionRowSchema),
  worstExamples: z.array(LanePriorEvalExampleSchema),
});

export type LanePriorEvalReport = z.infer<typeof LanePriorEvalReportSchema>;

function emptyLaneTotals(): Record<Lane, { correct: number; total: number }> {
  return {
    top: { correct: 0, total: 0 },
    jungle: { correct: 0, total: 0 },
    middle: { correct: 0, total: 0 },
    adc: { correct: 0, total: 0 },
    support: { correct: 0, total: 0 },
  };
}

function emptyConfusionRow(): Record<Lane, number> {
  return {
    top: 0,
    jungle: 0,
    middle: 0,
    adc: 0,
    support: 0,
  };
}

function emptyConfusionMatrix(): Record<Lane, Record<Lane, number>> {
  return {
    top: emptyConfusionRow(),
    jungle: emptyConfusionRow(),
    middle: emptyConfusionRow(),
    adc: emptyConfusionRow(),
    support: emptyConfusionRow(),
  };
}

function accuracy(correct: number, total: number): number {
  if (total === 0) {
    return 0;
  }
  return correct / total;
}

function participantKey(matchId: string, participantId: number): string {
  return `${matchId}:${participantId.toString()}`;
}

function blindTeamParticipants(
  match: RawMatch,
  teamId: number,
): {
  inferenceParticipants: LaneInferenceParticipant[];
  actualLanes: Map<string, Lane>;
} {
  const participants = match.info.participants.filter(
    (participant) => participant.teamId === teamId,
  );
  if (participants.length !== 5) {
    throw new Error(
      `Match ${match.metadata.matchId} team ${teamId.toString()} has ${participants.length.toString()} participants; expected 5`,
    );
  }

  const inferenceParticipants: LaneInferenceParticipant[] = [];
  const actualLanes = new Map<string, Lane>();
  for (const participant of participants) {
    const lane = parseLane(participant.teamPosition);
    if (lane === undefined) {
      throw new Error(
        `Match ${match.metadata.matchId} participant ${participant.participantId.toString()} is missing a standard teamPosition`,
      );
    }
    const key = participantKey(
      match.metadata.matchId,
      participant.participantId,
    );
    inferenceParticipants.push({
      participantKey: key,
      championId: participant.championId,
      spell1Id: participant.summoner1Id,
      spell2Id: participant.summoner2Id,
    });
    actualLanes.set(key, lane);
  }
  return { inferenceParticipants, actualLanes };
}

function addQueueTotals(
  queueTotals: Map<number, { correct: number; total: number }>,
  queueId: number,
  correct: boolean,
): void {
  const current = queueTotals.get(queueId) ?? { correct: 0, total: 0 };
  queueTotals.set(queueId, {
    correct: current.correct + (correct ? 1 : 0),
    total: current.total + 1,
  });
}

function serializeLaneTotals(
  totals: Record<Lane, { correct: number; total: number }>,
): Record<Lane, { correct: number; total: number; accuracy: number }> {
  return {
    top: {
      ...totals.top,
      accuracy: accuracy(totals.top.correct, totals.top.total),
    },
    jungle: {
      ...totals.jungle,
      accuracy: accuracy(totals.jungle.correct, totals.jungle.total),
    },
    middle: {
      ...totals.middle,
      accuracy: accuracy(totals.middle.correct, totals.middle.total),
    },
    adc: {
      ...totals.adc,
      accuracy: accuracy(totals.adc.correct, totals.adc.total),
    },
    support: {
      ...totals.support,
      accuracy: accuracy(totals.support.correct, totals.support.total),
    },
  };
}

function serializeQueueTotals(
  queueTotals: Map<number, { correct: number; total: number }>,
): Record<string, { correct: number; total: number; accuracy: number }> {
  const result: Record<
    string,
    { correct: number; total: number; accuracy: number }
  > = {};
  for (const [queueId, totals] of [...queueTotals.entries()].toSorted(
    ([left], [right]) => left - right,
  )) {
    result[queueId.toString()] = {
      ...totals,
      accuracy: accuracy(totals.correct, totals.total),
    };
  }
  return result;
}

function addWrongExample(input: {
  wrongExamples: LanePriorEvalExample[];
  match: RawMatch;
  assignment: { participantKey: string; lane: Lane };
  inferenceParticipants: readonly LaneInferenceParticipant[];
  actualLane: Lane;
}): void {
  const sourceParticipant = input.inferenceParticipants.find(
    (participant) =>
      participant.participantKey === input.assignment.participantKey,
  );
  if (sourceParticipant === undefined) {
    throw new Error(
      `Missing blinded participant for ${input.assignment.participantKey}`,
    );
  }
  input.wrongExamples.push({
    matchId: input.match.metadata.matchId,
    queueId: input.match.info.queueId,
    participantKey: input.assignment.participantKey,
    championId: sourceParticipant.championId,
    spell1Id: sourceParticipant.spell1Id,
    spell2Id: sourceParticipant.spell2Id,
    actualLane: input.actualLane,
    guessedLane: input.assignment.lane,
  });
}

export function evaluateLanePriors(input: {
  matches: readonly RawMatch[];
  artifact: LanePriorArtifact;
  sourceStartDate: string;
  sourceEndDate: string;
  queueIds: readonly number[];
  sampleSize: number;
  seed: string;
  threshold: number;
  generatedAt: string;
}): LanePriorEvalReport {
  const artifact = LanePriorArtifactSchema.parse(input.artifact);
  const queueIds = new Set(input.queueIds);
  const laneTotals = emptyLaneTotals();
  const queueTotals = new Map<number, { correct: number; total: number }>();
  const confusionMatrix = emptyConfusionMatrix();
  const wrongExamples: LanePriorEvalExample[] = [];
  let matchCount = 0;
  let participantCount = 0;
  let correctParticipantCount = 0;

  for (const match of input.matches) {
    if (!queueIds.has(match.info.queueId)) {
      continue;
    }
    matchCount += 1;
    for (const teamId of [100, 200]) {
      const { inferenceParticipants, actualLanes } = blindTeamParticipants(
        match,
        teamId,
      );
      const result = inferStandardLanes(inferenceParticipants, artifact);
      for (const assignment of result.assignments) {
        const actualLane = actualLanes.get(assignment.participantKey);
        if (actualLane === undefined) {
          throw new Error(
            `Missing actual lane for ${assignment.participantKey}`,
          );
        }
        const correct = assignment.lane === actualLane;
        participantCount += 1;
        correctParticipantCount += correct ? 1 : 0;
        laneTotals[actualLane] = {
          correct: laneTotals[actualLane].correct + (correct ? 1 : 0),
          total: laneTotals[actualLane].total + 1,
        };
        confusionMatrix[actualLane][assignment.lane] += 1;
        addQueueTotals(queueTotals, match.info.queueId, correct);

        if (correct) {
          continue;
        }
        addWrongExample({
          wrongExamples,
          match,
          assignment,
          inferenceParticipants,
          actualLane,
        });
      }
    }
  }

  const report = LanePriorEvalReportSchema.parse({
    generatedAt: input.generatedAt,
    source: {
      startDate: input.sourceStartDate,
      endDate: input.sourceEndDate,
      queueIds: [...input.queueIds],
      sampleSize: input.sampleSize,
      seed: input.seed,
    },
    threshold: input.threshold,
    matchCount,
    participantCount,
    correctParticipantCount,
    participantAccuracy: accuracy(correctParticipantCount, participantCount),
    perLaneAccuracy: serializeLaneTotals(laneTotals),
    perQueueAccuracy: serializeQueueTotals(queueTotals),
    confusionMatrix,
    worstExamples: wrongExamples.slice(0, 25),
  });

  if (report.participantAccuracy < input.threshold) {
    throw new Error(
      `Lane-prior eval accuracy ${report.participantAccuracy.toString()} is below threshold ${input.threshold.toString()}`,
    );
  }

  return report;
}
