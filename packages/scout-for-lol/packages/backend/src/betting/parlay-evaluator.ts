import { z } from "zod";
import {
  BucksParlayVoidReasonSchema,
  RiotTeamIdSchema,
  type BucksParlayVoidReason,
  type RawMatch,
} from "@scout-for-lol/data";
import { classifyMatchForBetting } from "#src/betting/outcome.ts";
import {
  matchNumericValue,
  opponentTeamPingValue,
  participantBooleanValue,
  participantNumericValue,
  teamBooleanValue,
  teamObjectiveValue,
} from "#src/betting/parlay-catalog.ts";
import {
  GeneratedParlaySchema,
  PARLAY_EVALUATOR_VERSION,
  ParlayConditionSchema,
  ParlaySubjectsSchema,
  parlaySemanticIssues,
  renderParlayCondition,
  type GeneratedParlay,
  type ParlayCondition,
  type ParlaySubject,
} from "#src/betting/parlay-criteria.ts";

export const ParlayLegResultSchema = z.strictObject({
  condition: ParlayConditionSchema,
  rendered: z.string().min(1),
  actualValue: z.union([z.number(), z.boolean()]),
  passed: z.boolean(),
});

export type ParlayLegResult = z.infer<typeof ParlayLegResultSchema>;
export const ParlayLegResultsSchema = z
  .array(ParlayLegResultSchema)
  .min(2)
  .max(6);

export type ParlayEvaluation =
  | { kind: "evaluated"; yesResult: boolean; legs: ParlayLegResult[] }
  | { kind: "void"; reason: BucksParlayVoidReason };

function compare(
  actual: number,
  operator: "gte" | "lte" | "eq",
  threshold: number,
): boolean {
  if (operator === "gte") return actual >= threshold;
  if (operator === "lte") return actual <= threshold;
  return actual === threshold;
}

function participantFor(
  matchData: RawMatch,
  condition: ParlayCondition,
  subjects: readonly ParlaySubject[],
) {
  if (
    condition.kind !== "participant_numeric" &&
    condition.kind !== "participant_boolean"
  ) {
    return;
  }
  const subject = subjects.find((item) => item.key === condition.subject);
  if (subject === undefined) return;
  return matchData.info.participants.find(
    (participant) => participant.puuid === subject.puuid,
  );
}

function evaluateCondition(input: {
  condition: ParlayCondition;
  matchData: RawMatch;
  subjects: readonly ParlaySubject[];
  selectedTeamId: 100 | 200;
}): { actualValue: number | boolean; passed: boolean } | undefined {
  const { condition } = input;
  if (condition.kind === "participant_numeric") {
    const participant = participantFor(
      input.matchData,
      condition,
      input.subjects,
    );
    if (participant === undefined) return;
    const actualValue = participantNumericValue(participant, condition.field);
    if (actualValue === undefined) return;
    return {
      actualValue,
      passed: compare(actualValue, condition.operator, condition.threshold),
    };
  }
  if (condition.kind === "participant_boolean") {
    const participant = participantFor(
      input.matchData,
      condition,
      input.subjects,
    );
    if (participant === undefined) return;
    const actualValue = participantBooleanValue(participant, condition.field);
    if (actualValue === undefined) return;
    return { actualValue, passed: actualValue === condition.expected };
  }
  if (condition.kind === "opponent_team_pings") {
    const actualValue = opponentTeamPingValue(
      input.matchData.info.participants,
      input.selectedTeamId,
      condition.field,
    );
    return {
      actualValue,
      passed: compare(actualValue, condition.operator, condition.threshold),
    };
  }
  const team = input.matchData.info.teams.find(
    (candidate) => candidate.teamId === input.selectedTeamId,
  );
  if (
    condition.kind === "team_boolean" ||
    condition.kind === "team_objective_first" ||
    condition.kind === "team_objective_kills"
  ) {
    if (team === undefined) return;
    if (condition.kind === "team_boolean") {
      const actualValue = teamBooleanValue(team, condition.field);
      return { actualValue, passed: actualValue === condition.expected };
    }
    const objective = teamObjectiveValue(team, condition.objective);
    if (condition.kind === "team_objective_first") {
      return {
        actualValue: objective.first,
        passed: objective.first === condition.expected,
      };
    }
    return {
      actualValue: objective.kills,
      passed: compare(objective.kills, condition.operator, condition.threshold),
    };
  }
  const actualValue = matchNumericValue(input.matchData.info, condition.field);
  return {
    actualValue,
    passed: compare(actualValue, condition.operator, condition.threshold),
  };
}

/** Pure settlement oracle. It deliberately classifies the match before reading
 * any leg, so a remake refunds even when an early-surrender leg would be true. */
export function evaluateParlay(input: {
  matchData: RawMatch;
  evaluatorVersion: string;
  selectedTeamId: number;
  subjects: unknown;
  criteria: unknown;
}): ParlayEvaluation {
  const classification = classifyMatchForBetting(input.matchData);
  if (classification.kind === "void") {
    return {
      kind: "void",
      reason: BucksParlayVoidReasonSchema.parse(classification.reason),
    };
  }
  if (input.evaluatorVersion !== PARLAY_EVALUATOR_VERSION) {
    return { kind: "void", reason: "unknown_evaluator" };
  }
  const teamResult = RiotTeamIdSchema.safeParse(input.selectedTeamId);
  const subjectResult = ParlaySubjectsSchema.safeParse(input.subjects);
  const criteriaResult = GeneratedParlaySchema.safeParse(input.criteria);
  if (
    !teamResult.success ||
    !subjectResult.success ||
    !criteriaResult.success
  ) {
    return { kind: "void", reason: "invalid_definition" };
  }
  if (
    parlaySemanticIssues(criteriaResult.data, subjectResult.data).length > 0
  ) {
    return { kind: "void", reason: "invalid_definition" };
  }

  const legs: ParlayLegResult[] = [];
  for (const condition of criteriaResult.data.conditions) {
    const evaluated = evaluateCondition({
      condition,
      matchData: input.matchData,
      subjects: subjectResult.data,
      selectedTeamId: teamResult.data,
    });
    if (evaluated === undefined) {
      return { kind: "void", reason: "missing_data" };
    }
    legs.push(
      ParlayLegResultSchema.parse({
        condition,
        rendered: renderParlayCondition(condition, subjectResult.data),
        ...evaluated,
      }),
    );
  }
  return {
    kind: "evaluated",
    yesResult: legs.every((leg) => leg.passed),
    legs,
  };
}

export function serializeParlayCriteria(criteria: GeneratedParlay): string {
  return JSON.stringify(GeneratedParlaySchema.parse(criteria));
}
