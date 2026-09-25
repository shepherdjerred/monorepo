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
  return value === undefined
    ? 0
    : validatedUsageNumber(source, value, key, location);
}

// Requires an absolute RFC 3339 instant (explicit "Z" or numeric offset),
// matching the shape real usage timestamps use (e.g.
// "2026-09-10T02:53:22.232Z"). `Date.parse` alone isn't a sufficient gate:
// it also accepts an offset-less datetime (interpreted as local time — not
// a stable absolute instant across machines) and numeric-looking strings
// like "0", neither of which is a real usage timestamp.
const RFC3339_TIMESTAMP =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u;

/**
 * A usage-bearing record's timestamp isn't just "present" — it must be a
 * real, absolute instant, since `history usage --since` compares stored
 * `occurred_at` values lexicographically. A nonempty but malformed or
 * non-absolute string would otherwise be stored verbatim and silently move
 * the event into or out of arbitrary date windows. Shared across Claude and
 * Codex, whose usage parsers both store a raw timestamp string.
 */
export function requiredAbsoluteTimestamp(
  source: string,
  timestamp: string | null,
  eventLabel: string,
  location: UsageFieldLocation,
): string {
  if (timestamp === null) {
    throw new TypeError(
      `${source} ${eventLabel} missing its timestamp on line ${String(location.lineNumber)} in ${location.filePath}`,
    );
  }
  if (!RFC3339_TIMESTAMP.test(timestamp)) {
    throw new TypeError(
      `${source} ${eventLabel} has an invalid timestamp on line ${String(location.lineNumber)} in ${location.filePath}`,
    );
  }
  const parsedMs = Date.parse(timestamp);
  if (Number.isNaN(parsedMs)) {
    throw new TypeError(
      `${source} ${eventLabel} has an invalid timestamp on line ${String(location.lineNumber)} in ${location.filePath}`,
    );
  }
  return new Date(parsedMs).toISOString();
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
