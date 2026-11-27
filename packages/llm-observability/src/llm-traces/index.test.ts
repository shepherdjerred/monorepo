import { describe, expect, it } from "vitest";
import {
  ArchivedSpanIndexRowSchema,
  LlmArchiveIngestRequestSchema,
  TraceDetailSchema,
  TraceIdTextSchema,
  TracesSearchQuerySchema,
  rangeRequiresArchive,
  traceRangeDurationMs,
} from "./index.ts";

describe("llm-traces schemas", () => {
  it("normalizes 16-char and 32-char hex trace IDs and rejects invalid ones", () => {
    expect(TraceIdTextSchema.parse("  ABCDEF0123456789  ")).toBe(
      "abcdef0123456789",
    );
    expect(TraceIdTextSchema.parse("A".repeat(32))).toBe("a".repeat(32));
    expect(() => TraceIdTextSchema.parse("not-a-trace-id")).toThrow();
  });

  it("maps trace ranges to durations and archive requirement", () => {
    expect(traceRangeDurationMs("1h")).toBe(3_600_000);
    expect(traceRangeDurationMs("365d")).toBe(365 * 86_400_000);
    expect(rangeRequiresArchive("30d")).toBe(false);
    expect(rangeRequiresArchive("90d")).toBe(true);
    expect(rangeRequiresArchive("365d")).toBe(true);
  });

  it("parses search queries with defaults and ingest batches", () => {
    const query = TracesSearchQuerySchema.parse({
      service: "scout-backend",
      limit: "25",
    });
    expect(query).toMatchObject({
      range: "24h",
      service: "scout-backend",
      status: "all",
      limit: 25,
    });

    const row = ArchivedSpanIndexRowSchema.parse({
      s3Key: "llm/scout-backend/openai/2026/11/24/trace1-span1.json.gz",
      traceId: "a".repeat(32),
      spanId: "b".repeat(16),
      capturedAtMs: 1_764_000_000_000,
      service: "scout-backend",
      provider: "openai",
      callSite: "match-review",
      requestModel: "gpt-5.4-mini",
      responseModel: "gpt-5.4-mini-2026-09-01",
      responseId: "resp_123",
      finishReason: "stop",
      inputTokens: 1200,
      outputTokens: 350,
      cacheReadTokens: 800,
      cacheCreationTokens: 0,
      hasToolIo: false,
      bytesCompressed: 912,
      bytesUncompressed: 3410,
    });
    const ingest = LlmArchiveIngestRequestSchema.parse({
      rows: [row],
      watermarks: [
        {
          prefix: "llm/scout-backend/openai",
          lastDateKey: "2026/11/24",
          updatedAtMs: 1_764_000_005_000,
        },
      ],
    });
    expect(ingest.rows).toHaveLength(1);
    expect(ingest.watermarks[0]?.lastDateKey).toBe("2026/11/24");
  });

  it("validates discriminated trajectory items inside TraceDetailSchema", () => {
    const detail = TraceDetailSchema.parse({
      traceId: "f".repeat(32),
      source: "tempo",
      startedAtMs: 1_764_000_000_000,
      durationMs: 420,
      rootService: "scout-backend",
      environment: "prod",
      rootSpanName: "POST /decisions",
      status: "ok",
      spanCount: 2,
      llmCallCount: 1,
      errorSpanCount: 0,
      workloads: ["dare-classifier"],
      providers: ["openai"],
      models: ["gpt-6-luna"],
      subject: { kind: "discord_user", id: "123456" },
      temporalWorkflowId: null,
      totals: {
        inputTokens: 500,
        outputTokens: 0,
        cachedInputTokens: 400,
        cacheCreationTokens: 0,
        reasoningTokens: 0,
        catalogCostUsd: 0.0002,
        notionalSubscriptionUsd: 0,
        hasSubscriptionCalls: false,
      },
      trajectory: [
        {
          shape: "openai-decision",
          spanId: "1".repeat(16),
          parentSpanId: "0".repeat(16),
          spanName: "gen_ai.chat",
          service: "scout-backend",
          workload: "dare-classifier",
          provider: "openai",
          requestedModel: "gpt-6-luna",
          responseModel: "gpt-6-luna",
          responseId: "dec_1",
          finishReasons: [],
          startedAtMs: 1_764_000_000_010,
          durationMs: 400,
          status: "ok",
          errorMessage: null,
          inputTokens: 500,
          outputTokens: 0,
          cachedInputTokens: 400,
          cacheCreationTokens: 0,
          reasoningTokens: 0,
          catalogCostUsd: 0.0002,
          costKind: "metered",
          archiveKey: "llm/scout-backend/openai/2026/11/24/f-1.json.gz",
          systemInstructions: "Judge carefully.",
          decisionInputJson: '{"matchId":"NA1_1"}',
          questionsJson: '[{"name":"valid","type":"predicate"}]',
          answers: [{ type: "predicate", name: "valid", probability: 0.94 }],
        },
      ],
      waterfall: [],
      archiveRefs: [],
    });
    expect(detail.trajectory[0]?.shape).toBe("openai-decision");
  });
});
