import { Temporal } from "@js-temporal/polyfill";
import {
  readArchiveObject,
  type ArchiveConfig,
} from "@shepherdjerred/llm-observability";
import type { LlmTraceArchiveStore } from "@shepherdjerred/llm-observability/archive-index";
import {
  normalizeArchivedTrace,
  normalizeOtlpTrace,
} from "@shepherdjerred/llm-observability/trajectory";
import { UpstreamError } from "@shepherdjerred/ops-clients/http.ts";
import {
  buildLlmTraceQl,
  type TempoClient,
} from "@shepherdjerred/ops-clients/tempo.ts";
import {
  LlmArchiveIngestRequestSchema,
  rangeRequiresArchive,
  TraceIdTextSchema,
  traceRangeDurationMs,
  TraceRangeSchema,
  TracesFacetsResponseSchema,
  TracesSearchQuerySchema,
  TracesSearchResponseSchema,
  type TraceListItem,
  type TracesSearchQuery,
  type TracesSearchResponse,
} from "@shepherdjerred/llm-observability/llm-traces";
import { bodyLimit } from "hono/body-limit";
import type { Context } from "hono";

import { hasBearer } from "#server/bearer";
import type { ServerModule } from "#server/platform/module";
import { systemClock, toContractDate } from "#shared/time";

import {
  detailToListItem,
  hydrateOtlpEnvelopes,
  matchesDirectTraceFilters,
  matchesTextQuery,
  mergeTempoItem,
  readArchivedEnvelopes,
  type ArchiveReaderFn,
} from "./server-helpers.ts";

const INGEST_BODY_LIMIT_BYTES = 8 * 1024 * 1024;

export type TempoPort = Pick<TempoClient, "search" | "getTrace" | "health">;

export type TracesServerModuleOptions = {
  readonly store: LlmTraceArchiveStore;
  readonly tempo?: TempoPort | null | undefined;
  readonly archive?: ArchiveConfig | null | undefined;
  readonly archiveReader?: ArchiveReaderFn | undefined;
  readonly opsIngestToken: string;
  readonly now?: (() => number) | undefined;
};

function unauthorized(context: Context): Response {
  return context.json({ error: "Unauthorized" }, 401);
}

function upstreamErrorResponse(
  error: unknown,
  context: Context,
): Response | undefined {
  return error instanceof UpstreamError
    ? context.json({ error: error.message, code: "upstream_unavailable" }, 502)
    : undefined;
}

async function searchTempoTraces(input: {
  tempo: TempoPort;
  store: LlmTraceArchiveStore;
  query: TracesSearchQuery;
  nowMs: number;
}): Promise<TracesSearchResponse> {
  const { tempo, store, query, nowMs } = input;
  const fromMs = Math.max(0, nowMs - traceRangeDurationMs(query.range));

  const directId =
    query.q === undefined ? null : TraceIdTextSchema.safeParse(query.q);
  if (directId?.success === true) {
    const otlp = await tempo.getTrace(directId.data);
    if (otlp === null) {
      return TracesSearchResponseSchema.parse({
        source: "tempo",
        range: query.range,
        items: [],
        nextCursor: null,
        truncated: false,
      });
    }
    const detail = normalizeOtlpTrace({ traceId: directId.data, trace: otlp });
    const indexed = store
      .summariesByTraceIds([directId.data])
      .get(directId.data);
    const item = detailToListItem(detail, indexed);
    const items = matchesDirectTraceFilters(item, query) ? [item] : [];
    return TracesSearchResponseSchema.parse({
      source: "tempo",
      range: query.range,
      items,
      nextCursor: null,
      truncated: false,
    });
  }

  const traceQl = buildLlmTraceQl({
    service: query.service,
    environment: query.environment,
    workload: query.workload,
    provider: query.provider,
    model: query.model,
    status: query.status,
    subjectId: query.subjectId,
  });
  const start = toContractDate(Temporal.Instant.fromEpochMilliseconds(fromMs));
  const end = toContractDate(Temporal.Instant.fromEpochMilliseconds(nowMs));
  const searchResult = await tempo.search({
    query: traceQl,
    start,
    end,
    limit: query.limit,
    spss: 5,
  });

  const indexedById = store.summariesByTraceIds(
    searchResult.traces.map((trace) => trace.traceId),
  );
  const merged: TraceListItem[] = searchResult.traces
    .map((summary) => mergeTempoItem(summary, indexedById.get(summary.traceId)))
    .filter(
      (item) =>
        (query.status !== "error" || item.errorCount > 0) &&
        (query.status !== "ok" || item.errorCount === 0) &&
        matchesTextQuery(item, query.q),
    )
    .sort(
      (left, right) =>
        right.startedAtMs - left.startedAtMs ||
        right.traceId.localeCompare(left.traceId),
    );

  return TracesSearchResponseSchema.parse({
    source: "tempo",
    range: query.range,
    items: merged,
    nextCursor: null,
    truncated: searchResult.truncated,
  });
}

export function createTracesServerModule(
  options: TracesServerModuleOptions,
): ServerModule {
  const { store, opsIngestToken } = options;
  const tempo = options.tempo ?? null;
  const archive = options.archive ?? null;
  const archiveReader: ArchiveReaderFn =
    options.archiveReader ?? readArchiveObject;
  const now = options.now ?? (() => systemClock.now().epochMilliseconds);

  return {
    id: "traces",
    register: (routes) => {
      routes.get("/internal/watermarks", (context) =>
        hasBearer(context.req.header("authorization"), opsIngestToken)
          ? context.json(store.watermarks())
          : unauthorized(context),
      );

      routes.post(
        "/internal/ingest",
        bodyLimit({
          maxSize: INGEST_BODY_LIMIT_BYTES,
          onError: (context) =>
            context.json({ error: "Payload too large" }, 413),
        }),
        async (context) => {
          if (!hasBearer(context.req.header("authorization"), opsIngestToken)) {
            return unauthorized(context);
          }
          const rawText = await context.req.text();
          let rawJson: unknown;
          try {
            rawJson = JSON.parse(rawText);
          } catch {
            return context.json({ error: "Invalid request" }, 400);
          }
          const parsed = LlmArchiveIngestRequestSchema.parse(rawJson);
          return context.json(store.ingest(parsed), 202);
        },
      );

      routes.get("/facets", (context) => {
        const nowMs = now();
        const rawRange = context.req.query("range");
        const fromMs =
          rawRange === undefined
            ? undefined
            : Math.max(
                0,
                nowMs - traceRangeDurationMs(TraceRangeSchema.parse(rawRange)),
              );
        const summary = store.facets(fromMs, nowMs);
        return context.json(
          TracesFacetsResponseSchema.parse({
            ...summary,
            tempoAvailable: tempo !== null,
            archiveConfigured: archive !== null,
          }),
        );
      });

      routes.get("/search", async (context) => {
        const query = TracesSearchQuerySchema.parse(context.req.query());
        const nowMs = now();
        const useArchive =
          query.source === "archive" ||
          rangeRequiresArchive(query.range) ||
          tempo === null;
        if (useArchive) {
          return context.json(
            store.searchTraces({ ...query, source: "archive" }, nowMs),
          );
        }
        try {
          return context.json(
            await searchTempoTraces({ tempo, store, query, nowMs }),
          );
        } catch (error) {
          const mapped = upstreamErrorResponse(error, context);
          if (mapped !== undefined) return mapped;
          throw error;
        }
      });

      routes.get("/:traceId", async (context) => {
        const parsedId = TraceIdTextSchema.safeParse(
          context.req.param("traceId"),
        );
        if (!parsedId.success) {
          return context.json({ error: "Invalid traceId" }, 400);
        }
        const traceId = parsedId.data;

        if (tempo !== null) {
          try {
            const otlp = await tempo.getTrace(traceId);
            if (otlp !== null) {
              const hydratedEnvelopes = await hydrateOtlpEnvelopes(
                otlp,
                archive,
                archiveReader,
              );
              return context.json(
                normalizeOtlpTrace({ traceId, trace: otlp, hydratedEnvelopes }),
              );
            }
          } catch (error) {
            const mapped = upstreamErrorResponse(error, context);
            if (mapped !== undefined) return mapped;
            throw error;
          }
        }

        const rows = store.spansForTrace(traceId);
        if (rows.length === 0) {
          return context.json({ error: "Trace not found" }, 404);
        }
        const envelopes = await readArchivedEnvelopes(
          rows,
          archive,
          archiveReader,
        );
        return context.json(
          normalizeArchivedTrace({ traceId, rows, envelopes }),
        );
      });
    },
    ready: async () =>
      store.ping() && (tempo === null || (await tempo.health())),
    close: () => {
      store.close();
      return Promise.resolve();
    },
  };
}
