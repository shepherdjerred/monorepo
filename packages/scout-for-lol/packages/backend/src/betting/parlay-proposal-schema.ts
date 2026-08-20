import { z } from "zod";
import {
  MatchNumericFieldSchema,
  OpponentPingFieldSchema,
  TeamBooleanFieldSchema,
} from "#src/betting/parlay-catalog.ts";
import {
  groundedParticipantFields,
  groundedTeamObjectives,
  PARLAY_HISTORY_COLUMNS,
  TEAM_OBJECTIVE_HISTORY_COLUMNS,
} from "#src/betting/parlay-stat-fields.ts";
import {
  PARLAY_SCHEMA_VERSION,
  type ParlaySubject,
} from "#src/betting/parlay-criteria.ts";

const participantFields = groundedParticipantFields();
const firstParticipantField = participantFields[0];
if (firstParticipantField === undefined) {
  throw new Error("At least one participant field must be groundable");
}
export const GroundedParticipantFieldSchema = z.enum([
  firstParticipantField,
  ...participantFields.slice(1),
]);

const objectives = groundedTeamObjectives();
const firstObjective = objectives[0];
if (firstObjective === undefined) {
  throw new Error("At least one team objective must be groundable");
}
export const GroundedObjectiveSchema = z.enum([
  firstObjective,
  ...objectives.slice(1),
]);
const NumericOperatorSchema = z.enum(["gte", "lte"]);

const ProposalConditionSchema = z.strictObject({
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
  participantNumericField: GroundedParticipantFieldSchema.nullable(),
  team: z.literal("selected").nullable(),
  teamBooleanField: TeamBooleanFieldSchema.nullable(),
  objective: GroundedObjectiveSchema.nullable(),
  operator: NumericOperatorSchema.nullable(),
  expected: z.boolean().nullable(),
  matchNumericField: MatchNumericFieldSchema.nullable(),
  opponentPingField: OpponentPingFieldSchema.nullable(),
});

const ProposalSchema = z.strictObject({
  version: z.literal(PARLAY_SCHEMA_VERSION),
  conditions: z.array(ProposalConditionSchema).min(2).max(6),
});

export type ModelParlayProposal = z.infer<typeof ProposalSchema>;
type ProposalCondition = z.infer<typeof ProposalConditionSchema>;

function targetKey(condition: ProposalCondition): string {
  switch (condition.kind) {
    case "participant_numeric":
      return `${condition.subject ?? "null"}:${condition.participantNumericField ?? "null"}`;
    case "team_boolean":
      return `team:${condition.teamBooleanField ?? "null"}`;
    case "team_objective_kills":
      return `team:${condition.objective ?? "null"}:kills`;
    case "match_numeric":
      return `match:${condition.matchNumericField ?? "null"}`;
    case "opponent_team_pings":
      return `opponent:${condition.opponentPingField ?? "null"}`;
  }
}

function unusedSlots(condition: ProposalCondition): readonly unknown[] {
  switch (condition.kind) {
    case "participant_numeric":
      return [
        condition.team,
        condition.teamBooleanField,
        condition.objective,
        condition.expected,
        condition.matchNumericField,
        condition.opponentPingField,
      ];
    case "team_boolean":
      return [
        condition.subject,
        condition.participantNumericField,
        condition.objective,
        condition.operator,
        condition.matchNumericField,
        condition.opponentPingField,
      ];
    case "team_objective_kills":
      return [
        condition.subject,
        condition.participantNumericField,
        condition.teamBooleanField,
        condition.expected,
        condition.matchNumericField,
        condition.opponentPingField,
      ];
    case "match_numeric":
      return [
        condition.subject,
        condition.participantNumericField,
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
        condition.team,
        condition.teamBooleanField,
        condition.objective,
        condition.expected,
        condition.matchNumericField,
      ];
  }
}

function issue(context: z.RefinementCtx, index: number, message: string): void {
  context.addIssue({ code: "custom", path: ["conditions", index], message });
}

type ValidationInput = {
  condition: ProposalCondition;
  index: number;
  selected: ReadonlySet<string>;
  covered: Set<string>;
  context: z.RefinementCtx;
};

function validateParticipant(input: ValidationInput): void {
  const { condition, index, selected, covered, context } = input;
  if (condition.kind !== "participant_numeric") return;
  if (condition.subject === null || !selected.has(condition.subject)) {
    issue(
      context,
      index,
      `Unknown or unselected subject ${condition.subject ?? "null"}`,
    );
  } else {
    covered.add(condition.subject);
  }
  if (
    condition.participantNumericField === null ||
    condition.operator === null
  ) {
    issue(context, index, "participant_numeric needs a field and an operator");
  } else if (
    PARLAY_HISTORY_COLUMNS[condition.participantNumericField] === null
  ) {
    issue(
      context,
      index,
      `${condition.participantNumericField} has no recorded history and cannot be used`,
    );
  }
}

function validateRequiredFields(input: ValidationInput): void {
  const { condition, index, context } = input;
  switch (condition.kind) {
    case "participant_numeric":
      return;
    case "team_boolean":
      if (
        condition.team !== "selected" ||
        condition.teamBooleanField === null ||
        condition.expected === null
      ) {
        issue(
          context,
          index,
          "team_boolean needs the selected team, a field, and an expected value",
        );
      }
      return;
    case "team_objective_kills":
      if (
        condition.team !== "selected" ||
        condition.objective === null ||
        condition.operator === null
      ) {
        issue(
          context,
          index,
          "team_objective_kills needs the selected team, an objective, and an operator",
        );
      }
      if (
        condition.objective === null ||
        TEAM_OBJECTIVE_HISTORY_COLUMNS[condition.objective] === null
      ) {
        issue(
          context,
          index,
          "team_objective_kills needs an objective with recorded history",
        );
      }
      return;
    case "match_numeric":
      if (condition.matchNumericField === null || condition.operator === null) {
        issue(context, index, "match_numeric needs a field and an operator");
      }
      return;
    case "opponent_team_pings":
      if (condition.opponentPingField === null || condition.operator === null) {
        issue(
          context,
          index,
          "opponent_team_pings needs a field and an operator",
        );
      }
      return;
  }
}

function validateCondition(input: ValidationInput): void {
  validateParticipant(input);
  validateRequiredFields(input);
  if (unusedSlots(input.condition).some((value) => value !== null)) {
    issue(
      input.context,
      input.index,
      `Slots unused by ${input.condition.kind} must be null`,
    );
  }
}

export function parlayProposalSchemaFor(
  subjects: readonly ParlaySubject[],
): z.ZodType<ModelParlayProposal> {
  const selected = new Set(subjects.map((subject) => subject.key));
  return ProposalSchema.superRefine((proposal, context) => {
    const covered = new Set<string>();
    const targets = new Set<string>();
    for (const [index, condition] of proposal.conditions.entries()) {
      const target = targetKey(condition);
      if (targets.has(target)) {
        issue(context, index, `Duplicate or contradictory target ${target}`);
      }
      targets.add(target);
      validateCondition({ condition, index, selected, covered, context });
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
