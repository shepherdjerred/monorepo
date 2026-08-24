import {
  OPPONENT_PING_HISTORY_COLUMNS,
  PARLAY_HISTORY_COLUMNS,
  TEAM_OBJECTIVE_HISTORY_COLUMNS,
} from "#src/betting/parlay-stat-fields.ts";
import { ParticipantNumericFieldSchema } from "#src/betting/parlay-catalog.ts";
import type {
  ParlayHistory,
  ParlayHistoryMatch,
} from "#src/betting/parlay-history.ts";
import type {
  ParlayCondition,
  ParlaySubject,
} from "#src/betting/parlay-criteria.ts";
import { durationBucket } from "#src/betting/parlay-stats.ts";

/**
 * What a parlay is worth, measured rather than guessed.
 *
 * The model used to publish its own `yesProbabilityBps` while the prompt told
 * it not to attempt bookmaker-grade odds. Measured against replayed history
 * those quotes ran about 4 points hot (28.1% quoted against 23.9% realised
 * across the parlays with enough history), which is a persistent edge against
 * whoever takes YES. The price now comes from the same rows the thresholds were
 * chosen against.
 */

/** Product bounds; a parlay outside them is not worth offering either side of. */
export const MIN_PRICE_BPS = 1000;
export const MAX_PRICE_BPS = 9000;

/** Enough replayed games to trust a joint frequency at all. */
export const MIN_PRICING_GAMES = 15;

export type ParlayPrice = {
  yesProbabilityBps: number;
  /** How the number was reached, stored so a published price stays auditable. */
  method: "joint_replay" | "conditional_combination";
  /** Games the estimate rests on. */
  samples: number;
  clamped: boolean;
};

type ConditionOutcome = boolean | undefined;

function compare(
  actual: number,
  operator: "gte" | "lte" | "eq",
  threshold: number,
): boolean {
  if (operator === "gte") return actual >= threshold;
  if (operator === "lte") return actual <= threshold;
  return actual === threshold;
}

/**
 * Whether a condition held in one historical match, or undefined when history
 * cannot answer.
 *
 * Undefined is never treated as false. A leg we cannot replay would otherwise
 * quietly drag every price toward zero, which is the opposite of the failure we
 * want: an unpriceable parlay must not be published at all.
 */
export function conditionHeldInMatch(
  condition: ParlayCondition,
  match: ParlayHistoryMatch,
  subjectKeyForMatch: string,
): ConditionOutcome {
  switch (condition.kind) {
    case "participant_numeric": {
      if (condition.subject !== subjectKeyForMatch) {
        return undefined;
      }
      const canonicalField = ParticipantNumericFieldSchema.safeParse(
        condition.field,
      );
      if (!canonicalField.success) {
        return undefined;
      }
      const column = PARLAY_HISTORY_COLUMNS[canonicalField.data];
      if (column === null) {
        return undefined;
      }
      const value = match.values.get(column);
      return value === undefined
        ? undefined
        : compare(value, condition.operator, condition.threshold);
    }
    case "team_boolean":
      return match.win === condition.expected;
    case "team_objective_kills": {
      const column = TEAM_OBJECTIVE_HISTORY_COLUMNS[condition.objective];
      if (column === null) {
        return undefined;
      }
      const value = match.teamValues.get(column);
      return value === undefined
        ? undefined
        : compare(value, condition.operator, condition.threshold);
    }
    case "match_numeric":
      return compare(
        match.durationSeconds,
        condition.operator,
        condition.threshold,
      );
    case "opponent_team_pings": {
      const value = match.opponentValues.get(
        OPPONENT_PING_HISTORY_COLUMNS[condition.field],
      );
      return value === undefined
        ? undefined
        : compare(value, condition.operator, condition.threshold);
    }
    // Participant booleans and first-objective flags are not reconstructable
    // from lake columns, so they cannot be priced.
    case "participant_boolean":
    case "team_objective_first":
      return undefined;
  }
}

/** Realized hit rate for one condition over the history used to price it. */
export function conditionRealizedRate(
  condition: ParlayCondition,
  matches: readonly ParlayHistoryMatch[],
  subjectKey: string,
): number | undefined {
  if (matches.length === 0) {
    return undefined;
  }
  let hits = 0;
  for (const match of matches) {
    const held = conditionHeldInMatch(condition, match, subjectKey);
    if (held === undefined) {
      return undefined;
    }
    if (held) {
      hits += 1;
    }
  }
  return hits / matches.length;
}

type NumericCondition = Extract<
  ParlayCondition,
  | { kind: "participant_numeric" }
  | { kind: "team_objective_kills" }
  | { kind: "match_numeric" }
  | { kind: "opponent_team_pings" }
>;

export type NumericThresholdDiagnostic = {
  conditionKind: NumericCondition["kind"];
  field: string;
  operator: NumericCondition["operator"];
  threshold: number;
  realizedRate: number | null;
  reason: "missing_subject" | "unmeasured" | "outside_target_range";
};

function numericConditionField(condition: NumericCondition): string {
  switch (condition.kind) {
    case "participant_numeric":
    case "match_numeric":
    case "opponent_team_pings":
      return condition.field;
    case "team_objective_kills":
      return `${condition.objective}_kills`;
  }
}

/** Explain numeric threshold failures without changing the pricing guard. */
export function numericThresholdDiagnostics(
  conditions: readonly ParlayCondition[],
  subjects: readonly ParlaySubject[],
  history: ParlayHistory,
): readonly NumericThresholdDiagnostic[] {
  const anchor = subjects[0];
  const diagnostics: NumericThresholdDiagnostic[] = [];
  for (const condition of conditions) {
    if (
      condition.kind !== "participant_numeric" &&
      condition.kind !== "team_objective_kills" &&
      condition.kind !== "match_numeric" &&
      condition.kind !== "opponent_team_pings"
    ) {
      continue;
    }
    const subject =
      condition.kind === "participant_numeric"
        ? subjects.find((candidate) => candidate.key === condition.subject)
        : anchor;
    const base = {
      conditionKind: condition.kind,
      field: numericConditionField(condition),
      operator: condition.operator,
      threshold: condition.threshold,
    };
    if (subject === undefined) {
      diagnostics.push({
        ...base,
        realizedRate: null,
        reason: "missing_subject",
      });
      continue;
    }
    const rate = conditionRealizedRate(
      condition,
      history.get(subject.puuid) ?? [],
      subject.key,
    );
    if (rate === undefined) {
      diagnostics.push({ ...base, realizedRate: null, reason: "unmeasured" });
      continue;
    }
    if (rate < 0.4 || rate > 0.7) {
      diagnostics.push({
        ...base,
        realizedRate: rate,
        reason: "outside_target_range",
      });
    }
  }
  return diagnostics;
}

/** Require every filled numeric threshold to land in the intended target band. */
export function numericThresholdsAreMeasured(
  conditions: readonly ParlayCondition[],
  subjects: readonly ParlaySubject[],
  history: ParlayHistory,
): boolean {
  if (subjects[0] === undefined) {
    return false;
  }
  return (
    numericThresholdDiagnostics(conditions, subjects, history).length === 0
  );
}

function conditionSubject(condition: ParlayCondition): string | undefined {
  return condition.kind === "participant_numeric" ||
    condition.kind === "participant_boolean"
    ? condition.subject
    : undefined;
}

function conditionsForSubject(
  conditions: readonly ParlayCondition[],
  subjectKey: string,
  anchorKey: string,
): readonly ParlayCondition[] {
  return conditions.filter((condition) => {
    const subject = conditionSubject(condition);
    return (
      subject === subjectKey ||
      (subject === undefined && subjectKey === anchorKey)
    );
  });
}

function clamp(
  probability: number,
  samples: number,
  method: ParlayPrice["method"],
): ParlayPrice {
  const raw = Math.round(probability * 10_000);
  const bounded = Math.min(MAX_PRICE_BPS, Math.max(MIN_PRICE_BPS, raw));
  return {
    yesProbabilityBps: bounded,
    method,
    samples,
    clamped: bounded !== raw,
  };
}

/**
 * Exact price for a parlay whose participant legs all name one subject.
 *
 * Every leg is a property of the same game, so replaying the whole set over
 * that subject's matches carries the correlation between legs for free. This is
 * the majority case — six of the ten parlays generated so far — and it needs no
 * modelling at all.
 */
function priceByJointReplay(input: {
  conditions: readonly ParlayCondition[];
  matches: readonly ParlayHistoryMatch[];
  subjectKey: string;
}): ParlayPrice | undefined {
  if (input.matches.length < MIN_PRICING_GAMES) {
    return undefined;
  }
  let hits = 0;
  for (const match of input.matches) {
    let all = true;
    for (const condition of input.conditions) {
      const held = conditionHeldInMatch(condition, match, input.subjectKey);
      if (held === undefined) {
        return undefined;
      }
      if (!held) {
        all = false;
        break;
      }
    }
    if (all) {
      hits += 1;
    }
  }
  return clamp(
    hits / input.matches.length,
    input.matches.length,
    "joint_replay",
  );
}

/** Internal grouping key only: "<durationBucket>:<win|loss>". */
type MatchState = string;

function matchState(match: ParlayHistoryMatch): MatchState {
  return [
    durationBucket(match.durationSeconds),
    match.win ? "win" : "loss",
  ].join(":");
}

/** Laplace smoothing, so a thin conditional cell cannot assert 0 or 1. */
function smoothed(hits: number, total: number): number {
  return (hits + 1) / (total + 2);
}

function matchSatisfiesConditions(
  conditions: readonly ParlayCondition[],
  match: ParlayHistoryMatch,
  subjectKey: string,
): boolean | undefined {
  for (const condition of conditions) {
    const held = conditionHeldInMatch(condition, match, subjectKey);
    if (held === undefined) {
      return undefined;
    }
    if (!held) {
      return false;
    }
  }
  return true;
}

function probabilityForSubjectState(input: {
  conditions: readonly ParlayCondition[];
  matches: readonly ParlayHistoryMatch[];
  state: MatchState;
  subjectKey: string;
}): number | undefined {
  const inState = input.matches.filter(
    (match) => matchState(match) === input.state,
  );
  const teamBooleanConditions = input.conditions.filter(
    (condition) => condition.kind === "team_boolean",
  );
  if (teamBooleanConditions.length > 0) {
    const representative = inState[0];
    if (representative === undefined) {
      return undefined;
    }
    const teamBooleanHeld = matchSatisfiesConditions(
      teamBooleanConditions,
      representative,
      input.subjectKey,
    );
    if (teamBooleanHeld === undefined) {
      return undefined;
    }
    if (!teamBooleanHeld) {
      return 0;
    }
  }

  const measuredConditions = input.conditions.filter(
    (condition) => condition.kind !== "team_boolean",
  );
  if (measuredConditions.length === 0) {
    return 1;
  }
  if (inState.length === 0) {
    return undefined;
  }
  let hits = 0;
  for (const match of inState) {
    const held = matchSatisfiesConditions(
      measuredConditions,
      match,
      input.subjectKey,
    );
    if (held === undefined) {
      return undefined;
    }
    if (held) {
      hits += 1;
    }
  }
  return smoothed(hits, inState.length);
}

/**
 * Price for a parlay spanning several subjects.
 *
 * These players rarely share history — the five-stack in the live corpus has
 * exactly one game together across the whole lake — so there is nothing to
 * replay jointly. Each leg is measured against its own subject's games, and the
 * legs are recombined over the state they actually share: how long the game ran
 * and whether the team won. Those are the two drivers that make teammates' stat
 * lines move together, so conditioning on them recovers most of the correlation
 * that a plain independent product throws away.
 */
function priceByConditionalCombination(input: {
  conditions: readonly ParlayCondition[];
  subjects: readonly ParlaySubject[];
  history: ParlayHistory;
}): ParlayPrice | undefined {
  const perSubject = new Map<string, readonly ParlayHistoryMatch[]>();
  for (const subject of input.subjects) {
    const matches = input.history.get(subject.puuid) ?? [];
    if (matches.length < MIN_PRICING_GAMES) {
      return undefined;
    }
    perSubject.set(subject.key, matches);
  }

  const anchor = input.subjects[0];
  if (anchor === undefined) {
    return undefined;
  }
  const anchorMatches = perSubject.get(anchor.key) ?? [];

  // State distribution, averaged across subjects: each plays different games,
  // but the mix of durations and results is a property of how they all play.
  const stateWeights = new Map<MatchState, number>();
  for (const matches of perSubject.values()) {
    const subjectStateWeights = new Map<MatchState, number>();
    for (const match of matches) {
      const state = matchState(match);
      subjectStateWeights.set(state, (subjectStateWeights.get(state) ?? 0) + 1);
    }
    for (const [state, count] of subjectStateWeights) {
      stateWeights.set(
        state,
        (stateWeights.get(state) ?? 0) + count / matches.length,
      );
    }
  }
  if (stateWeights.size === 0) {
    return undefined;
  }

  let probability = 0;
  for (const [state, count] of stateWeights) {
    let joint = count / perSubject.size;
    for (const subject of input.subjects) {
      const conditions = conditionsForSubject(
        input.conditions,
        subject.key,
        anchor.key,
      );
      if (conditions.length === 0) {
        continue;
      }
      const matches = perSubject.get(subject.key);
      if (matches === undefined) {
        return undefined;
      }
      const subjectProbability = probabilityForSubjectState({
        conditions,
        matches,
        state,
        subjectKey: subject.key,
      });
      if (subjectProbability === undefined) {
        return undefined;
      }
      joint *= subjectProbability;
    }
    probability += joint;
  }

  return clamp(probability, anchorMatches.length, "conditional_combination");
}

/**
 * Price a finished parlay against recorded history.
 *
 * Returns undefined when history cannot answer — a leg on a field the lake does
 * not carry, or a subject without enough settled games. Callers must not fall
 * back to a guessed number: publishing an unpriced parlay is the exact failure
 * this replaces.
 */
export function priceParlay(input: {
  conditions: readonly ParlayCondition[];
  subjects: readonly ParlaySubject[];
  history: ParlayHistory;
}): ParlayPrice | undefined {
  if (input.conditions.length === 0 || input.subjects.length === 0) {
    return undefined;
  }
  const named = new Set(
    input.conditions.flatMap((condition) => {
      const subject = conditionSubject(condition);
      return subject === undefined ? [] : [subject];
    }),
  );

  if (named.size <= 1) {
    const subject =
      input.subjects.find((candidate) => named.has(candidate.key)) ??
      input.subjects[0];
    if (subject === undefined) {
      return undefined;
    }
    return priceByJointReplay({
      conditions: input.conditions,
      matches: input.history.get(subject.puuid) ?? [],
      subjectKey: subject.key,
    });
  }

  return priceByConditionalCombination({
    conditions: input.conditions,
    subjects: input.subjects,
    history: input.history,
  });
}
