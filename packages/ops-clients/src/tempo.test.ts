import { describe, expect, test } from "vitest";
import {
  errorTraceQuery,
  slowTraceQuery,
  TempoClient,
} from "@shepherdjerred/ops-clients/tempo.ts";
import { sequence } from "@shepherdjerred/ops-clients/test-support/fake-fetch.ts";

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

describe("TempoClient", () => {
  test("searches TraceQL and parses trace summaries", async () => {
    const { fetch, requests } = sequence({
      traces: [
        {
          traceID: "1c3b6f19abcd",
          rootServiceName: "openrouter",
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
          rootServiceName: "openrouter",
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
  });

  test("a full page is marked truncated", async () => {
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
  });

  test("an empty result has no traces", async () => {
    const { fetch } = sequence({ metrics: { completedJobs: 1 } });
    const client = new TempoClient({ baseUrl: "http://tempo:3200", fetch });
    await expect(
      client.search({ query: errorTraceQuery(), start, end, limit: 10 }),
    ).resolves.toEqual({ traces: [], truncated: false });
  });

  test("a malformed response fails loudly", async () => {
    const { fetch } = sequence({ traces: [{ rootServiceName: "x" }] });
    const client = new TempoClient({ baseUrl: "http://tempo:3200", fetch });
    await expect(
      client.search({ query: errorTraceQuery(), start, end, limit: 10 }),
    ).rejects.toThrow(/^tempo: /);
  });
});
