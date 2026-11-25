import { gzipSync } from "node:zlib";
import {
  ListObjectsV2Command,
  type GetObjectCommand,
} from "@aws-sdk/client-s3";
import { describe, expect, it } from "vitest";
import {
  LlmArchiveIngestRequestSchema,
  type ArchiveWatermark,
  type LlmArchiveIngestRequest,
} from "@shepherdjerred/ops-model/llm-traces.ts";
import {
  computeStartDateKey,
  runLlmArchiveIndexSync,
  utcDateKey,
  type LlmArchiveFetch,
} from "./llm-archive-index.ts";
import type {
  LlmArchiveS3Sender,
  S3GetOutput,
  S3ListOutput,
} from "./llm-archive-s3.ts";

const TEST_ENV = {
  OPS_DASHBOARD_URL: "http://alert-dashboard.alert-dashboard:7341",
  OPS_INGEST_TOKEN: "test-ingest-token",
  LLM_ARCHIVE_S3_BUCKET: "llm-archive",
  LLM_ARCHIVE_S3_PREFIX: "llm",
  S3_ENDPOINT: "http://seaweedfs-s3.seaweedfs:8333",
  AWS_ACCESS_KEY_ID: "test-key",
  AWS_SECRET_ACCESS_KEY: "test-secret",
} as const;

const FIXED_NOW_ISO = "2026-11-25T03:00:00.000Z";
const FIXED_NOW_MS = Date.parse(FIXED_NOW_ISO);

function fixedNow(): Date {
  return new Date(FIXED_NOW_ISO);
}

function buildGzipEnvelope(
  overrides: Record<string, unknown> = {},
): Uint8Array {
  const payload = {
    v: 1,
    traceId: "a".repeat(32),
    spanId: "b".repeat(16),
    capturedAt: "2026-11-24T12:00:00.000Z",
    service: "scout-backend",
    provider: "openai",
    callSite: "match-review",
    request: {
      model: "gpt-5.4-mini",
      maxTokens: 1024,
    },
    response: {
      model: "gpt-5.4-mini-2026-09-01",
      id: "resp_1",
      finishReasons: ["stop"],
    },
    usage: {
      inputTokens: 1200,
      outputTokens: 300,
      cacheReadInputTokens: 800,
      cacheCreationInputTokens: 0,
    },
    "gen_ai.input.messages": [
      { role: "user", content: "Explain this lane matchup." },
    ],
    "gen_ai.output.messages": [
      { role: "assistant", content: "Play around level 3 spike." },
    ],
    ...overrides,
  };
  return gzipSync(Buffer.from(JSON.stringify(payload), "utf8"));
}

function simulateListObjects(
  objects: ReadonlyMap<string, Uint8Array>,
  command: ListObjectsV2Command,
): S3ListOutput {
  const prefix = command.input.Prefix ?? "";
  const delimiter = command.input.Delimiter;
  const startAfter = command.input.StartAfter;
  const matchingKeys = [...objects.keys()]
    .filter(
      (key) =>
        key.startsWith(prefix) &&
        (startAfter === undefined || key > startAfter),
    )
    .toSorted();

  if (delimiter !== "/") {
    return {
      Contents: matchingKeys.map((key) => ({ Key: key })),
      IsTruncated: false,
    };
  }

  const commonSet = new Set<string>();
  const contents: { Key: string }[] = [];
  for (const key of matchingKeys) {
    const rest = key.slice(prefix.length);
    const slashIdx = rest.indexOf("/");
    if (slashIdx === -1) {
      contents.push({ Key: key });
    } else {
      commonSet.add(`${prefix}${rest.slice(0, slashIdx + 1)}`);
    }
  }
  return {
    CommonPrefixes: [...commonSet].toSorted().map((p) => ({ Prefix: p })),
    Contents: contents,
    IsTruncated: false,
  };
}

function createFakeS3(objects: ReadonlyMap<string, Uint8Array>): {
  s3: LlmArchiveS3Sender;
  maxConcurrentGets: () => number;
} {
  let activeGets = 0;
  let peakGets = 0;

  const s3: LlmArchiveS3Sender = {
    send: async (
      command: ListObjectsV2Command | GetObjectCommand,
    ): Promise<S3ListOutput & S3GetOutput> => {
      if (command instanceof ListObjectsV2Command) {
        return simulateListObjects(objects, command);
      }

      activeGets += 1;
      peakGets = Math.max(peakGets, activeGets);
      await Promise.resolve();
      activeGets -= 1;

      const bytes = objects.get(command.input.Key ?? "");
      if (bytes === undefined) {
        return {};
      }
      return {
        Body: {
          transformToByteArray: () => Promise.resolve(bytes),
        },
      };
    },
  };

  return { s3, maxConcurrentGets: () => peakGets };
}

function createFakeHub(initialWatermarks: ArchiveWatermark[] = []) {
  const watermarks = new Map<string, ArchiveWatermark>(
    initialWatermarks.map((wm) => [wm.prefix, wm]),
  );
  const batches: LlmArchiveIngestRequest[] = [];
  const authHeaders: string[] = [];

  const fetchImpl: LlmArchiveFetch = (url, init) => {
    const headers = new Headers(init?.headers);
    authHeaders.push(headers.get("authorization") ?? "");

    if (url.endsWith("/api/traces/internal/watermarks")) {
      return Promise.resolve(
        Response.json({
          watermarks: [...watermarks.values()],
          totalSpans: 0,
          totalTraces: 0,
        }),
      );
    }

    if (url.endsWith("/api/traces/internal/ingest")) {
      const rawBody = typeof init?.body === "string" ? init.body : "{}";
      const parsed = LlmArchiveIngestRequestSchema.parse(JSON.parse(rawBody));
      batches.push(parsed);
      for (const wm of parsed.watermarks) {
        watermarks.set(wm.prefix, wm);
      }
      return Promise.resolve(
        Response.json({
          upsertedSpans: parsed.rows.length,
          updatedTraces: parsed.rows.length,
          prunedSpans: parsed.retentionCutoffMs === undefined ? 0 : 3,
        }),
      );
    }

    return Promise.resolve(new Response("not found", { status: 404 }));
  };

  return { fetchImpl, batches, watermarks, authHeaders };
}

describe("computeStartDateKey", () => {
  it("uses lookbackDays when explicitly provided", () => {
    expect(
      computeStartDateKey({
        nowMs: FIXED_NOW_MS,
        lookbackDays: 365,
        watermark: {
          prefix: "llm/scout-backend/openai",
          lastDateKey: "2026/11/25",
          updatedAtMs: FIXED_NOW_MS,
        },
      }),
    ).toBe(utcDateKey(FIXED_NOW_MS - 365 * 86_400_000));
  });

  it("re-checks yesterday and today UTC when watermark is at today", () => {
    expect(
      computeStartDateKey({
        nowMs: FIXED_NOW_MS,
        watermark: {
          prefix: "llm/scout-backend/openai",
          lastDateKey: "2026/11/25",
          updatedAtMs: FIXED_NOW_MS,
        },
      }),
    ).toBe("2026/11/24");
  });

  it("starts from watermark.lastDateKey when watermark is older than yesterday", () => {
    expect(
      computeStartDateKey({
        nowMs: FIXED_NOW_MS,
        watermark: {
          prefix: "llm/scout-backend/openai",
          lastDateKey: "2026/11/10",
          updatedAtMs: FIXED_NOW_MS,
        },
      }),
    ).toBe("2026/11/10");
  });

  it("defaults to 7-day lookback when no watermark exists", () => {
    expect(computeStartDateKey({ nowMs: FIXED_NOW_MS })).toBe("2026/11/18");
  });
});

describe("runLlmArchiveIndexSync", () => {
  it("indexes v1 envelopes, detects tool I/O, skips malformed objects with warnings, and batches by 200", async () => {
    const objects = new Map<string, Uint8Array>();
    objects.set(
      "llm/scout-backend/openai/2026/05/01/oldtrace-oldspan.json.gz",
      buildGzipEnvelope({ traceId: "0".repeat(32), spanId: "0".repeat(16) }),
    );

    for (let i = 0; i < 205; i += 1) {
      const hex = i.toString(16).padStart(16, "0");
      const day = i < 150 ? "2026/11/24" : "2026/11/25";
      objects.set(
        `llm/scout-backend/openai/${day}/${"a".repeat(32)}-${hex}.json.gz`,
        buildGzipEnvelope({
          spanId: hex,
          ...(i === 0
            ? {
                "gen_ai.tool.stdout": "ok\n",
                response: {
                  model: "gpt-5.4-mini",
                  id: "resp_tool",
                  finishReasons: ["tool_calls"],
                },
              }
            : {}),
        }),
      );
    }

    objects.set(
      "llm/scout-backend/openai/2026/11/25/corrupt-gzip.json.gz",
      new Uint8Array([1, 2, 3, 4]),
    );
    objects.set(
      "llm/scout-backend/openai/2026/11/25/v2-unknown.json.gz",
      gzipSync(Buffer.from(JSON.stringify({ v: 2, traceId: "x" }), "utf8")),
    );

    const warnings: { message: string; fields?: Record<string, unknown> }[] =
      [];
    const heartbeats: Record<string, unknown>[] = [];
    const { s3, maxConcurrentGets } = createFakeS3(objects);
    const hub = createFakeHub();

    const result = await runLlmArchiveIndexSync(
      {},
      {
        s3,
        fetchImpl: hub.fetchImpl,
        env: TEST_ENV,
        now: fixedNow,
        heartbeat: (details) => heartbeats.push(details),
        logger: (level, message, fields) => {
          if (level === "warning") {
            warnings.push({
              message,
              ...(fields === undefined ? {} : { fields }),
            });
          }
        },
      },
    );

    expect(result).toEqual({
      scannedObjects: 207,
      upsertedSpans: 205,
      prunedSpans: 3,
      hasMore: false,
    });
    expect(maxConcurrentGets()).toBeLessThanOrEqual(8);
    expect(warnings).toHaveLength(2);
    expect(hub.authHeaders.every((h) => h === "Bearer test-ingest-token")).toBe(
      true,
    );

    expect(hub.batches).toHaveLength(2);
    expect(hub.batches[0]?.rows).toHaveLength(200);
    expect(hub.batches[0]?.retentionCutoffMs).toBeUndefined();
    expect(hub.batches[1]?.rows).toHaveLength(5);
    expect(hub.batches[1]?.retentionCutoffMs).toBe(
      FIXED_NOW_MS - 366 * 86_400_000,
    );
    expect(heartbeats).toHaveLength(2);

    const firstRow = hub.batches[0]?.rows[0];
    expect(firstRow?.hasToolIo).toBe(true);
    expect(firstRow?.cacheReadTokens).toBe(800);
    expect(firstRow?.finishReason).toBe("tool_calls");
    expect(hub.watermarks.get("llm/scout-backend/openai")?.lastDateKey).toBe(
      "2026/11/25",
    );
  });

  it("does not advance a day's watermark when maxObjectsPerRun stops mid-day, then finishes cleanly on next run", async () => {
    const objects = new Map<string, Uint8Array>();
    for (let i = 0; i < 3; i += 1) {
      const spanId = `${String(i)}${"b".repeat(15)}`;
      objects.set(
        `llm/birmel/anthropic/2026/11/24/${"c".repeat(32)}-${spanId}.json.gz`,
        buildGzipEnvelope({
          service: "birmel",
          provider: "anthropic",
          spanId,
        }),
      );
    }
    for (let i = 0; i < 3; i += 1) {
      const spanId = `${String(i)}${"d".repeat(15)}`;
      objects.set(
        `llm/birmel/anthropic/2026/11/25/${"e".repeat(32)}-${spanId}.json.gz`,
        buildGzipEnvelope({
          service: "birmel",
          provider: "anthropic",
          spanId,
        }),
      );
    }

    const { s3 } = createFakeS3(objects);
    const hub = createFakeHub();

    const first = await runLlmArchiveIndexSync(
      { maxObjectsPerRun: 4 },
      { s3, fetchImpl: hub.fetchImpl, env: TEST_ENV, now: fixedNow },
    );

    expect(first.scannedObjects).toBe(4);
    expect(first.upsertedSpans).toBe(4);
    expect(first.hasMore).toBe(true);
    expect(hub.watermarks.get("llm/birmel/anthropic")?.lastDateKey).toBe(
      "2026/11/24",
    );

    const second = await runLlmArchiveIndexSync(
      { maxObjectsPerRun: 10 },
      { s3, fetchImpl: hub.fetchImpl, env: TEST_ENV, now: fixedNow },
    );

    expect(second).toEqual({
      scannedObjects: 6,
      upsertedSpans: 6,
      prunedSpans: 3,
      hasMore: false,
    });
    expect(hub.watermarks.get("llm/birmel/anthropic")?.lastDateKey).toBe(
      "2026/11/25",
    );
  });

  it("backfills 365 days across cursor continuations", async () => {
    const objects = new Map<string, Uint8Array>();
    objects.set(
      "llm/arcade/openai/2025/12/01/t1-s1.json.gz",
      buildGzipEnvelope({
        service: "arcade",
        provider: "openai",
        spanId: "1".repeat(16),
      }),
    );
    objects.set(
      "llm/arcade/openai/2026/06/15/t2-s2.json.gz",
      buildGzipEnvelope({
        service: "arcade",
        provider: "openai",
        spanId: "2".repeat(16),
      }),
    );

    const { s3 } = createFakeS3(objects);
    const hub = createFakeHub([
      {
        prefix: "llm/arcade/openai",
        lastDateKey: "2026/11/25",
        updatedAtMs: FIXED_NOW_MS,
      },
    ]);

    const chunk1 = await runLlmArchiveIndexSync(
      { lookbackDays: 365, maxObjectsPerRun: 1 },
      { s3, fetchImpl: hub.fetchImpl, env: TEST_ENV, now: fixedNow },
    );
    expect(chunk1.hasMore).toBe(true);
    expect(chunk1.scannedObjects).toBe(1);

    const chunk2 = await runLlmArchiveIndexSync(
      {
        lookbackDays: 365,
        maxObjectsPerRun: 10,
        cursor: chunk1.nextCursor,
      },
      { s3, fetchImpl: hub.fetchImpl, env: TEST_ENV, now: fixedNow },
    );
    expect(chunk2).toEqual({
      scannedObjects: 1,
      upsertedSpans: 1,
      prunedSpans: 3,
      hasMore: false,
    });
  });
});
