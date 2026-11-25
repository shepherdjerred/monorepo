import { Database, type SQLQueryBindings } from "bun:sqlite";
import {
  LlmArchiveIngestRequestSchema,
  LlmArchiveIngestResponseSchema,
  LlmArchiveWatermarksResponseSchema,
  traceRangeDurationMs,
  TracesSearchQuerySchema,
  TracesSearchResponseSchema,
  type ArchivedSpanIndexRow,
  type LlmArchiveIngestRequest,
  type LlmArchiveIngestResponse,
  type LlmArchiveWatermarksResponse,
  type TraceListItem,
  type TracesFacetsResponse,
  type TracesSearchQuery,
  type TracesSearchResponse,
} from "@shepherdjerred/ops-model/llm-traces.ts";
import {
  ARCHIVE_INDEX_SCHEMA_SQL,
  buildSearchWhereClause,
  CountRowSchema,
  ensureParentDirectory,
  FacetValueRowSchema,
  mapSpanDbRow,
  mapTraceDbRow,
  MaxWatermarkRowSchema,
  recomputeTraceRollup,
  TraceIdRowSchema,
  WatermarkDbRowSchema,
} from "./archive-index-sql.ts";

export type ArchiveFacetsSummary = Omit<
  TracesFacetsResponse,
  "tempoAvailable" | "archiveConfigured"
>;

export class LlmTraceArchiveStore {
  readonly #db: Database;
  #closed = false;

  private constructor(db: Database) {
    this.#db = db;
  }

  static open(dbPath: string): LlmTraceArchiveStore {
    ensureParentDirectory(dbPath);
    const db = new Database(dbPath, { create: true });
    try {
      db.run("PRAGMA journal_mode = WAL;");
      db.run("PRAGMA synchronous = NORMAL;");
      db.run("PRAGMA busy_timeout = 5000;");
      db.run("PRAGMA foreign_keys = ON;");
      db.run(ARCHIVE_INDEX_SCHEMA_SQL);
    } catch (error) {
      db.close(false);
      throw error;
    }
    return new LlmTraceArchiveStore(db);
  }

  ping(): boolean {
    if (this.#closed) return false;
    try {
      return (
        this.#db
          .query<{ alive: number }, []>(
            "SELECT count(*) >= 0 AS alive FROM archive_watermarks",
          )
          .get()?.alive === 1
      );
    } catch {
      return false;
    }
  }

  close(): void {
    if (!this.#closed) {
      this.#closed = true;
      this.#db.close(false);
    }
  }

  ingest(rawRequest: LlmArchiveIngestRequest): LlmArchiveIngestResponse {
    const request = LlmArchiveIngestRequestSchema.parse(rawRequest);
    const runTx = this.#db.transaction((): LlmArchiveIngestResponse => {
      const touchedTraceIds = new Set<string>();
      this.#upsertSpanRows(request.rows, touchedTraceIds);
      const prunedSpans = this.#pruneExpiredSpans(
        request.retentionCutoffMs,
        touchedTraceIds,
      );

      for (const traceId of touchedTraceIds) {
        recomputeTraceRollup(this.#db, traceId, this.spansForTrace(traceId));
      }
      this.#upsertWatermarks(request.watermarks);

      return LlmArchiveIngestResponseSchema.parse({
        upsertedSpans: request.rows.length,
        updatedTraces: touchedTraceIds.size,
        prunedSpans,
      });
    });

    return runTx();
  }

  #upsertSpanRows(
    rows: readonly ArchivedSpanIndexRow[],
    touchedTraceIds: Set<string>,
  ): void {
    const selectExistingTraceStmt = this.#db.prepare(
      "SELECT trace_id FROM archived_spans WHERE s3_key = ?",
    );
    const upsertSpanStmt = this.#db.prepare(`
      INSERT INTO archived_spans (
        s3_key, trace_id, span_id, captured_at_ms, service, provider, call_site,
        request_model, response_model, response_id, finish_reason,
        input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens,
        has_tool_io, bytes_compressed, bytes_uncompressed
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(s3_key) DO UPDATE SET
        trace_id = excluded.trace_id,
        span_id = excluded.span_id,
        captured_at_ms = excluded.captured_at_ms,
        service = excluded.service,
        provider = excluded.provider,
        call_site = excluded.call_site,
        request_model = excluded.request_model,
        response_model = excluded.response_model,
        response_id = excluded.response_id,
        finish_reason = excluded.finish_reason,
        input_tokens = excluded.input_tokens,
        output_tokens = excluded.output_tokens,
        cache_read_tokens = excluded.cache_read_tokens,
        cache_creation_tokens = excluded.cache_creation_tokens,
        has_tool_io = excluded.has_tool_io,
        bytes_compressed = excluded.bytes_compressed,
        bytes_uncompressed = excluded.bytes_uncompressed
    `);

    for (const row of rows) {
      const previous = selectExistingTraceStmt.get(row.s3Key);
      if (previous !== null) {
        touchedTraceIds.add(TraceIdRowSchema.parse(previous).trace_id);
      }
      upsertSpanStmt.run(
        row.s3Key,
        row.traceId,
        row.spanId,
        row.capturedAtMs,
        row.service,
        row.provider,
        row.callSite,
        row.requestModel,
        row.responseModel,
        row.responseId,
        row.finishReason,
        row.inputTokens,
        row.outputTokens,
        row.cacheReadTokens,
        row.cacheCreationTokens,
        row.hasToolIo ? 1 : 0,
        row.bytesCompressed,
        row.bytesUncompressed,
      );
      touchedTraceIds.add(row.traceId);
    }
  }

  #pruneExpiredSpans(
    retentionCutoffMs: number | undefined,
    touchedTraceIds: Set<string>,
  ): number {
    if (retentionCutoffMs === undefined) {
      return 0;
    }
    const expiredTraces = this.#db
      .prepare(
        "SELECT DISTINCT trace_id FROM archived_spans WHERE captured_at_ms < ?",
      )
      .all(retentionCutoffMs);
    for (const raw of expiredTraces) {
      touchedTraceIds.add(TraceIdRowSchema.parse(raw).trace_id);
    }
    return this.#db
      .prepare("DELETE FROM archived_spans WHERE captured_at_ms < ?")
      .run(retentionCutoffMs).changes;
  }

  #upsertWatermarks(watermarks: LlmArchiveIngestRequest["watermarks"]): void {
    const upsertWatermarkStmt = this.#db.prepare(`
      INSERT INTO archive_watermarks (prefix, last_date_key, updated_at_ms)
      VALUES (?, ?, ?)
      ON CONFLICT(prefix) DO UPDATE SET
        last_date_key = CASE
          WHEN excluded.last_date_key > archive_watermarks.last_date_key
            THEN excluded.last_date_key
          ELSE archive_watermarks.last_date_key
        END,
        updated_at_ms = MAX(archive_watermarks.updated_at_ms, excluded.updated_at_ms)
    `);
    for (const wm of watermarks) {
      upsertWatermarkStmt.run(wm.prefix, wm.lastDateKey, wm.updatedAtMs);
    }
  }

  watermarks(): LlmArchiveWatermarksResponse {
    const rawWatermarks = this.#db
      .prepare(
        "SELECT prefix, last_date_key, updated_at_ms FROM archive_watermarks ORDER BY prefix ASC",
      )
      .all();
    const totalSpans = CountRowSchema.parse(
      this.#db.prepare("SELECT COUNT(*) AS c FROM archived_spans").get(),
    ).c;
    const totalTraces = CountRowSchema.parse(
      this.#db.prepare("SELECT COUNT(*) AS c FROM archived_traces").get(),
    ).c;

    return LlmArchiveWatermarksResponseSchema.parse({
      watermarks: rawWatermarks.map((raw) => {
        const parsed = WatermarkDbRowSchema.parse(raw);
        return {
          prefix: parsed.prefix,
          lastDateKey: parsed.last_date_key,
          updatedAtMs: parsed.updated_at_ms,
        };
      }),
      totalSpans,
      totalTraces,
    });
  }

  searchTraces(
    rawQuery: TracesSearchQuery,
    nowMs = Date.now(),
  ): TracesSearchResponse {
    const query = TracesSearchQuerySchema.parse(rawQuery);
    const cutoffMs = Math.max(0, nowMs - traceRangeDurationMs(query.range));
    const where = buildSearchWhereClause(query, cutoffMs);
    const sql = `
      SELECT *
      FROM archived_traces
      WHERE ${where.sql}
      ORDER BY started_at_ms DESC, trace_id DESC
      LIMIT ?
    `;
    const rows = this.#db
      .prepare(sql)
      .all(...where.params, query.limit + 1)
      .map((raw) => mapTraceDbRow(raw));

    const truncated = rows.length > query.limit;
    const items = truncated ? rows.slice(0, query.limit) : rows;
    const last = items.at(-1);
    const nextCursor =
      truncated && last !== undefined
        ? `${String(last.startedAtMs)}:${last.traceId}`
        : null;

    return TracesSearchResponseSchema.parse({
      source: "archive",
      range: query.range,
      items,
      nextCursor,
      truncated,
    });
  }

  facets(fromMs?: number, toMs?: number): ArchiveFacetsSummary {
    const indexedTraces = CountRowSchema.parse(
      this.#db.prepare("SELECT COUNT(*) AS c FROM archived_traces").get(),
    ).c;
    const indexedSpans = CountRowSchema.parse(
      this.#db.prepare("SELECT COUNT(*) AS c FROM archived_spans").get(),
    ).c;
    const latestWatermarkUpdatedAtMs = MaxWatermarkRowSchema.parse(
      this.#db
        .prepare("SELECT MAX(updated_at_ms) AS latest FROM archive_watermarks")
        .get(),
    ).latest;

    const conditions: string[] = [];
    const params: SQLQueryBindings[] = [];
    if (fromMs !== undefined) {
      conditions.push("archived_traces.started_at_ms >= ?");
      params.push(fromMs);
    }
    if (toMs !== undefined) {
      conditions.push("archived_traces.started_at_ms <= ?");
      params.push(toMs);
    }
    const whereSql =
      conditions.length === 0 ? "" : `WHERE ${conditions.join(" AND ")}`;

    const distinctJsonValues = (
      column:
        "services_json" | "call_sites_json" | "providers_json" | "models_json",
    ): string[] => {
      const sql = `
        SELECT DISTINCT j.value AS val
        FROM archived_traces, json_each(archived_traces.${column}) AS j
        ${whereSql}
        ORDER BY val ASC
      `;
      return this.#db
        .prepare(sql)
        .all(...params)
        .map((row) => FacetValueRowSchema.parse(row).val);
    };

    return {
      indexedTraces,
      indexedSpans,
      latestWatermarkUpdatedAtMs,
      services: distinctJsonValues("services_json"),
      workloads: distinctJsonValues("call_sites_json"),
      providers: distinctJsonValues("providers_json"),
      models: distinctJsonValues("models_json"),
    };
  }

  spansForTrace(traceId: string): ArchivedSpanIndexRow[] {
    return this.#db
      .prepare(
        "SELECT * FROM archived_spans WHERE trace_id = ? ORDER BY captured_at_ms ASC, span_id ASC",
      )
      .all(traceId)
      .map((raw) => mapSpanDbRow(raw));
  }

  summariesByTraceIds(
    traceIds: readonly string[],
  ): ReadonlyMap<string, TraceListItem> {
    const result = new Map<string, TraceListItem>();
    if (traceIds.length === 0) {
      return result;
    }
    const uniqueIds = [...new Set(traceIds)];
    const chunkSize = 400;
    for (let offset = 0; offset < uniqueIds.length; offset += chunkSize) {
      const chunk = uniqueIds.slice(offset, offset + chunkSize);
      const placeholders = chunk.map(() => "?").join(", ");
      const rows = this.#db
        .prepare(
          `SELECT * FROM archived_traces WHERE trace_id IN (${placeholders})`,
        )
        .all(...chunk);
      for (const raw of rows) {
        const item = mapTraceDbRow(raw);
        result.set(item.traceId, item);
      }
    }
    return result;
  }
}
