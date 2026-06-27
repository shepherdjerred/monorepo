// Cost estimation for Codex goal runs. Pricing comes from the central catalog
// (@shepherdjerred/llm-models); if the model isn't in the catalog we still
// surface the raw token counts but skip the price line.
import { costForTextUsage } from "@shepherdjerred/llm-models";

export type TurnUsage = {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
};

export const EMPTY_USAGE: TurnUsage = {
  inputTokens: 0,
  cachedInputTokens: 0,
  outputTokens: 0,
  reasoningOutputTokens: 0,
};

export function addUsage(left: TurnUsage, right: TurnUsage): TurnUsage {
  return {
    inputTokens: left.inputTokens + right.inputTokens,
    cachedInputTokens: left.cachedInputTokens + right.cachedInputTokens,
    outputTokens: left.outputTokens + right.outputTokens,
    reasoningOutputTokens:
      left.reasoningOutputTokens + right.reasoningOutputTokens,
  };
}

// Returns dollars, or null if the model isn't in the catalog (or isn't a text
// model). Reasoning output is billed at the output rate (OpenAI bills reasoning
// as output), so it is folded into outputTokens.
export function computeCost(model: string, usage: TurnUsage): number | null {
  return (
    costForTextUsage(model, {
      inputTokens: usage.inputTokens,
      cachedInputTokens: usage.cachedInputTokens,
      outputTokens: usage.outputTokens + usage.reasoningOutputTokens,
    }) ?? null
  );
}

// Renders the trailing line(s) appended to the final Discord report.
// Always includes a token-count line; includes a cost line when we have a rate.
export function formatCostLine(
  model: string,
  cost: number | null,
  usage: TurnUsage,
): string {
  const totalIn = usage.inputTokens;
  const totalOut = usage.outputTokens + usage.reasoningOutputTokens;
  const tokens = `Tokens: ${totalIn.toLocaleString("en-US")} in / ${totalOut.toLocaleString("en-US")} out`;
  if (cost === null) {
    return `${tokens} (no list price on file for ${model})`;
  }
  return `Cost: ${formatDollars(cost)} (${tokens})`;
}

function formatDollars(cost: number): string {
  // Sub-cent values get more precision so a $0.0023 run isn't reported as $0.00.
  if (cost < 0.01) {
    return `$${cost.toFixed(4)}`;
  }
  return `$${cost.toFixed(2)}`;
}
