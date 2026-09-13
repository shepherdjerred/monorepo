import type { Database } from "bun:sqlite";
import { z } from "zod";
import {
  parseHistorySourceName,
  type HistorySourceName,
  type UsageBySource,
  type UsageReport,
  type UsageTotals,
} from "./types.ts";

export type UsageQueryOptions = {
  readonly since: string | null;
  readonly source: HistorySourceName | null;
};

const UsageRowSchema = z.object({
  source: z.string(),
  document_count: z.number(),
  input_tokens: z.number(),
  output_tokens: z.number(),
  cache_read_tokens: z.number(),
  cache_creation_tokens: z.number(),
  cached_input_tokens: z.number(),
  reasoning_tokens: z.number(),
  cost_usd: z.number(),
  cost_complete: z.number(),
});

const EMPTY_TOTALS: UsageTotals = {
  documentCount: 0,
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheCreationTokens: 0,
  cachedInputTokens: 0,
  reasoningTokens: 0,
  costUsd: 0,
  costComplete: true,
};

function addUsageTotals(
  accumulator: UsageTotals,
  group: UsageTotals,
): UsageTotals {
  return {
    documentCount: accumulator.documentCount + group.documentCount,
    inputTokens: accumulator.inputTokens + group.inputTokens,
    outputTokens: accumulator.outputTokens + group.outputTokens,
    cacheReadTokens: accumulator.cacheReadTokens + group.cacheReadTokens,
    cacheCreationTokens:
      accumulator.cacheCreationTokens + group.cacheCreationTokens,
    cachedInputTokens: accumulator.cachedInputTokens + group.cachedInputTokens,
    reasoningTokens: accumulator.reasoningTokens + group.reasoningTokens,
    costUsd: accumulator.costUsd + group.costUsd,
    costComplete: accumulator.costComplete && group.costComplete,
  };
}

/**
 * Token/cost totals grouped by source, plus a grand total, aggregated from
 * `usage_events` — one row per priced turn/generation, each tagged with when
 * it actually happened. Filtering by `occurred_at` here (rather than a
 * document's `updated_at`) is what keeps a `--since` window from attributing
 * a long-lived session's entire lifetime usage to whichever window its most
 * recent turn falls in. `SUM(cost_usd)` skips NULLs, so a source with some
 * unpriced events still reports a (partial, `costComplete: false`)
 * lower-bound total rather than nothing. Sources with no usage tracking
 * (Conductor, Cursor, OpenCode) contribute no rows and so don't appear here.
 */
export function queryUsage(
  database: Database,
  options: UsageQueryOptions,
): UsageReport {
  const clauses: string[] = [];
  const values: (string | number)[] = [];
  if (options.since !== null) {
    clauses.push("occurred_at >= ?");
    values.push(options.since);
  }
  if (options.source !== null) {
    clauses.push("source = ?");
    values.push(options.source);
  }
  const bySource = database
    .prepare(
      `SELECT source,
              count(DISTINCT document_id) AS document_count,
              coalesce(sum(input_tokens), 0) AS input_tokens,
              coalesce(sum(output_tokens), 0) AS output_tokens,
              coalesce(sum(cache_read_tokens), 0) AS cache_read_tokens,
              coalesce(sum(cache_creation_tokens), 0) AS cache_creation_tokens,
              coalesce(sum(cached_input_tokens), 0) AS cached_input_tokens,
              coalesce(sum(reasoning_tokens), 0) AS reasoning_tokens,
              coalesce(sum(cost_usd), 0) AS cost_usd,
              min(cost_complete) AS cost_complete
         FROM usage_events
        ${clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : ""}
        GROUP BY source
        ORDER BY source`,
    )
    .all(...values)
    .map((row: unknown) => UsageRowSchema.parse(row))
    .map((row): UsageBySource => ({
      source: parseHistorySourceName(row.source, "in usage report"),
      documentCount: row.document_count,
      inputTokens: row.input_tokens,
      outputTokens: row.output_tokens,
      cacheReadTokens: row.cache_read_tokens,
      cacheCreationTokens: row.cache_creation_tokens,
      cachedInputTokens: row.cached_input_tokens,
      reasoningTokens: row.reasoning_tokens,
      costUsd: row.cost_usd,
      costComplete: row.cost_complete === 1,
    }));
  const total = bySource.reduce(
    (accumulator, group) => addUsageTotals(accumulator, group),
    EMPTY_TOTALS,
  );
  return { total, bySource };
}
