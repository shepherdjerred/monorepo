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
  GeneratedParlaySchema,
  PARLAY_SCHEMA_VERSION,
  parlaySemanticIssues,
  type GeneratedParlay,
  type ParlaySubject,
} from "#src/betting/parlay-criteria.ts";

const NumericOperatorSchema = z.enum(["gte", "lte", "eq"]);

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

const ModelGeneratedParlaySchema = z.strictObject({
  version: z.literal(PARLAY_SCHEMA_VERSION),
  yesProbabilityBps: z.number().int().min(1000).max(9000),
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

function canonicalCandidate(input: ModelGeneratedParlay): unknown {
  return {
    version: input.version,
    yesProbabilityBps: input.yesProbabilityBps,
    conditions: input.conditions.map((condition) =>
      canonicalConditionCandidate(condition),
    ),
  };
}

export function parseModelGeneratedParlay(
  input: ModelGeneratedParlay,
): GeneratedParlay {
  return GeneratedParlaySchema.parse(canonicalCandidate(input));
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
      canonicalCandidate(modelParlay),
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
