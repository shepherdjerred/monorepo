import { z } from "zod";
import {
  LeaguePuuidSchema,
  RiotTeamIdSchema,
  type BucksPoolParticipant,
} from "@scout-for-lol/data";
import {
  MATCH_NUMERIC_CATALOG,
  MatchNumericFieldSchema,
  PARTICIPANT_BOOLEAN_CATALOG,
  PARTICIPANT_NUMERIC_CATALOG,
  ParticipantBooleanFieldSchema,
  ParticipantNumericFieldSchema,
  TEAM_BOOLEAN_CATALOG,
  TEAM_OBJECTIVE_CATALOG,
  TeamBooleanFieldSchema,
  TeamObjectiveSchema,
} from "#src/betting/parlay-catalog.ts";

export const PARLAY_SCHEMA_VERSION = 1;
export const PARLAY_CATALOG_VERSION = "2026-08-18";
export const PARLAY_EVALUATOR_VERSION = "1";
export const PARLAY_SUBJECT_ALIAS_MAX_LENGTH = 100;

const NumericOperatorSchema = z.enum(["gte", "lte", "eq"]);
const SelectedTeamSchema = z.literal("selected");

const ParticipantNumericConditionSchema = z.strictObject({
  kind: z.literal("participant_numeric"),
  subject: z.string().regex(/^P[1-5]$/),
  field: ParticipantNumericFieldSchema,
  operator: NumericOperatorSchema,
  threshold: z.number().int().nonnegative(),
});

const ParticipantBooleanConditionSchema = z.strictObject({
  kind: z.literal("participant_boolean"),
  subject: z.string().regex(/^P[1-5]$/),
  field: ParticipantBooleanFieldSchema,
  expected: z.boolean(),
});

const TeamBooleanConditionSchema = z.strictObject({
  kind: z.literal("team_boolean"),
  team: SelectedTeamSchema,
  field: TeamBooleanFieldSchema,
  expected: z.boolean(),
});

const TeamObjectiveFirstConditionSchema = z.strictObject({
  kind: z.literal("team_objective_first"),
  team: SelectedTeamSchema,
  objective: TeamObjectiveSchema,
  expected: z.boolean(),
});

const TeamObjectiveKillsConditionSchema = z.strictObject({
  kind: z.literal("team_objective_kills"),
  team: SelectedTeamSchema,
  objective: TeamObjectiveSchema,
  operator: NumericOperatorSchema,
  threshold: z.number().int().nonnegative(),
});

const MatchNumericConditionSchema = z.strictObject({
  kind: z.literal("match_numeric"),
  field: MatchNumericFieldSchema,
  operator: NumericOperatorSchema,
  threshold: z.number().int().nonnegative(),
});

export const ParlayConditionSchema = z.discriminatedUnion("kind", [
  ParticipantNumericConditionSchema,
  ParticipantBooleanConditionSchema,
  TeamBooleanConditionSchema,
  TeamObjectiveFirstConditionSchema,
  TeamObjectiveKillsConditionSchema,
  MatchNumericConditionSchema,
]);

export type ParlayCondition = z.infer<typeof ParlayConditionSchema>;

export const GeneratedParlaySchema = z.strictObject({
  version: z.literal(PARLAY_SCHEMA_VERSION),
  yesProbabilityBps: z.number().int().min(1000).max(9000),
  conditions: z.array(ParlayConditionSchema).min(2).max(6),
});

export type GeneratedParlay = z.infer<typeof GeneratedParlaySchema>;

export const ParlaySubjectSchema = z.strictObject({
  key: z.string().regex(/^P[1-5]$/),
  puuid: LeaguePuuidSchema,
  alias: z.string().min(1).max(PARLAY_SUBJECT_ALIAS_MAX_LENGTH),
});

export type ParlaySubject = z.infer<typeof ParlaySubjectSchema>;

export const ParlaySubjectsSchema = z.array(ParlaySubjectSchema).min(1).max(5);

export type SelectedParlayTeam = {
  teamId: ReturnType<typeof RiotTeamIdSchema.parse>;
  subjects: ParlaySubject[];
};

/** Select the tracked side by count, breaking a tie on the first tracked
 * participant in the frozen spectator roster. */
export function selectParlayTeam(
  roster: readonly BucksPoolParticipant[],
): SelectedParlayTeam | undefined {
  const tracked = roster.filter(
    (participant) =>
      participant.trackedAlias !== undefined && participant.puuid !== null,
  );
  const first = tracked[0];
  if (first === undefined) {
    return;
  }
  const blueCount = tracked.filter(
    (participant) => participant.teamId === 100,
  ).length;
  const redCount = tracked.length - blueCount;
  const teamId =
    blueCount === redCount ? first.teamId : blueCount > redCount ? 100 : 200;
  const selected = tracked.filter(
    (participant) => participant.teamId === teamId,
  );
  const subjects = selected.map((participant, index) =>
    ParlaySubjectSchema.parse({
      key: `P${(index + 1).toString()}`,
      puuid: participant.puuid,
      alias: participant.trackedAlias,
    }),
  );
  return { teamId: RiotTeamIdSchema.parse(teamId), subjects };
}

function conditionTargetKey(condition: ParlayCondition): string {
  switch (condition.kind) {
    case "participant_numeric":
    case "participant_boolean":
      return `${condition.subject}:${condition.field}`;
    case "team_boolean":
      return `team:${condition.field}`;
    case "team_objective_first":
      return `team:${condition.objective}:first`;
    case "team_objective_kills":
      return `team:${condition.objective}:kills`;
    case "match_numeric":
      return `match:${condition.field}`;
  }
}

function thresholdIssue(condition: ParlayCondition): string | undefined {
  if (condition.kind === "participant_numeric") {
    const entry = PARTICIPANT_NUMERIC_CATALOG[condition.field];
    return condition.threshold < entry.thresholdMin ||
      condition.threshold > entry.thresholdMax
      ? `${condition.field} threshold must be ${entry.thresholdMin.toString()}-${entry.thresholdMax.toString()}`
      : undefined;
  }
  if (condition.kind === "team_objective_kills") {
    const entry = TEAM_OBJECTIVE_CATALOG[condition.objective];
    return condition.threshold < entry.thresholdMin ||
      condition.threshold > entry.thresholdMax
      ? `${condition.objective} threshold must be ${entry.thresholdMin.toString()}-${entry.thresholdMax.toString()}`
      : undefined;
  }
  if (condition.kind === "match_numeric") {
    const entry = MATCH_NUMERIC_CATALOG[condition.field];
    return condition.threshold < entry.thresholdMin ||
      condition.threshold > entry.thresholdMax
      ? `${condition.field} threshold must be ${entry.thresholdMin.toString()}-${entry.thresholdMax.toString()}`
      : undefined;
  }
  return;
}

function logicalContradictionIssues(parlay: GeneratedParlay): string[] {
  const issues: string[] = [];
  const winExpectations = new Set(
    parlay.conditions.flatMap((condition) => {
      if (condition.kind === "team_boolean") {
        return [condition.expected];
      }
      if (
        condition.kind === "participant_boolean" &&
        condition.field === "win"
      ) {
        return [condition.expected];
      }
      return [];
    }),
  );
  if (winExpectations.size > 1) {
    issues.push("Selected-team and participant win conditions contradict");
  }

  for (const field of ["firstBloodKill", "firstTowerKill"] as const) {
    const positiveSubjects = new Set(
      parlay.conditions.flatMap((condition) =>
        condition.kind === "participant_boolean" &&
        condition.field === field &&
        condition.expected
          ? [condition.subject]
          : [],
      ),
    );
    if (positiveSubjects.size > 1) {
      issues.push(`Only one selected subject can satisfy ${field}`);
    }
  }

  for (const objective of TeamObjectiveSchema.options) {
    const first = parlay.conditions.find(
      (condition) =>
        condition.kind === "team_objective_first" &&
        condition.objective === objective,
    );
    const kills = parlay.conditions.find(
      (condition) =>
        condition.kind === "team_objective_kills" &&
        condition.objective === objective,
    );
    if (
      first?.kind === "team_objective_first" &&
      first.expected &&
      kills?.kind === "team_objective_kills" &&
      kills.threshold === 0 &&
      (kills.operator === "eq" || kills.operator === "lte")
    ) {
      issues.push(`First ${objective} contradicts zero ${objective} kills`);
    }
  }
  return issues;
}

export function parlaySemanticIssues(
  parlay: GeneratedParlay,
  subjects: readonly ParlaySubject[],
): string[] {
  const issues: string[] = [];
  const selectedKeys = new Set(subjects.map((subject) => subject.key));
  const covered = new Set<string>();
  const targets = new Set<string>();

  for (const condition of parlay.conditions) {
    if (
      (condition.kind === "participant_numeric" ||
        condition.kind === "participant_boolean") &&
      !selectedKeys.has(condition.subject)
    ) {
      issues.push(`Unknown or unselected subject ${condition.subject}`);
    }
    if (
      condition.kind === "participant_numeric" ||
      condition.kind === "participant_boolean"
    ) {
      covered.add(condition.subject);
    }
    const target = conditionTargetKey(condition);
    if (targets.has(target)) {
      issues.push(`Duplicate or contradictory target ${target}`);
    }
    targets.add(target);
    const threshold = thresholdIssue(condition);
    if (threshold !== undefined) {
      issues.push(threshold);
    }
  }

  for (const subject of subjects) {
    if (!covered.has(subject.key)) {
      issues.push(
        `Selected subject ${subject.key} must appear in a participant condition`,
      );
    }
  }
  return [...issues, ...logicalContradictionIssues(parlay)];
}

function numericPhrase(operator: "gte" | "lte" | "eq", threshold: number) {
  const comparison =
    operator === "gte"
      ? "at least"
      : operator === "lte"
        ? "at most"
        : "exactly";
  return `${comparison} ${threshold.toString()}`;
}

function subjectAlias(subjects: readonly ParlaySubject[], key: string): string {
  return subjects.find((subject) => subject.key === key)?.alias ?? key;
}

export function renderParlayCondition(
  condition: ParlayCondition,
  subjects: readonly ParlaySubject[],
): string {
  switch (condition.kind) {
    case "participant_numeric":
      return `${subjectAlias(subjects, condition.subject)} gets ${numericPhrase(condition.operator, condition.threshold)} ${PARTICIPANT_NUMERIC_CATALOG[condition.field].label}`;
    case "participant_boolean": {
      const name = subjectAlias(subjects, condition.subject);
      const field = PARTICIPANT_BOOLEAN_CATALOG[condition.field].label;
      return condition.expected ? `${name}: ${field}` : `${name}: not ${field}`;
    }
    case "team_boolean":
      return condition.expected
        ? `Their team ${TEAM_BOOLEAN_CATALOG[condition.field].label}`
        : `Their team does not ${TEAM_BOOLEAN_CATALOG[condition.field].label}`;
    case "team_objective_first": {
      const objective = TEAM_OBJECTIVE_CATALOG[condition.objective].label;
      return condition.expected
        ? `Their team gets first ${objective}`
        : `Their team does not get first ${objective}`;
    }
    case "team_objective_kills":
      return `Their team gets ${numericPhrase(condition.operator, condition.threshold)} ${TEAM_OBJECTIVE_CATALOG[condition.objective].label}${condition.threshold === 1 ? "" : "s"}`;
    case "match_numeric":
      return `The ${MATCH_NUMERIC_CATALOG[condition.field].label} is ${numericPhrase(condition.operator, condition.threshold)}`;
  }
}

export function renderParlay(
  parlay: GeneratedParlay,
  subjects: readonly ParlaySubject[],
): string[] {
  return parlay.conditions.map((condition) =>
    renderParlayCondition(condition, subjects),
  );
}
