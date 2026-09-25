import { describe, expect, test } from "vitest";
import type { Fetch } from "@shepherdjerred/ops-clients/http.ts";
import { PrometheusClient } from "@shepherdjerred/ops-clients/prometheus.ts";

function client(body: unknown): { client: PrometheusClient; urls: string[] } {
  const urls: string[] = [];
  const fetchImpl: Fetch = (input) => {
    urls.push(String(input));
    return Promise.resolve(Response.json(body));
  };
  return {
    client: new PrometheusClient({
      baseUrl: "http://prom:9090",
      fetch: fetchImpl,
    }),
    urls,
  };
}

const vector = (values: string[]) => ({
  status: "success",
  data: {
    resultType: "vector",
    result: values.map((value, index) => ({
      metric: { index: String(index) },
      value: [1_700_000_000, value],
    })),
  },
});

describe("PrometheusClient", () => {
  test("query parses sample values", async () => {
    const { client: prometheus, urls } = client(vector(["1.5"]));
    await expect(prometheus.query("up")).resolves.toEqual([
      { metric: { index: "0" }, value: 1.5 },
    ]);
    expect(urls[0]).toBe("http://prom:9090/api/v1/query?query=up");
  });

  test("an error status fails instead of looking empty", async () => {
    const { client: prometheus } = client({
      status: "error",
      errorType: "bad_data",
      error: "parse error",
    });
    await expect(prometheus.query("up{")).rejects.toThrow(/prometheus/);
  });

  test("scalar returns null for no data and rejects many samples", async () => {
    await expect(client(vector([])).client.scalar("x")).resolves.toBeNull();
    await expect(
      client(vector(["NaN"])).client.scalar("x"),
    ).resolves.toBeNull();
    await expect(client(vector(["1", "2"])).client.scalar("x")).rejects.toThrow(
      /returned 2 samples/,
    );
  });

  test("range drops non-finite points", async () => {
    const { client: prometheus, urls } = client({
      status: "success",
      data: {
        resultType: "matrix",
        result: [
          {
            metric: { job: "a" },
            values: [
              [1, "1"],
              [2, "NaN"],
              [3, "3"],
            ],
          },
        ],
      },
    });
    await expect(
      prometheus.range({
        query: "up",
        start: new Date(0),
        end: new Date(3000),
        stepSeconds: 1,
      }),
    ).resolves.toEqual([
      {
        metric: { job: "a" },
        points: [
          [1, 1],
          [3, 3],
        ],
      },
    ]);
    expect(urls[0]).toContain(
      "/api/v1/query_range?query=up&start=0&end=3&step=1",
    );
  });
});
