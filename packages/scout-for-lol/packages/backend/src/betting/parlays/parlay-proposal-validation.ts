export type ProposalCondition = {
  kind:
    | "participant_numeric"
    | "team_boolean"
    | "team_objective_kills"
    | "match_numeric"
    | "opponent_team_pings";
  subject: string | null;
  participantNumericField: string | null;
  team: "selected" | null;
  teamBooleanField: string | null;
  objective: string | null;
  operator: string | null;
  expected: boolean | null;
  matchNumericField: string | null;
  opponentPingField: string | null;
};

function hasMissingRequiredProposalSlot(condition: ProposalCondition): boolean {
  switch (condition.kind) {
    case "participant_numeric":
      return (
        condition.subject === null ||
        condition.participantNumericField === null ||
        condition.operator === null
      );
    case "team_boolean":
      return (
        condition.team === null ||
        condition.teamBooleanField === null ||
        condition.expected === null
      );
    case "team_objective_kills":
      return (
        condition.team === null ||
        condition.objective === null ||
        condition.operator === null
      );
    case "match_numeric":
      return (
        condition.matchNumericField === null || condition.operator === null
      );
    case "opponent_team_pings":
      return (
        condition.opponentPingField === null || condition.operator === null
      );
  }
}

function unusedProposalSlots(condition: ProposalCondition): readonly unknown[] {
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

function proposalTargetKey(condition: ProposalCondition): string | undefined {
  if (hasMissingRequiredProposalSlot(condition)) {
    return;
  }
  switch (condition.kind) {
    case "participant_numeric":
      return [
        condition.kind,
        condition.subject,
        condition.participantNumericField,
      ]
        .map((value) => value?.toString() ?? "")
        .join(":");
    case "team_boolean":
      return [condition.kind, condition.team, condition.teamBooleanField]
        .map((value) => value?.toString() ?? "")
        .join(":");
    case "team_objective_kills":
      return [condition.kind, condition.team, condition.objective]
        .map((value) => value?.toString() ?? "")
        .join(":");
    case "match_numeric":
      return [condition.kind, condition.matchNumericField]
        .map((value) => value?.toString() ?? "")
        .join(":");
    case "opponent_team_pings":
      return [condition.kind, condition.opponentPingField]
        .map((value) => value?.toString() ?? "")
        .join(":");
  }
}

export function proposalConditionIssues(
  condition: ProposalCondition,
  targets: Set<string>,
): string[] {
  const issues: string[] = [];
  if (hasMissingRequiredProposalSlot(condition)) {
    issues.push(`${condition.kind} is missing a required field`);
  }
  if (unusedProposalSlots(condition).some((value) => value !== null)) {
    issues.push(`Slots unused by ${condition.kind} must be null`);
  }
  const target = proposalTargetKey(condition);
  if (target !== undefined) {
    if (targets.has(target)) {
      issues.push(`Duplicate parlay target ${target}`);
    }
    targets.add(target);
  }
  return issues;
}
