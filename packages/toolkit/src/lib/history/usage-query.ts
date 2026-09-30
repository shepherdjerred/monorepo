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

/**
 * One usage event as the metrics export ledger sees it: the index row plus
 * the owning document's source id, which is what keeps two sessions' identical
 * events distinct. Never carries prompts, paths, or workspace names.
 */
export type ExportableUsageEvent = {
  readonly source: HistorySourceName;
  readonly sourceId: string;
  readonly occurredAt: string;
  readonly model: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheCreationTokens: number;
  readonly cachedInputTokens: number;
  readonly reasoningTokens: number;
  readonly costUsd: number | null;
  readonly costComplete: boolean;
};

/**
 * A cheap per-document digest of its usage rows. Ingest rewrites every
 * document of a changed source, so row ids churn; this aggregate only changes
 * when the document's events do, which lets the export ledger skip hashing
 * documents it has already seen.
 */
export type UsageDocumentFingerprint = {
  readonly documentId: number;
  readonly source: HistorySourceName;
  readonly sourceId: string;
  readonly fingerprint: string;
};

const FingerprintRowSchema = z.object({
  document_id: z.number(),
  source: z.string(),
  source_id: z.string(),
  events: z.number(),
  input_tokens: z.number(),
  output_tokens: z.number(),
  cache_read_tokens: z.number(),
  cache_creation_tokens: z.number(),
  cached_input_tokens: z.number(),
  reasoning_tokens: z.number(),
  first_at: z.string(),
  last_at: z.string(),
  models: z.number(),
});

export function queryUsageFingerprints(
  database: Database,
): UsageDocumentFingerprint[] {
  return database
    .prepare(
      `SELECT d.id AS document_id, d.source, d.source_id,
              count(*) AS events,
              sum(u.input_tokens) AS input_tokens,
              sum(u.output_tokens) AS output_tokens,
              sum(u.cache_read_tokens) AS cache_read_tokens,
              sum(u.cache_creation_tokens) AS cache_creation_tokens,
              sum(u.cached_input_tokens) AS cached_input_tokens,
              sum(u.reasoning_tokens) AS reasoning_tokens,
              min(u.occurred_at) AS first_at,
              max(u.occurred_at) AS last_at,
              count(DISTINCT u.model) AS models
         FROM usage_events u
         JOIN documents d ON d.id = u.document_id
        GROUP BY d.id
        ORDER BY d.id`,
    )
    .all()
    .map((row: unknown) => FingerprintRowSchema.parse(row))
    .map((row) => ({
      documentId: row.document_id,
      source: parseHistorySourceName(row.source, "in usage export"),
      sourceId: row.source_id,
      fingerprint: JSON.stringify([
        row.events,
        row.input_tokens,
        row.output_tokens,
        row.cache_read_tokens,
        row.cache_creation_tokens,
        row.cached_input_tokens,
        row.reasoning_tokens,
        row.first_at,
        row.last_at,
        row.models,
      ]),
    }));
}

const ExportEventRowSchema = z.object({
  source: z.string(),
  source_id: z.string(),
  occurred_at: z.string(),
  model: z.string(),
  input_tokens: z.number(),
  output_tokens: z.number(),
  cache_read_tokens: z.number(),
  cache_creation_tokens: z.number(),
  cached_input_tokens: z.number(),
  reasoning_tokens: z.number(),
  cost_usd: z.number().nullable(),
  cost_complete: z.number(),
});

export function queryUsageEventsForDocument(
  database: Database,
  documentId: number,
): ExportableUsageEvent[] {
  return database
    .prepare(
      `SELECT d.source, d.source_id, u.occurred_at, u.model,
              u.input_tokens, u.output_tokens, u.cache_read_tokens,
              u.cache_creation_tokens, u.cached_input_tokens,
              u.reasoning_tokens, u.cost_usd, u.cost_complete
         FROM usage_events u
         JOIN documents d ON d.id = u.document_id
        WHERE u.document_id = ?
        ORDER BY u.rowid`,
    )
    .all(documentId)
    .map((row: unknown) => ExportEventRowSchema.parse(row))
    .map((row) => ({
      source: parseHistorySourceName(row.source, "in usage export"),
      sourceId: row.source_id,
      occurredAt: row.occurred_at,
      model: row.model,
      inputTokens: row.input_tokens,
      outputTokens: row.output_tokens,
      cacheReadTokens: row.cache_read_tokens,
      cacheCreationTokens: row.cache_creation_tokens,
      cachedInputTokens: row.cached_input_tokens,
      reasoningTokens: row.reasoning_tokens,
      costUsd: row.cost_usd,
      costComplete: row.cost_complete === 1,
    }));
}
