import type {
  DareActivationV3,
  DareSqlV3Compilation,
} from "@scout-for-lol/data";
import { divisionToString } from "@scout-for-lol/data";

function describeActivation(activation: DareActivationV3): string {
  if (activation.kind === "immediate") return "Activation: immediate.";
  if (activation.kind === "rank") {
    const goal =
      activation.goal.kind === "reach"
        ? `reach ${activation.goal.tier} ${divisionToString(activation.goal.division)}${activation.goal.lp === undefined ? "" : ` at ${activation.goal.lp.toString()} LP`}`
        : `gain ${activation.goal.normalizedLp.toString()} normalized LP`;
    return `Activation: ${activation.queue} rank; ${goal}. The rank snapshot is frozen before eligibility starts.`;
  }
  const window =
    activation.window.kind === "last_games"
      ? `last ${activation.window.count.toString()} eligible games`
      : `last ${activation.window.days.toString()} eligible days`;
  const goal =
    activation.goal.kind === "personal_best"
      ? "beat the personal best"
      : activation.goal.kind === "absolute"
        ? `improve by ${activation.goal.delta.toString()}`
        : `improve by ${activation.goal.percent.toString()}%`;
  return `Activation: improvement for ${activation.targetKey} using ${activation.aggregation} (${activation.direction}); baseline is ${window}; goal is to ${goal}.`;
}

export function renderDareSqlV3SemanticProofPlan(
  compilation: DareSqlV3Compilation,
): string {
  const competition =
    compilation.competition.kind === "standard"
      ? "Competition: standard."
      : `Competition: race; lanes are ${compilation.competition.lanes.map((lane) => `${lane.targetKey} → ${lane.gameSet}`).join(", ")}. The earliest qualifying game wins; timestamp ties split the pot deterministically.`;
  return `The canonical SQL is binding and executes over normalized report-lake relations. ${competition} ${describeActivation(compilation.activation)}`;
}
