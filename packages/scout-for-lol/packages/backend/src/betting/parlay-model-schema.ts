import { z } from "zod";
import {
  MatchNumericFieldSchema,
  OpponentPingFieldSchema,
  ParticipantBooleanFieldSchema,
  TeamBooleanFieldSchema,
} from "#src/betting/parlay-catalog.ts";
import {
  GeneratedParlaySchema,
  PARLAY_SCHEMA_VERSION,
  parlaySemanticIssues,
  type GeneratedParlay,
  type ParlaySubject,
} from "#src/betting/parlay-criteria.ts";
import {
  GroundedObjectiveSchema,
  GroundedParticipantFieldSchema,
  parlayProposalSchemaFor as buildParlayProposalSchema,
} from "#src/betting/parlay-proposal-schema.ts";
export type ModelParlayProposal = ModelParlayProposalFromSchema;
import type { ModelParlayProposal as ModelParlayProposalFromSchema } from "#src/betting/parlay-proposal-schema.ts";

// Equality remains valid for stored definitions, but generation has no
// equality-specific measured distribution from which to choose a threshold.
const NumericOperatorSchema = z.enum(["gte", "lte"]);

const GroundedParticipantNumericFieldSchema = GroundedParticipantFieldSchema;
const GroundedTeamObjectiveSchema = GroundedObjectiveSchema;

export function parlayProposalSchemaFor(
  subjects: readonly ParlaySubject[],
): z.ZodType<ModelParlayProposal> {
  return buildParlayProposalSchema(subjects);
}

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
  participantNumericField: GroundedParticipantNumericFieldSchema.nullable(),
  participantBooleanField: ParticipantBooleanFieldSchema.nullable(),
  team: z.literal("selected").nullable(),
  teamBooleanField: TeamBooleanFieldSchema.nullable(),
  objective: GroundedTeamObjectiveSchema.nullable(),
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

type ModelParlayCondition = z.infer<typeof ModelParlayConditionSchema>;
type ModelGeneratedParlay = z.infer<typeof ModelGeneratedParlaySchema>;

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
  participantBooleanField?: string | null;
  team?: string | null;
  teamBooleanField: string | null;
  objective: string | null;
  operator: string | null;
  expected?: boolean | null;
  matchNumericField: string | null;
  opponentPingField: string | null;
}): string {
  return [
    condition.kind,
    condition.subject,
    condition.participantNumericField,
    condition.participantBooleanField ?? null,
    condition.team ?? null,
    condition.teamBooleanField,
    condition.objective,
    condition.operator,
    condition.expected ?? null,
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
