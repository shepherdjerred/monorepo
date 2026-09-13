import { costForTextUsage } from "@shepherdjerred/llm-models";
import type { UsageEventEntry } from "./types.ts";

export type UsageCounts = {
  readonly inputTokens: number;
  readonly outputTokens: number;
  /** Anthropic-style: additive on top of `inputTokens`. */
  readonly cacheReadTokens: number;
  /** Anthropic-style: additive on top of `inputTokens`. */
  readonly cacheCreationTokens: number;
  /** OpenAI-style: a subset already included in `inputTokens`, billed at a discounted rate. */
  readonly cachedInputTokens: number;
  readonly reasoningTokens: number;
};

export const ZERO_USAGE: UsageCounts = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheCreationTokens: 0,
  cachedInputTokens: 0,
  reasoningTokens: 0,
};

export type UsageCost = {
  readonly costUsd: number | null;
  readonly costComplete: boolean;
};

function hasBillableTokens(usage: UsageCounts): boolean {
  return (
    usage.inputTokens > 0 ||
    usage.outputTokens > 0 ||
    usage.cacheReadTokens > 0 ||
    usage.cacheCreationTokens > 0
  );
}

/**
 * Cost from the shared `@shepherdjerred/llm-models` catalog, trying each
 * candidate model id in order and stopping at the first priced match.
 * `cacheReadTokens`/`cacheCreationTokens` are additive on top of
 * `inputTokens` (the Anthropic convention); `cachedInputTokens` is a subset
 * already included in `inputTokens` (the OpenAI/Codex convention) — passing
 * it through as `cachedInputTokens` rather than folding it into an additive
 * field is what keeps `costForTextUsage` from billing the same tokens twice.
 * `costComplete` is false only when the document actually carried tokens the
 * catalog couldn't price (a session with zero tokens is trivially "complete").
 */
export function catalogCost(
  candidates: readonly string[],
  usage: UsageCounts,
): UsageCost {
  for (const candidate of candidates) {
    const cost = costForTextUsage(candidate, {
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cacheReadTokens: usage.cacheReadTokens,
      cacheWriteTokens: usage.cacheCreationTokens,
      cachedInputTokens: usage.cachedInputTokens,
    });
    if (cost !== undefined) {
      return { costUsd: cost, costComplete: true };
    }
  }
  return { costUsd: null, costComplete: !hasBillableTokens(usage) };
}

/** Cost a source already computed and reported itself (e.g. Grok's costUsdTicks). */
export function reportedCost(costUsd: number | null): UsageCost {
  return { costUsd, costComplete: costUsd !== null };
}

export type UsageFieldLocation = {
  readonly filePath: string;
  readonly lineNumber: number;
};

/**
 * A field that's *present*, including an explicit JSON `null`, and isn't a
 * nonnegative safe integer is malformed data, not a legitimate zero.
 * Silently coercing it (as a bare `typeof value === "number"` check would)
 * understates tokens and cost the same way an unvalidated container field
 * would: the scan reports success and ingestion replaces the last good
 * index with a permanently-partial total. A negative count is rejected
 * rather than merely non-finite ones, since `Number.isFinite` alone accepts
 * it and a negative token count would silently subtract from
 * `catalogCost`'s totals rather than corrupting them loudly.
 */
function validatedUsageNumber(
  source: string,
  value: unknown,
  key: string,
  location: UsageFieldLocation,
): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(
      `Malformed ${source} usage field "${key}" on line ${String(location.lineNumber)} in ${location.filePath}`,
    );
  }
  return value;
}

/**
 * A required count (input/output tokens — every real usage record reports
 * both) that's absent isn't a legitimate zero-usage turn; it's a sign the
 * usage object itself is truncated or the field was renamed upstream. Absent
 * throws exactly like malformed, unlike `optionalUsageNumber`. Shared across
 * Claude, Codex, and Grok, whose usage parsers all hit this same gap
 * independently.
 */
export function requiredUsageNumber(
  source: string,
  usage: Record<string, unknown>,
  key: string,
  location: UsageFieldLocation,
): number {
  const value = usage[key];
  if (value === undefined) {
    throw new TypeError(
      `Missing required ${source} usage field "${key}" on line ${String(location.lineNumber)} in ${location.filePath}`,
    );
  }
  return validatedUsageNumber(source, value, key, location);
}

/**
 * A genuinely optional count (a cache or reasoning breakdown a given model
 * or turn may not report at all) defaults to zero when absent, but is
 * validated the same as a required field whenever it IS present — see
 * `validatedUsageNumber`.
 */
export function optionalUsageNumber(
  source: string,
  usage: Record<string, unknown>,
  key: string,
  location: UsageFieldLocation,
): number {
  const value = usage[key];
  if (value === undefined) {
    return 0;
  }
  return validatedUsageNumber(source, value, key, location);
}

/** One priced usage event, tagged with when it actually happened. */
export function usageEventEntry(
  occurredAt: string,
  model: string,
  usage: UsageCounts,
  cost: UsageCost,
): UsageEventEntry {
  return {
    occurredAt,
    model,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cacheReadTokens: usage.cacheReadTokens,
    cacheCreationTokens: usage.cacheCreationTokens,
    cachedInputTokens: usage.cachedInputTokens,
    reasoningTokens: usage.reasoningTokens,
    costUsd: cost.costUsd,
    costComplete: cost.costComplete,
  };
}
