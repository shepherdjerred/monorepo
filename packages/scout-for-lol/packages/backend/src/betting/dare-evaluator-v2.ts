import {
  normalizeChampionName,
  type DareBooleanExpressionV2,
  type DareCompiledPlanV2,
  type DareGameSetV2,
  type DareTargetBindingV2,
  type DareValueV2,
  type QueueType,
  type RawMatch,
  type RawParticipant,
} from "@scout-for-lol/data";
import { dareValueNeedsTimeline } from "#src/betting/dare-value-v2.ts";
import {
  DareMatchEvidenceV2Schema,
  type DareMatchEvidenceV2,
  type DareTruthValue,
} from "#src/betting/dare-evidence-v2.ts";
import { evaluateDareEvidenceV2 as evaluateDareResultV2 } from "#src/betting/dare-result-evaluator-v2.ts";
import { andDareTruthV2, orDareTruthV2 } from "#src/betting/dare-truth-v2.ts";

export type DareTimelineEvidenceV2 = {
  coverage: "complete" | "missing";
  events: readonly {
    eventId: string;
    eventType: string;
    timestampMs: number;
    itemId: number | null;
  }[];
  participants: readonly {
    eventId: string;
    puuid: string | null;
    role: "subject" | "killer" | "victim" | "assist" | "creator";
  }[];
};

function compare(
  actual: string | number | boolean,
  operator: "eq" | "neq" | "gte" | "lte" | "gt" | "lt",
  expected: string | number | boolean,
): boolean {
  if (operator === "eq") return actual === expected;
  if (operator === "neq") return actual !== expected;
  if (typeof actual !== "number" || typeof expected !== "number") {
    throw new TypeError(
      `Dare v2 operator ${operator} requires numeric operands.`,
    );
  }
  if (operator === "gte") return actual >= expected;
  if (operator === "lte") return actual <= expected;
  if (operator === "gt") return actual > expected;
  return actual < expected;
}

function participantValue(
  participant: RawParticipant,
  field: Extract<DareValueV2, { kind: "participant" }>["field"],
): string | number | boolean {
  switch (field) {
    case "champion_name":
      return normalizeChampionName(participant.championName);
    case "team_position":
      return participant.teamPosition;
    case "team_id":
      return participant.teamId;
    case "win":
      return participant.win;
    case "kills":
      return participant.kills;
    case "deaths":
      return participant.deaths;
    case "assists":
      return participant.assists;
    case "creep_score":
      return participant.totalMinionsKilled + participant.neutralMinionsKilled;
    case "gold_earned":
      return participant.goldEarned;
    case "vision_score":
      return participant.visionScore;
    case "time_played":
      return participant.timePlayed;
    case "total_damage_dealt_to_champions":
      return participant.totalDamageDealtToChampions;
    case "wards_placed":
      return participant.wardsPlaced;
    case "wards_killed":
      return participant.wardsKilled;
    case "double_kills":
      return participant.doubleKills;
    case "triple_kills":
      return participant.tripleKills;
    case "quadra_kills":
      return participant.quadraKills;
    case "penta_kills":
      return participant.pentaKills;
  }
}

function participantRate(
  participant: RawParticipant,
  field: Extract<DareValueV2, { kind: "participant_rate" }>["field"],
): number | null {
  if (field === "kda") {
    return (
      (participant.kills + participant.assists) /
      Math.max(participant.deaths, 1)
    );
  }
  if (participant.timePlayed <= 0) return null;
  const total =
    field === "cs_per_minute"
      ? participant.totalMinionsKilled + participant.neutralMinionsKilled
      : participant.totalDamageDealtToChampions;
  return (total * 60) / participant.timePlayed;
}

function timelineEventCount(
  value: Extract<DareValueV2, { kind: "timeline_event_count" }>,
  timeline: DareTimelineEvidenceV2,
  participants: ReadonlyMap<string, RawParticipant>,
): number | null {
  if (timeline.coverage === "missing") return null;
  const puuid =
    value.target === null ? null : participants.get(value.target)?.puuid;
  if (puuid === undefined && value.target !== null) return 0;
  const participantEvents = new Set(
    timeline.participants
      .filter(
        (entry) =>
          (puuid === null || entry.puuid === puuid) &&
          (value.role === null || entry.role === value.role),
      )
      .map((entry) => entry.eventId),
  );
  return timeline.events.filter(
    (event) =>
      event.eventType === value.eventType &&
      (value.afterMs === null || event.timestampMs >= value.afterMs) &&
      (value.beforeMs === null || event.timestampMs <= value.beforeMs) &&
      (value.itemId === null || event.itemId === value.itemId) &&
      (value.target === null && value.role === null
        ? true
        : participantEvents.has(event.eventId)),
  ).length;
}

type PredicateContext = {
  matchData: RawMatch;
  participants: ReadonlyMap<string, RawParticipant>;
  timeline: DareTimelineEvidenceV2;
  queue: string;
};

function resolveArithmeticValue(
  value: Extract<DareValueV2, { kind: "arithmetic" }>,
  context: PredicateContext,
): number | null {
  const left = resolveValue(value.left, context);
  const right = resolveValue(value.right, context);
  if (left === null || right === null) return null;
  if (typeof left !== "number" || typeof right !== "number") {
    throw new TypeError("Dare v2 arithmetic operands must be numeric.");
  }
  if (value.operator === "add") return left + right;
  if (value.operator === "subtract") return left - right;
  if (value.operator === "multiply") return left * right;
  return right === 0 ? null : left / right;
}

function relatedParticipantCount(
  value: Extract<DareValueV2, { kind: "related_participant_count" }>,
  context: PredicateContext,
): number | null {
  const target = context.participants.get(value.target);
  if (target === undefined) return null;
  const champion =
    value.championName === null
      ? null
      : normalizeChampionName(value.championName);
  return context.matchData.info.participants.filter(
    (participant) =>
      participant.puuid !== target.puuid &&
      (value.relationship === "ally"
        ? participant.teamId === target.teamId
        : participant.teamId !== target.teamId) &&
      (champion === null ||
        normalizeChampionName(participant.championName) === champion),
  ).length;
}

function resolveValue(
  value: DareValueV2,
  context: PredicateContext,
): string | number | boolean | null {
  if (value.kind === "participant") {
    const participant = context.participants.get(value.target);
    return participant === undefined
      ? null
      : participantValue(participant, value.field);
  }
  if (value.kind === "participant_rate") {
    const participant = context.participants.get(value.target);
    return participant === undefined
      ? null
      : participantRate(participant, value.field);
  }
  if (value.kind === "game") {
    return value.field === "duration_seconds"
      ? context.matchData.info.gameDuration
      : context.queue;
  }
  if (value.kind === "related_participant_count") {
    return relatedParticipantCount(value, context);
  }
  if (value.kind === "arithmetic") {
    return resolveArithmeticValue(value, context);
  }
  return timelineEventCount(value, context.timeline, context.participants);
}

function evaluatePredicate(
  expression: DareBooleanExpressionV2,
  context: PredicateContext,
): DareTruthValue {
  if (expression.kind === "comparison") {
    const actual = resolveValue(expression.value, context);
    if (actual === null) return null;
    const expected =
      expression.value.kind === "participant" &&
      expression.value.field === "champion_name" &&
      typeof expression.threshold === "string"
        ? normalizeChampionName(expression.threshold)
        : expression.threshold;
    return compare(actual, expression.operator, expected);
  }
  if (expression.kind === "not") {
    const value = evaluatePredicate(expression.operand, context);
    return value === null ? null : !value;
  }
  const values = expression.operands.map((operand) =>
    evaluatePredicate(operand, context),
  );
  return expression.kind === "and"
    ? andDareTruthV2(values)
    : orDareTruthV2(values);
}

function participantsForSet(
  gameSet: DareGameSetV2,
  targets: readonly DareTargetBindingV2[],
  matchData: RawMatch,
): Map<string, RawParticipant> | undefined {
  const targetByKey = new Map(targets.map((target) => [target.key, target]));
  const participantByPuuid = new Map(
    matchData.info.participants.map((participant) => [
      participant.puuid,
      participant,
    ]),
  );
  const matched = new Map<string, RawParticipant>();
  for (const key of gameSet.targetKeys) {
    const target = targetByKey.get(key);
    if (target === undefined) throw new Error(`Unknown Dare v2 target ${key}.`);
    const participant = target.accounts
      .map((account) => participantByPuuid.get(account.puuid))
      .find((candidate) => candidate !== undefined);
    if (participant === undefined) return undefined;
    matched.set(key, participant);
  }
  const teams = [...matched.values()].map((participant) => participant.teamId);
  if (gameSet.relationship === "same_team" && new Set(teams).size !== 1) {
    return undefined;
  }
  if (
    gameSet.relationship === "opponents" &&
    (teams.length !== 2 || teams[0] === teams[1])
  ) {
    return undefined;
  }
  return matched;
}

function expressionNeedsTimeline(expression: DareBooleanExpressionV2): boolean {
  if (expression.kind === "comparison") {
    return dareValueNeedsTimeline(expression.value);
  }
  if (expression.kind === "not")
    return expressionNeedsTimeline(expression.operand);
  return expression.operands.some((operand) =>
    expressionNeedsTimeline(operand),
  );
}

type DareMatchEvaluationInput = Parameters<typeof evaluateDareMatchV2>[0];

function evaluateGameSet(
  input: DareMatchEvaluationInput,
  gameSet: DareGameSetV2,
): {
  candidate: boolean;
  result: DareTruthValue;
  values: Record<string, number | null>;
  needsTimeline: boolean;
} {
  const participants = participantsForSet(
    gameSet,
    input.targets,
    input.matchData,
  );
  const candidate =
    participants !== undefined && gameSet.queues.includes(input.queue);
  const needsTimeline =
    expressionNeedsTimeline(gameSet.predicate) ||
    gameSet.projections.some((projection) =>
      dareValueNeedsTimeline(projection.value),
    );
  const values: Record<string, number | null> = {};
  if (!candidate) {
    for (const projection of gameSet.projections) {
      values[projection.name] = null;
    }
    return { candidate, result: false, values, needsTimeline };
  }
  const context = {
    matchData: input.matchData,
    participants,
    timeline: input.timeline,
    queue: input.queue,
  };
  for (const projection of gameSet.projections) {
    const value = resolveValue(projection.value, context);
    if (value !== null && typeof value !== "number") {
      throw new TypeError(
        `Dare v2 projection ${gameSet.name}.${projection.name} did not produce a number.`,
      );
    }
    values[projection.name] = value;
  }
  return {
    candidate,
    result: evaluatePredicate(gameSet.predicate, context),
    values,
    needsTimeline,
  };
}

export function evaluateDareMatchV2(input: {
  plan: DareCompiledPlanV2;
  targets: readonly DareTargetBindingV2[];
  matchData: RawMatch;
  queue: QueueType;
  timeline: DareTimelineEvidenceV2;
}): DareMatchEvidenceV2 {
  const candidateSets: Record<string, boolean> = {};
  const setResults: Record<string, DareTruthValue> = {};
  const setValues: Record<string, Record<string, number | null>> = {};
  const targetDependencies: Record<string, string[]> = {};
  const trace: string[] = [];
  let needsTimeline = false;
  for (const gameSet of input.plan.gameSets) {
    const evaluated = evaluateGameSet(input, gameSet);
    candidateSets[gameSet.name] = evaluated.candidate;
    targetDependencies[gameSet.name] = [...gameSet.targetKeys];
    needsTimeline ||= evaluated.needsTimeline;
    setResults[gameSet.name] = evaluated.result;
    setValues[gameSet.name] = evaluated.values;
    trace.push(
      `${gameSet.name}: candidate=${String(evaluated.candidate)} result=${String(evaluated.result)}`,
    );
  }
  return DareMatchEvidenceV2Schema.parse({
    matchId: input.matchData.metadata.matchId,
    gameStartAt: new Date(
      input.matchData.info.gameStartTimestamp,
    ).toISOString(),
    gameEndAt: new Date(input.matchData.info.gameEndTimestamp).toISOString(),
    queue: input.queue,
    candidateSets,
    setResults,
    setValues,
    coverageState: needsTimeline ? input.timeline.coverage : "not_required",
    targetDependencies,
    sourceReferences: [
      `match:${input.matchData.metadata.matchId}`,
      ...(needsTimeline && input.timeline.coverage === "complete"
        ? [`timeline:${input.matchData.metadata.matchId}`]
        : []),
    ],
    evaluationTrace: trace,
  });
}

export function evaluateDareEvidenceV2(input: {
  plan: DareCompiledPlanV2;
  evidence: readonly DareMatchEvidenceV2[];
}): DareTruthValue {
  return evaluateDareResultV2(input);
}
