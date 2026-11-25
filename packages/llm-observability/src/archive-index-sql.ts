import type { Database, SQLQueryBindings } from "bun:sqlite";
import path from "node:path";
import { z } from "zod";
import {
  ArchivedSpanIndexRowSchema,
  TraceListItemSchema,
  type ArchivedSpanIndexRow,
  type TraceListItem,
  type TracesSearchQuery,
} from "@shepherdjerred/ops-model/llm-traces.ts";

export const ARCHIVE_INDEX_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS archived_spans (
    s3_key TEXT PRIMARY KEY,
    trace_id TEXT NOT NULL,
    span_id TEXT NOT NULL,
    captured_at_ms INTEGER NOT NULL,
    service TEXT NOT NULL,
    provider TEXT NOT NULL,
    call_site TEXT NOT NULL,
    request_model TEXT,
    response_model TEXT,
    response_id TEXT,
    finish_reason TEXT,
    input_tokens INTEGER NOT NULL,
    output_tokens INTEGER NOT NULL,
    cache_read_tokens INTEGER NOT NULL,
    cache_creation_tokens INTEGER NOT NULL,
    has_tool_io INTEGER NOT NULL,
    bytes_compressed INTEGER NOT NULL,
    bytes_uncompressed INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_archived_spans_trace_id
    ON archived_spans(trace_id, captured_at_ms ASC, span_id ASC);
  CREATE INDEX IF NOT EXISTS idx_archived_spans_captured_at
    ON archived_spans(captured_at_ms);

  CREATE TABLE IF NOT EXISTS archived_traces (
    trace_id TEXT PRIMARY KEY,
    started_at_ms INTEGER NOT NULL,
    ended_at_ms INTEGER NOT NULL,
    span_count INTEGER NOT NULL,
    error_count INTEGER NOT NULL,
    primary_service TEXT NOT NULL,
    primary_provider TEXT NOT NULL,
    primary_call_site TEXT NOT NULL,
    primary_model TEXT,
    services_json TEXT NOT NULL,
    providers_json TEXT NOT NULL,
    call_sites_json TEXT NOT NULL,
    models_json TEXT NOT NULL,
    input_tokens INTEGER NOT NULL,
    output_tokens INTEGER NOT NULL,
    cache_read_tokens INTEGER NOT NULL,
    cache_creation_tokens INTEGER NOT NULL,
    has_tool_io INTEGER NOT NULL,
    bytes_compressed INTEGER NOT NULL,
    bytes_uncompressed INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_archived_traces_started
    ON archived_traces(started_at_ms DESC, trace_id DESC);
  CREATE INDEX IF NOT EXISTS idx_archived_traces_service
    ON archived_traces(primary_service, started_at_ms DESC);
  CREATE INDEX IF NOT EXISTS idx_archived_traces_workload
    ON archived_traces(primary_call_site, started_at_ms DESC);
  CREATE INDEX IF NOT EXISTS idx_archived_traces_provider
    ON archived_traces(primary_provider, started_at_ms DESC);
  CREATE INDEX IF NOT EXISTS idx_archived_traces_model
    ON archived_traces(primary_model, started_at_ms DESC);

  CREATE TABLE IF NOT EXISTS archive_watermarks (
    prefix TEXT PRIMARY KEY,
    last_date_key TEXT NOT NULL,
    updated_at_ms INTEGER NOT NULL
  );
`;

const SpanDbRowSchema = z.object({
  s3_key: z.string(),
  trace_id: z.string(),
  span_id: z.string(),
  captured_at_ms: z.number(),
  service: z.string(),
  provider: z.string(),
  call_site: z.string(),
  request_model: z.string().nullable(),
  response_model: z.string().nullable(),
  response_id: z.string().nullable(),
  finish_reason: z.string().nullable(),
  input_tokens: z.number(),
  output_tokens: z.number(),
  cache_read_tokens: z.number(),
  cache_creation_tokens: z.number(),
  has_tool_io: z.number(),
  bytes_compressed: z.number(),
  bytes_uncompressed: z.number(),
});

const TraceDbRowSchema = z.object({
  trace_id: z.string(),
  started_at_ms: z.number(),
  ended_at_ms: z.number(),
  span_count: z.number(),
  error_count: z.number(),
  primary_service: z.string(),
  primary_provider: z.string(),
  primary_call_site: z.string(),
  primary_model: z.string().nullable(),
  services_json: z.string(),
  providers_json: z.string(),
  call_sites_json: z.string(),
  models_json: z.string(),
  input_tokens: z.number(),
  output_tokens: z.number(),
  cache_read_tokens: z.number(),
  cache_creation_tokens: z.number(),
  has_tool_io: z.number(),
  bytes_compressed: z.number(),
  bytes_uncompressed: z.number(),
});

export const WatermarkDbRowSchema = z.object({
  prefix: z.string(),
  last_date_key: z.string(),
  updated_at_ms: z.number(),
});

export const CountRowSchema = z.object({ c: z.number() });
export const MaxWatermarkRowSchema = z.object({
  latest: z.number().nullable(),
});
export const TraceIdRowSchema = z.object({ trace_id: z.string() });
export const FacetValueRowSchema = z.object({ val: z.string() });
const StringArraySchema = z.array(z.string());

export function ensureParentDirectory(dbPath: string): void {
  if (dbPath === ":memory:" || dbPath.startsWith("file:")) {
    return;
  }
  const parentDir = path.dirname(dbPath);
  if (parentDir === "" || parentDir === ".") {
    return;
  }
  const proc = Bun.spawnSync(["mkdir", "-p", parentDir], {
    stdout: "ignore",
    stderr: "pipe",
  });
  if (proc.exitCode !== 0) {
    const stderr = new TextDecoder().decode(proc.stderr).trim();
    throw new Error(
      `Failed to create parent directory for ${dbPath}: ${stderr}`,
    );
  }
}

function parseCursor(cursor: string): { startedAtMs: number; traceId: string } {
  const separatorIndex = cursor.indexOf(":");
  if (separatorIndex <= 0 || separatorIndex === cursor.length - 1) {
    throw new Error("Invalid trace pagination cursor");
  }
  const rawStarted = cursor.slice(0, separatorIndex);
  const traceId = cursor.slice(separatorIndex + 1);
  if (!/^\d+$/u.test(rawStarted)) {
    throw new Error("Invalid trace pagination cursor timestamp");
  }
  const startedAtMs = Number(rawStarted);
  if (!Number.isSafeInteger(startedAtMs) || startedAtMs < 0) {
    throw new Error("Invalid trace pagination cursor range");
  }
  return { startedAtMs, traceId };
}

function escapeSqlLike(term: string): string {
  return term
    .toLowerCase()
    .replaceAll("\\", String.raw`\\`)
    .replaceAll("%", String.raw`\%`)
    .replaceAll("_", String.raw`\_`);
}

export function mapSpanDbRow(raw: unknown): ArchivedSpanIndexRow {
  const row = SpanDbRowSchema.parse(raw);
  return ArchivedSpanIndexRowSchema.parse({
    s3Key: row.s3_key,
    traceId: row.trace_id,
    spanId: row.span_id,
    capturedAtMs: row.captured_at_ms,
    service: row.service,
    provider: row.provider,
    callSite: row.call_site,
    requestModel: row.request_model,
    responseModel: row.response_model,
    responseId: row.response_id,
    finishReason: row.finish_reason,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    cacheReadTokens: row.cache_read_tokens,
    cacheCreationTokens: row.cache_creation_tokens,
    hasToolIo: row.has_tool_io === 1,
    bytesCompressed: row.bytes_compressed,
    bytesUncompressed: row.bytes_uncompressed,
  });
}

export function mapTraceDbRow(raw: unknown): TraceListItem {
  const row = TraceDbRowSchema.parse(raw);
  const durationMs =
    row.ended_at_ms > row.started_at_ms
      ? row.ended_at_ms - row.started_at_ms
      : null;
  return TraceListItemSchema.parse({
    traceId: row.trace_id,
    source: "archive",
    startedAtMs: row.started_at_ms,
    durationMs,
    spanCount: row.span_count,
    errorCount: row.error_count,
    service: row.primary_service,
    environment: null,
    rootSpanName: row.primary_call_site,
    workloads: StringArraySchema.parse(JSON.parse(row.call_sites_json)),
    providers: StringArraySchema.parse(JSON.parse(row.providers_json)),
    models: StringArraySchema.parse(JSON.parse(row.models_json)),
    subject: null,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    cachedInputTokens: row.cache_read_tokens,
    hasToolIo: row.has_tool_io === 1,
  });
}

export function buildSearchWhereClause(
  query: TracesSearchQuery,
  cutoffMs: number,
): { sql: string; params: SQLQueryBindings[] } {
  const conditions: string[] = ["started_at_ms >= ?"];
  const params: SQLQueryBindings[] = [cutoffMs];

  if (query.service !== undefined) {
    conditions.push(
      "(primary_service = ? OR EXISTS (SELECT 1 FROM json_each(services_json) WHERE value = ?))",
    );
    params.push(query.service, query.service);
  }
  if (query.workload !== undefined) {
    conditions.push(
      "(primary_call_site = ? OR EXISTS (SELECT 1 FROM json_each(call_sites_json) WHERE value = ?))",
    );
    params.push(query.workload, query.workload);
  }
  if (query.provider !== undefined) {
    conditions.push(
      "(primary_provider = ? OR EXISTS (SELECT 1 FROM json_each(providers_json) WHERE value = ?))",
    );
    params.push(query.provider, query.provider);
  }
  if (query.model !== undefined) {
    conditions.push(
      "(primary_model = ? OR EXISTS (SELECT 1 FROM json_each(models_json) WHERE value = ?))",
    );
    params.push(query.model, query.model);
  }
  if (query.status === "error") {
    conditions.push("error_count > 0");
  } else if (query.status === "ok") {
    conditions.push("error_count = 0");
  }
  if (query.q !== undefined) {
    const pattern = `%${escapeSqlLike(query.q)}%`;
    conditions.push(
      String.raw`(LOWER(trace_id) LIKE ? ESCAPE '\' OR LOWER(call_sites_json) LIKE ? ESCAPE '\' OR LOWER(models_json) LIKE ? ESCAPE '\' OR LOWER(services_json) LIKE ? ESCAPE '\')`,
    );
    params.push(pattern, pattern, pattern, pattern);
  }
  if (query.cursor !== undefined) {
    const { startedAtMs, traceId } = parseCursor(query.cursor);
    conditions.push(
      "(started_at_ms < ? OR (started_at_ms = ? AND trace_id < ?))",
    );
    params.push(startedAtMs, startedAtMs, traceId);
  }

  return { sql: conditions.join(" AND "), params };
}

export function recomputeTraceRollup(
  db: Database,
  traceId: string,
  spans: readonly ArchivedSpanIndexRow[],
): void {
  const first = spans[0];
  if (first === undefined) {
    db.prepare("DELETE FROM archived_traces WHERE trace_id = ?").run(traceId);
    return;
  }

  let startedAtMs = first.capturedAtMs;
  let endedAtMs = first.capturedAtMs;
  let errorCount = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheReadTokens = 0;
  let cacheCreationTokens = 0;
  let hasToolIo = false;
  let bytesCompressed = 0;
  let bytesUncompressed = 0;
  let primaryModel: string | null = null;
  const services = new Set<string>();
  const providers = new Set<string>();
  const callSites = new Set<string>();
  const models = new Set<string>();

  for (const span of spans) {
    startedAtMs = Math.min(startedAtMs, span.capturedAtMs);
    endedAtMs = Math.max(endedAtMs, span.capturedAtMs);
    if (span.finishReason === "error") {
      errorCount += 1;
    }
    services.add(span.service);
    providers.add(span.provider);
    callSites.add(span.callSite);
    const effectiveModel = span.requestModel ?? span.responseModel;
    if (effectiveModel !== null) {
      primaryModel ??= effectiveModel;
      models.add(effectiveModel);
    }
    inputTokens += span.inputTokens;
    outputTokens += span.outputTokens;
    cacheReadTokens += span.cacheReadTokens;
    cacheCreationTokens += span.cacheCreationTokens;
    if (span.hasToolIo) {
      hasToolIo = true;
    }
    bytesCompressed += span.bytesCompressed;
    bytesUncompressed += span.bytesUncompressed;
  }

  db.prepare(
    `
    INSERT INTO archived_traces (
      trace_id, started_at_ms, ended_at_ms, span_count, error_count,
      primary_service, primary_provider, primary_call_site, primary_model,
      services_json, providers_json, call_sites_json, models_json,
      input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens,
      has_tool_io, bytes_compressed, bytes_uncompressed
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(trace_id) DO UPDATE SET
      started_at_ms = excluded.started_at_ms,
      ended_at_ms = excluded.ended_at_ms,
      span_count = excluded.span_count,
      error_count = excluded.error_count,
      primary_service = excluded.primary_service,
      primary_provider = excluded.primary_provider,
      primary_call_site = excluded.primary_call_site,
      primary_model = excluded.primary_model,
      services_json = excluded.services_json,
      providers_json = excluded.providers_json,
      call_sites_json = excluded.call_sites_json,
      models_json = excluded.models_json,
      input_tokens = excluded.input_tokens,
      output_tokens = excluded.output_tokens,
      cache_read_tokens = excluded.cache_read_tokens,
      cache_creation_tokens = excluded.cache_creation_tokens,
      has_tool_io = excluded.has_tool_io,
      bytes_compressed = excluded.bytes_compressed,
      bytes_uncompressed = excluded.bytes_uncompressed
  `,
  ).run(
    traceId,
    startedAtMs,
    endedAtMs,
    spans.length,
    errorCount,
    first.service,
    first.provider,
    first.callSite,
    primaryModel,
    JSON.stringify([...services]),
    JSON.stringify([...providers]),
    JSON.stringify([...callSites]),
    JSON.stringify([...models]),
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheCreationTokens,
    hasToolIo ? 1 : 0,
    bytesCompressed,
    bytesUncompressed,
  );
}
