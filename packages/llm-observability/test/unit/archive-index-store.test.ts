import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, test } from "vitest";
import { LlmTraceArchiveStore } from "#src/archive-index-store.ts";
import type { ArchivedSpanIndexRow } from "@shepherdjerred/ops-model/llm-traces.ts";

const NOW_MS = 1_790_361_600_000;
const HOUR_MS = 3_600_000;
const openStores: LlmTraceArchiveStore[] = [];

function openMemoryStore(): LlmTraceArchiveStore {
  const store = LlmTraceArchiveStore.open(":memory:");
  openStores.push(store);
  return store;
}

afterEach(() => {
  while (openStores.length > 0) {
    openStores.pop()?.close();
  }
});

function makeSpanRow(
  overrides: Partial<ArchivedSpanIndexRow> & {
    s3Key: string;
    traceId: string;
    spanId: string;
  },
): ArchivedSpanIndexRow {
  return {
    capturedAtMs: NOW_MS - HOUR_MS,
    service: "scout-backend",
    provider: "openai",
    callSite: "match-report",
    requestModel: "openai/gpt-5.4-mini",
    responseModel: "gpt-5.4-mini-2026-03-01",
    responseId: "resp-1",
    finishReason: "stop",
    inputTokens: 100,
    outputTokens: 25,
    cacheReadTokens: 40,
    cacheCreationTokens: 0,
    hasToolIo: false,
    bytesCompressed: 512,
    bytesUncompressed: 1500,
    ...overrides,
  };
}

test("creates nested parent directories on disk, responds to ping, and closes cleanly", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "llm-archive-test-"));
  try {
    const dbPath = path.join(tempRoot, "nested", "dir", "index.sqlite");
    const store = LlmTraceArchiveStore.open(dbPath);
    expect(store.ping()).toBe(true);
    store.ingest({
      rows: [
        makeSpanRow({
          s3Key: "llm/s/o/2026/09/25/t1-s1.json.gz",
          traceId: "00000000000000000000000000000001",
          spanId: "0000000000000001",
        }),
      ],
      watermarks: [
        {
          prefix: "llm/scout-backend/openai",
          lastDateKey: "2026/09/25",
          updatedAtMs: NOW_MS,
        },
      ],
    });
    expect(store.watermarks().totalSpans).toBe(1);
    store.close();
    expect(store.ping()).toBe(false);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("upserts idempotently on s3_key and aggregates multi-span trace rollups", () => {
  const store = openMemoryStore();
  const traceId = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

  const firstIngest = store.ingest({
    rows: [
      makeSpanRow({
        s3Key: "llm/t1-s1.json.gz",
        traceId,
        spanId: "0000000000000001",
        capturedAtMs: NOW_MS - 5000,
        service: "scout-backend",
        provider: "openai",
        callSite: "match-report",
        requestModel: "openai/gpt-5.4-mini",
        inputTokens: 120,
        outputTokens: 30,
        cacheReadTokens: 50,
        hasToolIo: false,
      }),
      makeSpanRow({
        s3Key: "llm/t1-s2.json.gz",
        traceId,
        spanId: "0000000000000002",
        capturedAtMs: NOW_MS - 2000,
        service: "scout-worker",
        provider: "anthropic",
        callSite: "match-critic",
        requestModel: null,
        responseModel: "claude-sonnet-4-6",
        finishReason: "error",
        inputTokens: 200,
        outputTokens: 60,
        cacheReadTokens: 10,
        cacheCreationTokens: 20,
        hasToolIo: true,
      }),
    ],
    watermarks: [],
  });

  expect(firstIngest).toEqual({
    upsertedSpans: 2,
    updatedTraces: 1,
    prunedSpans: 0,
  });

  store.ingest({
    rows: [
      makeSpanRow({
        s3Key: "llm/t1-s1.json.gz",
        traceId,
        spanId: "0000000000000001",
        capturedAtMs: NOW_MS - 5000,
        service: "scout-backend",
        provider: "openai",
        callSite: "match-report",
        requestModel: "openai/gpt-5.4-mini",
        inputTokens: 150,
        outputTokens: 40,
        cacheReadTokens: 50,
        hasToolIo: false,
      }),
    ],
    watermarks: [],
  });

  const spans = store.spansForTrace(traceId);
  expect(spans.map((s) => s.spanId)).toEqual([
    "0000000000000001",
    "0000000000000002",
  ]);

  const summaryMap = store.summariesByTraceIds([traceId, "missing"]);
  expect(summaryMap.size).toBe(1);
  expect(summaryMap.get(traceId)).toEqual({
    traceId,
    source: "archive",
    startedAtMs: NOW_MS - 5000,
    durationMs: 3000,
    spanCount: 2,
    errorCount: 1,
    service: "scout-backend",
    environment: null,
    rootSpanName: "match-report",
    workloads: ["match-report", "match-critic"],
    providers: ["openai", "anthropic"],
    models: ["openai/gpt-5.4-mini", "claude-sonnet-4-6"],
    subject: null,
    inputTokens: 350,
    outputTokens: 100,
    cachedInputTokens: 60,
    hasToolIo: true,
  });
});

test("advances watermarks monotonically per prefix", () => {
  const store = openMemoryStore();

  store.ingest({
    rows: [],
    watermarks: [
      {
        prefix: "llm/birmel/openai",
        lastDateKey: "2026/09/20",
        updatedAtMs: 1000,
      },
    ],
  });
  store.ingest({
    rows: [],
    watermarks: [
      {
        prefix: "llm/birmel/openai",
        lastDateKey: "2026/09/18",
        updatedAtMs: 900,
      },
    ],
  });
  expect(store.watermarks().watermarks).toEqual([
    {
      prefix: "llm/birmel/openai",
      lastDateKey: "2026/09/20",
      updatedAtMs: 1000,
    },
  ]);

  store.ingest({
    rows: [],
    watermarks: [
      {
        prefix: "llm/birmel/openai",
        lastDateKey: "2026/09/25",
        updatedAtMs: 2500,
      },
    ],
  });
  expect(store.watermarks().watermarks).toEqual([
    {
      prefix: "llm/birmel/openai",
      lastDateKey: "2026/09/25",
      updatedAtMs: 2500,
    },
  ]);
});

test("prunes spans older than retentionCutoffMs and deletes empty trace rollups", () => {
  const store = openMemoryStore();
  const expiredTrace = "11111111111111111111111111111111";
  const partialTrace = "22222222222222222222222222222222";

  store.ingest({
    rows: [
      makeSpanRow({
        s3Key: "old-only",
        traceId: expiredTrace,
        spanId: "s1",
        capturedAtMs: 1000,
        inputTokens: 50,
      }),
      makeSpanRow({
        s3Key: "partial-old",
        traceId: partialTrace,
        spanId: "s1",
        capturedAtMs: 1500,
        inputTokens: 70,
      }),
      makeSpanRow({
        s3Key: "partial-fresh",
        traceId: partialTrace,
        spanId: "s2",
        capturedAtMs: 5000,
        inputTokens: 90,
      }),
    ],
    watermarks: [],
  });

  const pruneRes = store.ingest({
    rows: [],
    watermarks: [],
    retentionCutoffMs: 2000,
  });

  expect(pruneRes).toEqual({
    upsertedSpans: 0,
    updatedTraces: 2,
    prunedSpans: 2,
  });
  expect(store.watermarks().totalTraces).toBe(1);
  expect(store.watermarks().totalSpans).toBe(1);
  expect(store.summariesByTraceIds([expiredTrace]).size).toBe(0);
  expect(
    store.summariesByTraceIds([partialTrace]).get(partialTrace)?.inputTokens,
  ).toBe(90);
});

test("filters searchTraces, paginates with keyset cursor, and computes facets", () => {
  const store = openMemoryStore();

  store.ingest({
    rows: [
      makeSpanRow({
        s3Key: "k1",
        traceId: "trace-alpha",
        spanId: "s1",
        capturedAtMs: NOW_MS - 30 * 60_000,
        service: "birmel",
        provider: "claude_code_sdk",
        callSite: "discord.reply",
        requestModel: "claude-sonnet-4-6",
        finishReason: "stop",
      }),
      makeSpanRow({
        s3Key: "k2",
        traceId: "trace-beta",
        spanId: "s1",
        capturedAtMs: NOW_MS - 20 * 60_000,
        service: "scout-backend",
        provider: "openai",
        callSite: "scout.report",
        requestModel: "openai/gpt-5.4-mini",
        finishReason: "error",
      }),
      makeSpanRow({
        s3Key: "k3",
        traceId: "trace-gamma",
        spanId: "s1",
        capturedAtMs: NOW_MS - 20 * 60_000,
        service: "temporal",
        provider: "codex_sdk",
        callSite: "agent.run",
        requestModel: "gpt-5.6-luna",
        finishReason: "stop",
      }),
      makeSpanRow({
        s3Key: "k4",
        traceId: "trace-ancient",
        spanId: "s1",
        capturedAtMs: NOW_MS - 10 * 24 * HOUR_MS,
        service: "legacy-svc",
        provider: "google",
        callSite: "old.job",
        requestModel: "gemini-2.5-pro",
      }),
    ],
    watermarks: [
      {
        prefix: "llm/birmel",
        lastDateKey: "2026/09/25",
        updatedAtMs: NOW_MS - 1000,
      },
    ],
  });

  const page1 = store.searchTraces(
    { range: "24h", status: "all", limit: 2 },
    NOW_MS,
  );
  expect(page1.items.map((i) => i.traceId)).toEqual([
    "trace-gamma",
    "trace-beta",
  ]);
  expect(page1.truncated).toBe(true);
  expect(page1.nextCursor).not.toBeNull();

  const page2 = store.searchTraces(
    {
      range: "24h",
      status: "all",
      limit: 2,
      cursor: page1.nextCursor ?? undefined,
    },
    NOW_MS,
  );
  expect(page2.items.map((i) => i.traceId)).toEqual(["trace-alpha"]);
  expect(page2.truncated).toBe(false);
  expect(page2.nextCursor).toBeNull();

  expect(
    store
      .searchTraces(
        { range: "30d", service: "scout-backend", status: "error", limit: 10 },
        NOW_MS,
      )
      .items.map((i) => i.traceId),
  ).toEqual(["trace-beta"]);

  expect(
    store
      .searchTraces(
        { range: "30d", workload: "agent.run", status: "ok", limit: 10 },
        NOW_MS,
      )
      .items.map((i) => i.traceId),
  ).toEqual(["trace-gamma"]);

  expect(
    store
      .searchTraces(
        {
          range: "30d",
          provider: "google",
          model: "gemini-2.5-pro",
          status: "all",
          limit: 10,
        },
        NOW_MS,
      )
      .items.map((i) => i.traceId),
  ).toEqual(["trace-ancient"]);

  expect(
    store
      .searchTraces(
        { range: "30d", q: "SONNET", status: "all", limit: 10 },
        NOW_MS,
      )
      .items.map((i) => i.traceId),
  ).toEqual(["trace-alpha"]);

  expect(store.facets(NOW_MS - 24 * HOUR_MS, NOW_MS)).toEqual({
    indexedTraces: 4,
    indexedSpans: 4,
    latestWatermarkUpdatedAtMs: NOW_MS - 1000,
    services: ["birmel", "scout-backend", "temporal"],
    workloads: ["agent.run", "discord.reply", "scout.report"],
    providers: ["claude_code_sdk", "codex_sdk", "openai"],
    models: ["claude-sonnet-4-6", "gpt-5.6-luna", "openai/gpt-5.4-mini"],
  });
});
