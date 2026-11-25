import { describe, expect, test } from "vitest";
import {
  buildLlmTraceQl,
  errorTraceQuery,
  slowTraceQuery,
  TempoClient,
} from "@shepherdjerred/ops-clients/tempo.ts";
import {
  fakeFetch,
  sequence,
} from "@shepherdjerred/ops-clients/test-support/fake-fetch.ts";

const start = new Date("2026-09-25T18:00:00Z");
const end = new Date("2026-09-25T19:00:00Z");

function slowTrace(id: string) {
  return {
    traceID: id,
    rootServiceName: "birmel",
    startTimeUnixNano: "1790361600000000000",
    durationMs: 6000,
  };
}

describe("TempoClient.search", () => {
  test("searches TraceQL and parses basic trace summaries", async () => {
    const { fetch, requests } = sequence({
      traces: [
        {
          traceID: "1c3b6f19abcd",
          rootServiceName: "openai",
          rootTraceName: "LLM Generation",
          startTimeUnixNano: "1790361600000000000",
          durationMs: 400,
        },
        {
          traceID: "5c9073e9abcd",
          startTimeUnixNano: "1790361660000000000",
        },
      ],
      metrics: { completedJobs: 5 },
    });
    const client = new TempoClient({ baseUrl: "http://tempo:3200", fetch });

    const result = await client.search({
      query: errorTraceQuery(),
      start,
      end,
      limit: 10,
    });

    expect(result).toEqual({
      traces: [
        {
          traceId: "1c3b6f19abcd",
          rootServiceName: "openai",
          rootTraceName: "LLM Generation",
          startedAt: new Date("2026-09-25T18:40:00.000Z"),
          durationMs: 400,
        },
        {
          traceId: "5c9073e9abcd",
          rootServiceName: undefined,
          rootTraceName: undefined,
          startedAt: new Date("2026-09-25T18:41:00.000Z"),
          durationMs: 0,
        },
      ],
      truncated: false,
    });
    const url = new URL(String(requests[0]?.url));
    expect(url.pathname).toBe("/api/search");
    expect(url.searchParams.get("q")).toBe("{ status = error }");
    expect(url.searchParams.get("start")).toBe("1790359200");
    expect(url.searchParams.get("end")).toBe("1790362800");
    expect(url.searchParams.get("limit")).toBe("10");
    expect(url.searchParams.has("spss")).toBe(false);
  });

  test("passes spss and enriches TraceSummary from spanSets and serviceStats", async () => {
    const { fetch, requests } = sequence({
      traces: [
        {
          traceID: "0102030405060708090a0b0c0d0e0f10",
          rootServiceName: "scout-backend",
          rootTraceName: "gen_ai.chat",
          startTimeUnixNano: "1790361600000000000",
          durationMs: 1250,
          serviceStats: {
            "scout-backend": { spanCount: 4, errorCount: 1 },
            postgres: { spanCount: 2, errorCount: 0 },
          },
          spanSets: [
            {
              matched: 2,
              attributes: [
                {
                  key: "deployment.environment.name",
                  value: { stringValue: "prod" },
                },
              ],
              spans: [
                {
                  spanID: "1111111111111111",
                  name: "gen_ai.chat",
                  attributes: [
                    { key: "llm.call_site", value: { stringValue: "report" } },
                    { key: "gen_ai.system", value: { stringValue: "openai" } },
                    {
                      key: "gen_ai.request.model",
                      value: { stringValue: "openai/gpt-5.4-mini" },
                    },
                    {
                      key: "llm.subject.kind",
                      value: { stringValue: "discord_user" },
                    },
                    {
                      key: "llm.subject.id",
                      value: { stringValue: "160509172704739328" },
                    },
                  ],
                },
                {
                  spanID: "2222222222222222",
                  name: "chat gpt-5.4-mini",
                  attributes: [
                    {
                      key: "gen_ai.provider.name",
                      value: { stringValue: "openai" },
                    },
                    {
                      key: "gen_ai.usage.input_tokens",
                      value: { intValue: "320" },
                    },
                    {
                      key: "gen_ai.usage.output_tokens",
                      value: { intValue: 45 },
                    },
                    {
                      key: "gen_ai.usage.cache_read_input_tokens",
                      value: { intValue: "100" },
                    },
                    {
                      key: "gen_ai.output.messages",
                      value: {
                        stringValue: JSON.stringify([
                          {
                            role: "assistant",
                            parts: [{ type: "tool_call", name: "lookup" }],
                          },
                        ]),
                      },
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    });

    const client = new TempoClient({ baseUrl: "http://tempo:3200", fetch });
    const result = await client.search({
      query: buildLlmTraceQl({ service: "scout-backend" }),
      start,
      end,
      limit: 20,
      spss: 10,
    });

    const url = new URL(String(requests[0]?.url));
    expect(url.searchParams.get("spss")).toBe("10");
    expect(result.traces).toEqual([
      {
        traceId: "0102030405060708090a0b0c0d0e0f10",
        rootServiceName: "scout-backend",
        rootTraceName: "gen_ai.chat",
        startedAt: new Date("2026-09-25T18:40:00.000Z"),
        durationMs: 1250,
        spanCount: 6,
        errorCount: 1,
        environment: "prod",
        workloads: ["report"],
        providers: ["openai"],
        models: ["openai/gpt-5.4-mini"],
        subject: { kind: "discord_user", id: "160509172704739328" },
        inputTokens: 320,
        outputTokens: 45,
        cachedInputTokens: 100,
        hasToolIo: true,
      },
    ]);
  });

  test("marks full pages truncated, handles empty pages, and rejects malformed responses", async () => {
    const { fetch } = sequence({ traces: [slowTrace("a"), slowTrace("b")] });
    const client = new TempoClient({ baseUrl: "http://tempo:3200", fetch });
    const result = await client.search({
      query: slowTraceQuery(5),
      start,
      end,
      limit: 2,
    });
    expect(result.truncated).toBe(true);
    expect(slowTraceQuery(5)).toBe("{ duration > 5s }");

    const emptyClient = new TempoClient({
      baseUrl: "http://tempo:3200",
      fetch: sequence({ metrics: { completedJobs: 1 } }).fetch,
    });
    await expect(
      emptyClient.search({ query: errorTraceQuery(), start, end, limit: 10 }),
    ).resolves.toEqual({ traces: [], truncated: false });

    const badClient = new TempoClient({
      baseUrl: "http://tempo:3200",
      fetch: sequence({ traces: [{ rootServiceName: "x" }] }).fetch,
    });
    await expect(
      badClient.search({ query: errorTraceQuery(), start, end, limit: 10 }),
    ).rejects.toThrow(/^tempo: /u);
  });
});

describe("TempoClient.health and getTrace", () => {
  test("health checks /ready and catches network failures", async () => {
    const okFetch = fakeFetch(() => new Response("ready", { status: 200 }));
    const okClient = new TempoClient({
      baseUrl: "http://tempo:3200",
      fetch: okFetch.fetch,
    });
    await expect(okClient.health()).resolves.toBe(true);
    expect(new URL(String(okFetch.requests[0]?.url)).pathname).toBe("/ready");

    const unhealthyClient = new TempoClient({
      baseUrl: "http://tempo:3200",
      fetch: fakeFetch(() => new Response("warming", { status: 503 })).fetch,
    });
    await expect(unhealthyClient.health()).resolves.toBe(false);

    const brokenClient = new TempoClient({
      baseUrl: "http://tempo:3200",
      fetch: () => Promise.reject(new Error("ECONNREFUSED")),
    });
    await expect(brokenClient.health()).resolves.toBe(false);
  });

  test("getTrace returns null on 404 and throws UpstreamError on 5xx", async () => {
    const notFound = fakeFetch(
      () => new Response("not found", { status: 404 }),
    );
    const client404 = new TempoClient({
      baseUrl: "http://tempo:3200",
      fetch: notFound.fetch,
    });
    await expect(
      client404.getTrace("0102030405060708090a0b0c0d0e0f10"),
    ).resolves.toBeNull();
    expect(notFound.requests[0]?.headers.get("accept")).toBe(
      "application/json",
    );

    const client503 = new TempoClient({
      baseUrl: "http://tempo:3200",
      fetch: fakeFetch(() => new Response("unavailable", { status: 503 }))
        .fetch,
    });
    await expect(
      client503.getTrace("0102030405060708090a0b0c0d0e0f10"),
    ).rejects.toThrow("tempo: HTTP 503");
  });

  test("getTrace normalizes batches and resourceSpans, base64/hex IDs, statuses, and OTLP attributes", async () => {
    const batchesPayload = {
      batches: [
        {
          resource: {
            attributes: [
              { key: "service.name", value: { stringValue: "birmel" } },
              {
                key: "deployment.environment",
                value: { stringValue: "production" },
              },
            ],
          },
          scopeSpans: [
            {
              scope: { name: "@shepherdjerred/llm-observability" },
              spans: [
                {
                  traceId: "AQIDBAUGBwgJCgsMDQ4PEA==",
                  spanId: "AQIDBAUGBwg=",
                  parentSpanId: "AAAAAAAAAAA=",
                  name: "gen_ai.chat",
                  startTimeUnixNano: "1790361600000000000",
                  endTimeUnixNano: "1790361600500000000",
                  status: { code: 1 },
                  attributes: [
                    { key: "gen_ai.system", value: { stringValue: "openai" } },
                    {
                      key: "gen_ai.usage.input_tokens",
                      value: { intValue: "42" },
                    },
                    {
                      key: "gen_ai.request.temperature",
                      value: { doubleValue: 0.7 },
                    },
                    { key: "llm.cached", value: { boolValue: true } },
                    {
                      key: "gen_ai.response.finish_reasons",
                      value: {
                        arrayValue: { values: [{ stringValue: "stop" }] },
                      },
                    },
                    {
                      key: "llm.meta",
                      value: {
                        kvlistValue: {
                          values: [
                            { key: "tier", value: { stringValue: "standard" } },
                          ],
                        },
                      },
                    },
                  ],
                  events: [
                    {
                      name: "retry",
                      timeUnixNano: "1790361600100000000",
                      attributes: [
                        { key: "attempt", value: { intValue: "1" } },
                      ],
                    },
                  ],
                },
                {
                  traceId: "0102030405060708090A0B0C0D0E0F10",
                  spanId: "1122334455667788",
                  parentSpanId: "AQIDBAUGBwg=",
                  name: "chat gpt-5",
                  startTimeUnixNano: "1790361600100000000",
                  endTimeUnixNano: "1790361600400000000",
                  status: {
                    code: "STATUS_CODE_ERROR",
                    message: "rate limited",
                  },
                },
              ],
            },
          ],
        },
      ],
    };

    const resourceSpansPayload = {
      resourceSpans: [
        {
          resource: {
            attributes: [
              { key: "service.name", value: { stringValue: "temporal" } },
            ],
          },
          scopeSpans: [
            {
              spans: [
                {
                  spanId: "aabbccddeeff0011",
                  name: "workflow.step",
                  startTimeUnixNano: "1790361600000000000",
                  endTimeUnixNano: "1790361601000000000",
                  status: { code: 2, message: "boom" },
                },
                {
                  spanId: "aabbccddeeff0022",
                  parentSpanId: "aabbccddeeff0011",
                  name: "child.ok",
                  startTimeUnixNano: "1790361600100000000",
                  endTimeUnixNano: "1790361600200000000",
                  status: { code: "STATUS_CODE_OK" },
                },
              ],
            },
          ],
        },
      ],
    };

    const { fetch } = sequence(batchesPayload, resourceSpansPayload);
    const client = new TempoClient({ baseUrl: "http://tempo:3200", fetch });

    const first = await client.getTrace("0102030405060708090a0b0c0d0e0f10");
    expect(first?.spans[0]?.spanId).toBe("0102030405060708");
    expect(first?.spans[0]?.parentSpanId).toBeNull();
    expect(first?.spans[0]?.status).toBe("ok");
    expect(first?.spans[0]?.attributes).toEqual({
      "gen_ai.system": "openai",
      "gen_ai.usage.input_tokens": 42,
      "gen_ai.request.temperature": 0.7,
      "llm.cached": true,
      "gen_ai.response.finish_reasons": ["stop"],
      "llm.meta": { tier: "standard" },
    });
    expect(first?.spans[1]?.parentSpanId).toBe("0102030405060708");
    expect(first?.spans[1]?.status).toBe("error");
    expect(first?.spans[1]?.statusMessage).toBe("rate limited");

    const second = await client.getTrace("deadbeefdeadbeefdeadbeefdeadbeef");
    expect(second?.spans.map((span) => [span.spanId, span.status])).toEqual([
      ["aabbccddeeff0011", "error"],
      ["aabbccddeeff0022", "ok"],
    ]);
  });
});

describe("buildLlmTraceQl", () => {
  test("builds base LLM query and narrows with escaped filters", () => {
    expect(buildLlmTraceQl({})).toBe(
      '{ span.gen_ai.system != "" || span.gen_ai.operation.name != "" || span.gen_ai.request.model != "" }',
    );

    const query = buildLlmTraceQl({
      service: "scout-backend",
      environment: "prod",
      workload: String.raw`report\"v2`,
      provider: "openai",
      model: "openai/gpt-5.4-mini",
      status: "error",
      subjectId: "user-1",
      minDurationMs: 500,
    });
    expect(query).toContain('resource.service.name = "scout-backend"');
    expect(query).toContain('resource.deployment.environment.name = "prod"');
    expect(query).toContain(String.raw`span.llm.call_site = "report\\\"v2"`);
    expect(query).toContain('span.gen_ai.system = "openai"');
    expect(query).toContain(
      'span.gen_ai.request.model = "openai/gpt-5.4-mini"',
    );
    expect(query).toContain("status = error");
    expect(query).toContain('span.llm.subject.id = "user-1"');
    expect(query).toContain("duration >= 500ms");
  });

  test("rejects control characters and invalid durations", () => {
    expect(() => buildLlmTraceQl({ workload: "bad\nline" })).toThrow(
      /control characters/iu,
    );
    expect(() => buildLlmTraceQl({ service: "null\u0000byte" })).toThrow(
      /control characters/iu,
    );
    expect(() => buildLlmTraceQl({ minDurationMs: -5 })).toThrow(
      /minDurationMs/iu,
    );
  });
});
