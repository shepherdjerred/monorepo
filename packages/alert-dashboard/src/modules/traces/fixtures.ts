import { Temporal } from "@js-temporal/polyfill";
import type { ArchiveConfig } from "@shepherdjerred/llm-observability";
import { LlmTraceArchiveStore } from "@shepherdjerred/llm-observability/archive-index";
import { normalizeOtlpTrace } from "@shepherdjerred/llm-observability/trajectory";
import type {
  OtlpTrace,
  TraceSearch,
  TraceSummary,
} from "@shepherdjerred/ops-clients/tempo.ts";

import type { ServerModule } from "#server/platform/module";
import { systemClock, toContractDate } from "#shared/time";

import { buildArchivedIndexSeed } from "./fixtures-data.ts";
import { buildLiveFixtureTraces } from "./fixtures-live-traces.ts";
import { createTracesServerModule, type TempoPort } from "./server.ts";

const FIXTURE_ARCHIVE_CONFIG: ArchiveConfig = {
  bucket: "llm-archive",
  prefix: "llm",
  region: "us-east-1",
  endpoint: "http://seaweedfs-s3.seaweedfs.svc:8333",
  accessKeyId: "fixture-access-key",
  secretAccessKey: "fixture-secret-key",
  forcePathStyle: true,
};

function extractQuotedClause(
  query: string,
  prefix: string,
): string | undefined {
  const escaped = prefix.replaceAll(/[.*+?^${}()|[\]\\]/gu, String.raw`\$&`);
  const match = new RegExp(`${escaped}"([^"]+)"`, "u").exec(query);
  return match?.[1];
}

function matchesScalarClause(
  query: string,
  prefix: string,
  actual: string | null | undefined,
): boolean {
  const expected = extractQuotedClause(query, prefix);
  return expected === undefined || actual === expected;
}

function matchesListClause(
  query: string,
  prefix: string,
  actual: readonly string[],
): boolean {
  const expected = extractQuotedClause(query, prefix);
  return expected === undefined || actual.includes(expected);
}

function matchesTraceQl(trace: OtlpTrace, query: string): boolean {
  const detail = normalizeOtlpTrace({ traceId: trace.traceId, trace });
  const clauses = [
    matchesScalarClause(query, "resource.service.name = ", detail.rootService),
    matchesScalarClause(
      query,
      "resource.deployment.environment.name = ",
      detail.environment,
    ),
    matchesListClause(query, "span.llm.call_site = ", detail.workloads),
    matchesListClause(query, "span.gen_ai.system = ", detail.providers),
    matchesListClause(query, "span.gen_ai.request.model = ", detail.models),
    matchesScalarClause(query, "span.llm.subject.id = ", detail.subject?.id),
    !query.includes("status = error") || detail.status === "error",
    !query.includes("status = ok") || detail.status === "ok",
  ];
  return clauses.every(Boolean);
}

function toTempoSummary(trace: OtlpTrace): TraceSummary {
  const detail = normalizeOtlpTrace({ traceId: trace.traceId, trace });
  return {
    traceId: trace.traceId,
    rootServiceName: detail.rootService,
    rootTraceName: detail.rootSpanName,
    startedAt: toContractDate(
      Temporal.Instant.fromEpochMilliseconds(Math.round(detail.startedAtMs)),
    ),
    durationMs: detail.durationMs ?? 0,
    spanCount: detail.spanCount,
    errorCount: detail.errorSpanCount,
    environment: detail.environment,
    workloads: detail.workloads,
    providers: detail.providers,
    models: detail.models,
    subject: detail.subject,
    inputTokens: detail.totals.inputTokens,
    outputTokens: detail.totals.outputTokens,
    cachedInputTokens: detail.totals.cachedInputTokens,
  };
}

function formatUtcDateKey(epochMs: number): string {
  const zdt = Temporal.Instant.fromEpochMilliseconds(
    Math.round(epochMs),
  ).toZonedDateTimeISO("UTC");
  const yyyy = String(zdt.year).padStart(4, "0");
  const mm = String(zdt.month).padStart(2, "0");
  const dd = String(zdt.day).padStart(2, "0");
  return `${yyyy}/${mm}/${dd}`;
}

export function createFixtureTracesServerModule(options?: {
  readonly opsIngestToken?: string | undefined;
  readonly now?: (() => number) | undefined;
}): {
  readonly module: ServerModule;
  readonly store: LlmTraceArchiveStore;
} {
  const now = options?.now ?? (() => systemClock.now().epochMilliseconds);
  const seedNowMs = now();
  const store = LlmTraceArchiveStore.open(":memory:");
  const liveTraces = buildLiveFixtureTraces(seedNowMs);
  const liveById = new Map(liveTraces.map((trace) => [trace.traceId, trace]));
  const archiveSeed = buildArchivedIndexSeed(seedNowMs);

  store.ingest({
    rows: archiveSeed.rows,
    watermarks: [
      {
        prefix: "llm/scout-backend/openai",
        lastDateKey: formatUtcDateKey(seedNowMs),
        updatedAtMs: seedNowMs - 180_000,
      },
    ],
  });

  const tempo: TempoPort = {
    health: () => Promise.resolve(true),
    getTrace: (traceId: string) =>
      Promise.resolve(liveById.get(traceId.toLowerCase()) ?? null),
    search: (request): Promise<TraceSearch> => {
      const startMs = request.start.getTime();
      const endMs = request.end.getTime();
      const matching = liveTraces
        .filter((trace) => matchesTraceQl(trace, request.query))
        .map((trace) => toTempoSummary(trace))
        .filter((summary) => {
          const ts = summary.startedAt.getTime();
          return ts >= startMs && ts <= endMs;
        })
        .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());
      const truncated = matching.length > request.limit;
      return Promise.resolve({
        traces: matching.slice(0, request.limit),
        truncated,
      });
    },
  };

  const module = createTracesServerModule({
    store,
    tempo,
    archive: FIXTURE_ARCHIVE_CONFIG,
    archiveReader: (_config, key) => {
      const found = archiveSeed.envelopes.get(key);
      return Promise.resolve(
        found === undefined ? undefined : JSON.stringify(found),
      );
    },
    opsIngestToken:
      options?.opsIngestToken ?? "fixture-ops-ingest-token-with-32-characters",
    now,
  });

  return { module, store };
}
