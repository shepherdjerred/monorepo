import { Temporal } from "@js-temporal/polyfill";
import type { ArchiveConfig } from "@shepherdjerred/llm-observability";
import { LlmTraceArchiveStore } from "@shepherdjerred/llm-observability/archive-index";
import { UpstreamError } from "@shepherdjerred/ops-clients/http.ts";
import {
  LlmArchiveIngestResponseSchema,
  LlmArchiveWatermarksResponseSchema,
  TraceDetailSchema,
  TracesFacetsResponseSchema,
  TracesSearchResponseSchema,
} from "@shepherdjerred/llm-observability/llm-traces";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { mountModules, type ServerModule } from "#server/platform/module";
import { toContractDate } from "#shared/time";

import { FIXTURE_TRACE_IDS } from "./fixtures-data.ts";
import { createFixtureTracesServerModule } from "./fixtures.ts";
import { createTracesServerModule, type TempoPort } from "./server.ts";

const TEST_TOKEN = "test-ops-ingest-token-with-32-characters";
const NOW_MS = Temporal.Instant.from("2026-11-24T20:00:00Z").epochMilliseconds;

const TEST_ARCHIVE_CONFIG: ArchiveConfig = {
  bucket: "llm-archive",
  prefix: "llm",
  region: "us-east-1",
  endpoint: "http://seaweedfs.local:8333",
  accessKeyId: "ak",
  secretAccessKey: "sk",
  forcePathStyle: true,
};

function buildTestApp(mod: ServerModule): Hono {
  const app = new Hono();
  mountModules(app, [mod]);
  app.onError((err, ctx) =>
    err instanceof z.ZodError
      ? ctx.json({ error: "Invalid request" }, 400)
      : ctx.json({ error: "Internal server error" }, 500),
  );
  return app;
}

async function getJson(app: Hono, path: string): Promise<unknown> {
  const response = await app.request(path);
  return response.json();
}

async function getStatus(app: Hono, path: string): Promise<number> {
  const response = await app.request(path);
  return response.status;
}

describe("createTracesServerModule auth and ingest", () => {
  it("guards internal watermarks and ingest endpoints with bearer auth and persists rows", async () => {
    const store = LlmTraceArchiveStore.open(":memory:");
    const mod = createTracesServerModule({
      store,
      tempo: null,
      archive: TEST_ARCHIVE_CONFIG,
      opsIngestToken: TEST_TOKEN,
      now: () => NOW_MS,
    });
    const app = buildTestApp(mod);

    const unauthWm = await app.request("/api/traces/internal/watermarks");
    expect(unauthWm.status).toBe(401);

    const unauthIngest = await app.request("/api/traces/internal/ingest", {
      method: "POST",
      headers: { authorization: "Bearer wrong-token" },
      body: JSON.stringify({ rows: [] }),
    });
    expect(unauthIngest.status).toBe(401);

    const badJson = await app.request("/api/traces/internal/ingest", {
      method: "POST",
      headers: { authorization: `Bearer ${TEST_TOKEN}` },
      body: "{broken",
    });
    expect(badJson.status).toBe(400);

    const traceId = "abcdef0123456789abcdef0123456789";
    const ingestRes = await app.request("/api/traces/internal/ingest", {
      method: "POST",
      headers: {
        authorization: `Bearer ${TEST_TOKEN}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        rows: [
          {
            s3Key: `llm/scout-backend/openai/2026/11/24/${traceId}-span1.json.gz`,
            traceId,
            spanId: "span1",
            capturedAtMs: NOW_MS - 10_000,
            service: "scout-backend",
            provider: "openai",
            callSite: "match-review",
            requestModel: "gpt-5.4",
            responseModel: "gpt-5.4",
            responseId: "resp_1",
            finishReason: "stop",
            inputTokens: 500,
            outputTokens: 120,
            cacheReadTokens: 256,
            cacheCreationTokens: 0,
            hasToolIo: true,
            bytesCompressed: 400,
            bytesUncompressed: 1200,
          },
        ],
        watermarks: [
          {
            prefix: "llm/scout-backend/openai",
            lastDateKey: "2026/11/24",
            updatedAtMs: NOW_MS - 5000,
          },
        ],
      }),
    });
    expect(ingestRes.status).toBe(202);
    const ingestBody = LlmArchiveIngestResponseSchema.parse(
      await ingestRes.json(),
    );
    expect(ingestBody).toEqual({
      upsertedSpans: 1,
      updatedTraces: 1,
      prunedSpans: 0,
    });

    const wmRes = await app.request("/api/traces/internal/watermarks", {
      headers: { authorization: `Bearer ${TEST_TOKEN}` },
    });
    expect(wmRes.status).toBe(200);
    const wmBody = LlmArchiveWatermarksResponseSchema.parse(await wmRes.json());
    expect(wmBody.totalTraces).toBe(1);
    expect(wmBody.totalSpans).toBe(1);
    expect(wmBody.watermarks).toHaveLength(1);

    const facets = TracesFacetsResponseSchema.parse(
      await getJson(app, "/api/traces/facets?range=24h"),
    );
    expect(facets.tempoAvailable).toBe(false);
    expect(facets.archiveConfigured).toBe(true);
    expect(facets.indexedTraces).toBe(1);
    expect(facets.services).toEqual(["scout-backend"]);
    expect(facets.workloads).toEqual(["match-review"]);

    await mod.close?.();
  });

  it("maps Tempo UpstreamError failures to HTTP 502", async () => {
    const store = LlmTraceArchiveStore.open(":memory:");
    const failingTempo: TempoPort = {
      health: () => Promise.resolve(false),
      search: () => Promise.reject(new UpstreamError("tempo", "HTTP 503", 503)),
      getTrace: () =>
        Promise.reject(new UpstreamError("tempo", "HTTP 503", 503)),
    };
    const mod = createTracesServerModule({
      store,
      tempo: failingTempo,
      opsIngestToken: TEST_TOKEN,
      now: () => NOW_MS,
    });
    const app = buildTestApp(mod);

    const searchRes = await app.request("/api/traces/search?range=1h");
    expect(searchRes.status).toBe(502);

    const detailRes = await app.request(
      `/api/traces/${FIXTURE_TRACE_IDS.aiSdkChat}`,
    );
    expect(detailRes.status).toBe(502);

    const readyRes = await app.request("/readyz/traces");
    expect(readyRes.status).toBe(503);

    await mod.close?.();
  });
});

describe("traces hydration, archive fallback, and fixtures", () => {
  it("hydrates missing Tempo span bodies and falls back to archive when Tempo 404s", async () => {
    const store = LlmTraceArchiveStore.open(":memory:");
    const tempoTraceId = "11112222333344445555666677778888";
    const archiveTraceId = "9999aaaabbbbccccddddeeeeffff0000";
    const tempoHydrateKey = `llm/svc/openai/2026/11/24/${tempoTraceId}-s1.json.gz`;
    const archiveMissingKey = `llm/svc/openai/2026/08/01/${archiveTraceId}-s2.json.gz`;

    store.ingest({
      rows: [
        {
          s3Key: archiveMissingKey,
          traceId: archiveTraceId,
          spanId: "s2",
          capturedAtMs: NOW_MS - 60 * 86_400_000,
          service: "scout-backend",
          provider: "openai",
          callSite: "old-digest",
          requestModel: "gpt-5.4",
          responseModel: "gpt-5.4",
          responseId: null,
          finishReason: "stop",
          inputTokens: 300,
          outputTokens: 80,
          cacheReadTokens: 0,
          cacheCreationTokens: 0,
          hasToolIo: false,
          bytesCompressed: 200,
          bytesUncompressed: 600,
        },
      ],
      watermarks: [],
    });

    const tempo: TempoPort = {
      health: () => Promise.resolve(true),
      search: () =>
        Promise.resolve({
          traces: [
            {
              traceId: tempoTraceId,
              rootServiceName: "scout-backend",
              rootTraceName: "gen_ai.chat",
              startedAt: toContractDate(
                Temporal.Instant.fromEpochMilliseconds(NOW_MS - 60_000),
              ),
              durationMs: 420,
            },
          ],
          truncated: false,
        }),
      getTrace: (id) =>
        id === tempoTraceId
          ? Promise.resolve({
              traceId: tempoTraceId,
              spans: [
                {
                  traceId: tempoTraceId,
                  spanId: "s1",
                  parentSpanId: null,
                  name: "gen_ai.chat",
                  startTimeUnixNano: `${String(NOW_MS - 60_000)}000000`,
                  endTimeUnixNano: `${String(NOW_MS - 59_580)}000000`,
                  status: "ok",
                  statusMessage: null,
                  serviceName: "scout-backend",
                  scopeName: "ai",
                  resourceAttributes: { "service.name": "scout-backend" },
                  attributes: {
                    "gen_ai.system": "openai",
                    "llm.service": "scout-backend",
                    "llm.call_site": "hydrated-review",
                    "gen_ai.request.model": "gpt-5.4",
                    "gen_ai.usage.input_tokens": 110,
                    "gen_ai.usage.output_tokens": 45,
                    "llm.archive.s3_key": tempoHydrateKey,
                  },
                  events: [],
                },
              ],
            })
          : Promise.resolve(null),
    };

    const mod = createTracesServerModule({
      store,
      tempo,
      archive: TEST_ARCHIVE_CONFIG,
      archiveReader: (_cfg, key) =>
        Promise.resolve(
          key === tempoHydrateKey
            ? JSON.stringify({
                "gen_ai.input.messages": [
                  { role: "user", content: "Hydrated prompt from S3" },
                ],
                "gen_ai.output.messages": [
                  { role: "assistant", content: "Hydrated response from S3" },
                ],
              })
            : undefined,
        ),
      opsIngestToken: TEST_TOKEN,
      now: () => NOW_MS,
    });
    const app = buildTestApp(mod);

    expect(await getStatus(app, "/api/traces/not-hex")).toBe(400);
    expect(
      await getStatus(app, "/api/traces/00000000000000000000000000000000"),
    ).toBe(404);

    const hydrated = TraceDetailSchema.parse(
      await getJson(app, `/api/traces/${tempoTraceId}`),
    );
    expect(hydrated.source).toBe("tempo");
    expect(hydrated.trajectory[0]?.shape).toBe("ai-sdk-chat");
    if (hydrated.trajectory[0]?.shape === "ai-sdk-chat") {
      expect(hydrated.trajectory[0].messages[0]?.parts[0]).toEqual({
        kind: "text",
        text: "Hydrated prompt from S3",
      });
    }

    const archived = TraceDetailSchema.parse(
      await getJson(app, `/api/traces/${archiveTraceId}`),
    );
    expect(archived.source).toBe("archive");
    expect(archived.totals.inputTokens).toBe(300);
    expect(archived.workloads).toEqual(["old-digest"]);

    const range90 = TracesSearchResponseSchema.parse(
      await getJson(app, "/api/traces/search?range=90d"),
    );
    expect(range90.source).toBe("archive");
    expect(range90.items.map((i) => i.traceId)).toContain(archiveTraceId);

    expect(await getStatus(app, "/readyz/traces")).toBe(200);
    await mod.close?.();
    expect(await getStatus(app, "/readyz/traces")).toBe(503);
  });

  it("seeds all 6 realistic fixture traces across Tempo and 365d Archive", async () => {
    const { module } = createFixtureTracesServerModule({
      opsIngestToken: TEST_TOKEN,
      now: () => NOW_MS,
    });
    const app = buildTestApp(module);

    const liveSearch = TracesSearchResponseSchema.parse(
      await getJson(app, "/api/traces/search?range=24h"),
    );
    expect(liveSearch.source).toBe("tempo");
    expect(liveSearch.items).toHaveLength(5);

    const archiveSearch = TracesSearchResponseSchema.parse(
      await getJson(app, "/api/traces/search?source=archive&range=365d"),
    );
    expect(archiveSearch.source).toBe("archive");
    expect(archiveSearch.items).toHaveLength(6);

    const chatDetail = TraceDetailSchema.parse(
      await getJson(app, `/api/traces/${FIXTURE_TRACE_IDS.aiSdkChat}`),
    );
    expect(
      chatDetail.trajectory.some(
        (item) => item.shape === "ai-sdk-chat" && item.isRepairAttempt,
      ),
    ).toBe(true);

    const decisionDetail = TraceDetailSchema.parse(
      await getJson(app, `/api/traces/${FIXTURE_TRACE_IDS.openAiDecision}`),
    );
    expect(decisionDetail.trajectory[0]?.shape).toBe("openai-decision");

    const claudeDetail = TraceDetailSchema.parse(
      await getJson(app, `/api/traces/${FIXTURE_TRACE_IDS.claudeAgent}`),
    );
    expect(claudeDetail.trajectory[0]?.shape).toBe("claude-agent");
    expect(claudeDetail.temporalWorkflowId).toBe("pr-remediation-5041");
    expect(claudeDetail.totals.hasSubscriptionCalls).toBe(true);
    expect(claudeDetail.totals.catalogCostUsd).toBe(0);
    expect(claudeDetail.totals.notionalSubscriptionUsd).toBeCloseTo(0.18);

    const codexDetail = TraceDetailSchema.parse(
      await getJson(app, `/api/traces/${FIXTURE_TRACE_IDS.codexAgent}`),
    );
    expect(codexDetail.trajectory[0]?.shape).toBe("codex-agent");
    if (codexDetail.trajectory[0]?.shape === "codex-agent") {
      expect(codexDetail.trajectory[0].turns).toHaveLength(2);
      expect(codexDetail.trajectory[0].commands.map((c) => c.exitCode)).toEqual(
        [0, 1],
      );
    }

    const archiveOnlyDetail = TraceDetailSchema.parse(
      await getJson(app, `/api/traces/${FIXTURE_TRACE_IDS.archiveOnlyDigest}`),
    );
    expect(archiveOnlyDetail.source).toBe("archive");
    expect(archiveOnlyDetail.trajectory.map((t) => t.shape)).toEqual([
      "ai-sdk-embed",
      "ai-sdk-chat",
    ]);

    await module.close?.();
  });
});
