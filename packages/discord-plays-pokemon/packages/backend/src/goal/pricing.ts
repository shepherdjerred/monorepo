// Cost estimation for Codex goal runs. Rates are matched against the configured
// `[game.goal] model` string; if there's no rate for the model we still surface the
// raw token counts but skip the price line. Update MODEL_RATES when OpenAI list
// prices change. Cross-check: packages/scout-for-lol/packages/data/src/review/models.ts.

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

type ModelRate = {
  // Dollars per 1M tokens.
  input: number;
  cachedInput: number;
  output: number;
};

// OpenAI's published cached-input discount for gpt-5 family is ~10% of the base
// input rate. No public list price for nano-specific cache rate yet; we use the
// same 10% rule until we see one.
// Partial<Record<...>> so indexing with an unknown model returns ModelRate | undefined.
const MODEL_RATES: Partial<Record<string, ModelRate>> = {
  "gpt-5.4-nano": { input: 0.2, cachedInput: 0.02, output: 1.25 },
  "gpt-5.4-mini": { input: 0.75, cachedInput: 0.075, output: 4.5 },
  "gpt-5.4": { input: 2.5, cachedInput: 0.25, output: 15 },
  "gpt-5.5": { input: 5, cachedInput: 0.5, output: 30 },
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

// Returns dollars, or null if we don't have a rate for this model.
// Cached-input tokens are billed at the cached rate; the remaining input
// tokens (raw - cached) are billed at the full input rate. Output and
// reasoning output share the same rate (OpenAI bills reasoning as output).
export function computeCost(model: string, usage: TurnUsage): number | null {
  const rate = MODEL_RATES[model];
  if (rate === undefined) {
    return null;
  }

  const uncachedInputTokens = Math.max(
    0,
    usage.inputTokens - usage.cachedInputTokens,
  );
  const billedOutputTokens = usage.outputTokens + usage.reasoningOutputTokens;
  const perMillion = 1_000_000;
  return (
    (uncachedInputTokens * rate.input) / perMillion +
    (usage.cachedInputTokens * rate.cachedInput) / perMillion +
    (billedOutputTokens * rate.output) / perMillion
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
