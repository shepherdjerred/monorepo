import { z } from "zod";
import {
  MatchNumericFieldSchema,
  OpponentPingFieldSchema,
  ParticipantBooleanFieldSchema,
  ParticipantNumericFieldSchema,
  TeamBooleanFieldSchema,
  TeamObjectiveSchema,
} from "#src/betting/parlay-catalog.ts";
import {
  PARLAY_HISTORY_COLUMNS,
  TEAM_OBJECTIVE_HISTORY_COLUMNS,
} from "#src/betting/parlay-stat-fields.ts";
import {
  candidateTargetKey,
  ParlayCandidateTargetSchema,
  type ParlayCandidateTarget,
  type ParlayShortlist,
} from "#src/betting/parlay-shortlist.ts";
import { proposalConditionIssues } from "#src/betting/parlay-proposal-validation.ts";
import {
  GeneratedParlaySchema,
  PARLAY_SCHEMA_VERSION,
  parlaySemanticIssues,
  type GeneratedParlay,
  type ParlaySubject,
} from "#src/betting/parlay-criteria.ts";

const NumericOperatorSchema = z.enum(["gte", "lte", "eq"]);
const ProposalNumericOperatorSchema = z.enum(["gte", "lte"]);

// OpenAI strict structured outputs reject `oneOf`, which Zod emits for the
// canonical discriminated union. Present the model with one closed shape and
// normalize it into the immutable storage/evaluator contract after validation.
const ModelParlayConditionSchema = z.strictObject({
  kind: z.enum([
    "participant_numeric",
    "participant_boolean",
    "team_boolean",
    "team_objective_first",
    "team_objective_kills",
    "match_numeric",
    "opponent_team_pings",
  ]),
  subject: z
    .string()
    .regex(/^P[1-5]$/)
    .nullable(),
  participantNumericField: ParticipantNumericFieldSchema.nullable(),
  participantBooleanField: ParticipantBooleanFieldSchema.nullable(),
  team: z.literal("selected").nullable(),
  teamBooleanField: TeamBooleanFieldSchema.nullable(),
  objective: TeamObjectiveSchema.nullable(),
  operator: NumericOperatorSchema.nullable(),
  threshold: z.number().int().nonnegative().nullable(),
  expected: z.boolean().nullable(),
  matchNumericField: MatchNumericFieldSchema.nullable(),
  opponentPingField: OpponentPingFieldSchema.nullable(),
});

/**
 * Pass two: the same legs, now carrying thresholds.
 *
 * `yesProbabilityBps` is deliberately absent. The model no longer authors the
 * price at all - the harness measures it from the same history the thresholds
 * were chosen against, so there is nothing here for the model to assert about
 * odds.
 */
const ModelGeneratedParlaySchema = z.strictObject({
  version: z.literal(PARLAY_SCHEMA_VERSION),
  conditions: z.array(ModelParlayConditionSchema).min(2).max(6),
});

/**
 * Pass one: which legs, with no numbers.
 *
 * Only kinds history can price are offered. Participant booleans and
 * first-objective flags are not reconstructable from lake columns, so proposing
 * one could only lead to a parlay thrown away after two model calls.
 */
const ModelParlayProposalConditionSchema = z.strictObject({
  kind: z.enum([
    "participant_numeric",
    "team_boolean",
    "team_objective_kills",
    "match_numeric",
    "opponent_team_pings",
  ]),
  subject: z
    .string()
    .regex(/^P[1-5]$/)
    .nullable(),
  participantNumericField: ParticipantNumericFieldSchema.nullable(),
  team: z.literal("selected").nullable(),
  teamBooleanField: TeamBooleanFieldSchema.nullable(),
  objective: TeamObjectiveSchema.nullable(),
  operator: ProposalNumericOperatorSchema.nullable(),
  expected: z.boolean().nullable(),
  matchNumericField: MatchNumericFieldSchema.nullable(),
  opponentPingField: OpponentPingFieldSchema.nullable(),
});

const ModelParlayProposalSchema = z.strictObject({
  version: z.literal(PARLAY_SCHEMA_VERSION),
  conditions: z.array(ModelParlayProposalConditionSchema).min(2).max(6),
});

export type ModelParlayProposal = z.infer<typeof ModelParlayProposalSchema>;
type ModelParlayProposalCondition = ModelParlayProposal["conditions"][number];

type ModelParlayCondition = z.infer<typeof ModelParlayConditionSchema>;
type ModelGeneratedParlay = z.infer<typeof ModelGeneratedParlaySchema>;

function proposalCandidateTarget(
  condition: ModelParlayProposalCondition,
): ParlayCandidateTarget | undefined {
  let candidate: unknown;
  switch (condition.kind) {
    case "participant_numeric":
      candidate = {
        kind: condition.kind,
        subject: condition.subject,
        participantNumericField: condition.participantNumericField,
      };
      break;
    case "team_boolean":
      candidate = {
        kind: condition.kind,
        team: condition.team,
        teamBooleanField: condition.teamBooleanField,
      };
      break;
    case "team_objective_kills":
      candidate = {
        kind: condition.kind,
        team: condition.team,
        objective: condition.objective,
      };
      break;
    case "match_numeric":
      candidate = {
        kind: condition.kind,
        matchNumericField: condition.matchNumericField,
      };
      break;
    case "opponent_team_pings":
      candidate = {
        kind: condition.kind,
        opponentPingField: condition.opponentPingField,
      };
      break;
  }
  const result = ParlayCandidateTargetSchema.safeParse(candidate);
  return result.success ? result.data : undefined;
}

function shortlistConditionIssues(
  condition: ModelParlayProposalCondition,
  allowedTargets: ReadonlySet<string>,
): string[] {
  const target = proposalCandidateTarget(condition);
  return target !== undefined && allowedTargets.has(candidateTargetKey(target))
    ? []
    : ["Condition target is not in the match shortlist"];
}

function canonicalConditionCandidate(condition: ModelParlayCondition): unknown {
  switch (condition.kind) {
    case "participant_numeric":
      return {
        kind: condition.kind,
        subject: condition.subject,
        field: condition.participantNumericField,
        operator: condition.operator,
        threshold: condition.threshold,
      };
    case "participant_boolean":
      return {
        kind: condition.kind,
        subject: condition.subject,
        field: condition.participantBooleanField,
        expected: condition.expected,
      };
    case "team_boolean":
      return {
        kind: condition.kind,
        team: condition.team,
        field: condition.teamBooleanField,
        expected: condition.expected,
      };
    case "team_objective_first":
      return {
        kind: condition.kind,
        team: condition.team,
        objective: condition.objective,
        expected: condition.expected,
      };
    case "team_objective_kills":
      return {
        kind: condition.kind,
        team: condition.team,
        objective: condition.objective,
        operator: condition.operator,
        threshold: condition.threshold,
      };
    case "match_numeric":
      return {
        kind: condition.kind,
        field: condition.matchNumericField,
        operator: condition.operator,
        threshold: condition.threshold,
      };
    case "opponent_team_pings":
      return {
        kind: condition.kind,
        field: condition.opponentPingField,
        operator: condition.operator,
        threshold: condition.threshold,
      };
  }
}

function unusedSlots(condition: ModelParlayCondition): readonly unknown[] {
  switch (condition.kind) {
    case "participant_numeric":
      return [
        condition.participantBooleanField,
        condition.team,
        condition.teamBooleanField,
        condition.objective,
        condition.expected,
        condition.matchNumericField,
      ];
    case "participant_boolean":
      return [
        condition.participantNumericField,
        condition.team,
        condition.teamBooleanField,
        condition.objective,
        condition.operator,
        condition.threshold,
        condition.matchNumericField,
      ];
    case "team_boolean":
      return [
        condition.subject,
        condition.participantNumericField,
        condition.participantBooleanField,
        condition.objective,
        condition.operator,
        condition.threshold,
        condition.matchNumericField,
      ];
    case "team_objective_first":
      return [
        condition.subject,
        condition.participantNumericField,
        condition.participantBooleanField,
        condition.teamBooleanField,
        condition.operator,
        condition.threshold,
        condition.matchNumericField,
      ];
    case "team_objective_kills":
      return [
        condition.subject,
        condition.participantNumericField,
        condition.participantBooleanField,
        condition.teamBooleanField,
        condition.expected,
        condition.matchNumericField,
      ];
    case "match_numeric":
      return [
        condition.subject,
        condition.participantNumericField,
        condition.participantBooleanField,
        condition.team,
        condition.teamBooleanField,
        condition.objective,
        condition.expected,
        condition.opponentPingField,
      ];
    case "opponent_team_pings":
      return [
        condition.subject,
        condition.participantNumericField,
        condition.participantBooleanField,
        condition.team,
        condition.teamBooleanField,
        condition.objective,
        condition.expected,
        condition.matchNumericField,
      ];
  }
}

function canonicalCandidate(
  input: ModelGeneratedParlay,
  yesProbabilityBps: number,
): unknown {
  return {
    version: input.version,
    yesProbabilityBps,
    conditions: input.conditions.map((condition) =>
      canonicalConditionCandidate(condition),
    ),
  };
}

/** The leg shape pass two must not change: everything except the number. */
function proposalShape(condition: {
  kind: string;
  subject: string | null;
  participantNumericField: string | null;
  team: "selected" | null;
  teamBooleanField: string | null;
  objective: string | null;
  operator: string | null;
  expected: boolean | null;
  matchNumericField: string | null;
  opponentPingField: string | null;
}): string {
  return [
    condition.kind,
    condition.subject,
    condition.participantNumericField,
    condition.team,
    condition.teamBooleanField,
    condition.objective,
    condition.operator,
    condition.expected,
    condition.matchNumericField,
    condition.opponentPingField,
  ].join("|");
}

/**
 * Whether pass two returned the legs pass one proposed.
 *
 * Pass two exists to choose numbers against measured distributions. A model
 * that also swapped a field or a subject would be choosing thresholds for legs
 * whose statistics it was never shown, which is exactly the failure the
 * two-pass split exists to remove.
 */
export function thresholdsMatchProposal(
  proposal: ModelParlayProposal,
  filled: ModelGeneratedParlay,
): boolean {
  if (proposal.conditions.length !== filled.conditions.length) {
    return false;
  }
  return proposal.conditions.every((condition, index) => {
    const other = filled.conditions[index];
    return (
      other !== undefined && proposalShape(condition) === proposalShape(other)
    );
  });
}

export function parseModelGeneratedParlay(
  input: ModelGeneratedParlay,
  yesProbabilityBps: number,
): GeneratedParlay {
  return GeneratedParlaySchema.parse(
    canonicalCandidate(input, yesProbabilityBps),
  );
}

/** Semantic issues participate in generateValidatedObject's bounded retries. */
export function generatedParlaySchemaFor(
  subjects: readonly ParlaySubject[],
): z.ZodType<ModelGeneratedParlay> {
  return ModelGeneratedParlaySchema.superRefine((modelParlay, context) => {
    for (const [index, condition] of modelParlay.conditions.entries()) {
      if (unusedSlots(condition).some((value) => value !== null)) {
        context.addIssue({
          code: "custom",
          path: ["conditions", index],
          message: `Slots unused by ${condition.kind} must be null`,
        });
      }
    }
    const result = GeneratedParlaySchema.safeParse(
      // The price is measured after this call; any in-range value validates the
      // same leg shapes, so a placeholder keeps this a pure shape check.
      canonicalCandidate(modelParlay, 5000),
    );
    if (!result.success) {
      for (const issue of result.error.issues) {
        context.addIssue({
          code: "custom",
          path: issue.path,
          message: issue.message,
        });
      }
      return;
    }
    for (const issue of parlaySemanticIssues(result.data, subjects)) {
      context.addIssue({ code: "custom", message: issue });
    }
  });
}

/** Pass-one schema: legs only, restricted to subjects actually in this game. */
export function parlayProposalSchemaFor(
  subjects: readonly ParlaySubject[],
  shortlist: ParlayShortlist,
): z.ZodType<ModelParlayProposal> {
  const selected = new Set(subjects.map((subject) => subject.key));
  const allowedTargets = new Set(
    shortlist.candidates.map((candidate) => candidateTargetKey(candidate)),
  );
  return ModelParlayProposalSchema.superRefine((proposal, context) => {
    const covered = new Set<string>();
    const targets = new Set<string>();
    for (const [index, condition] of proposal.conditions.entries()) {
      for (const message of [
        ...proposalConditionIssues(condition, targets),
        ...shortlistConditionIssues(condition, allowedTargets),
      ]) {
        context.addIssue({
          code: "custom",
          path: ["conditions", index],
          message,
        });
      }
      if (condition.kind === "participant_numeric") {
        if (condition.subject === null || !selected.has(condition.subject)) {
          context.addIssue({
            code: "custom",
            path: ["conditions", index],
            message: `Unknown or unselected subject ${condition.subject ?? "null"}`,
          });
        } else {
          covered.add(condition.subject);
        }
        if (
          condition.participantNumericField === null ||
          condition.operator === null
        ) {
          context.addIssue({
            code: "custom",
            path: ["conditions", index],
            message: "participant_numeric needs a field and an operator",
          });
        } else if (
          PARLAY_HISTORY_COLUMNS[condition.participantNumericField] === null
        ) {
          // Refuse here rather than after the second call: an ungroundable
          // target cannot be priced, so proposing one can only end in a parlay
          // thrown away having spent both model calls.
          context.addIssue({
            code: "custom",
            path: ["conditions", index],
            message: `${condition.participantNumericField} has no recorded history and cannot be used`,
          });
        }
      }
      if (
        condition.kind === "team_objective_kills" &&
        (condition.objective === null ||
          TEAM_OBJECTIVE_HISTORY_COLUMNS[condition.objective] === null ||
          condition.operator === null)
      ) {
        context.addIssue({
          code: "custom",
          path: ["conditions", index],
          message:
            "team_objective_kills needs an operator and an objective with recorded history (riftHerald has none)",
        });
      }
      if (
        condition.kind === "opponent_team_pings" &&
        (condition.opponentPingField === null || condition.operator === null)
      ) {
        context.addIssue({
          code: "custom",
          path: ["conditions", index],
          message: "opponent_team_pings needs a field and an operator",
        });
      }
    }
    for (const subject of subjects) {
      if (!covered.has(subject.key)) {
        context.addIssue({
          code: "custom",
          message: `Selected subject ${subject.key} must appear in a participant condition`,
        });
      }
    }
  });
}
