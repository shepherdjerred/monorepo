import { describe, expect, test } from "vitest";
import {
  errorLogQuery,
  errorVolumeQuery,
  LokiClient,
  NAMESPACE_BYTES_24H_QUERY,
  WARNING_EVENTS_1H_QUERY,
} from "@shepherdjerred/ops-clients/loki.ts";
import {
  fakeFetch,
  sequence,
} from "@shepherdjerred/ops-clients/test-support/fake-fetch.ts";

describe("LokiClient", () => {
  test("filters severity metadata and never matches words such as error in info summaries", () => {
    expect(errorLogQuery('namespace="temporal"')).toBe(
      '{namespace="temporal"} | detected_level=~"error|fatal|critical"',
    );
    expect(errorVolumeQuery("1h")).not.toContain("|~");
  });

  test("returns error volume by namespace, largest first", async () => {
    const { fetch, requests } = sequence({
      status: "success",
      data: {
        resultType: "vector",
        result: [
          { metric: { namespace: "birmel" }, value: [1, "3"] },
          { metric: { namespace: "temporal" }, value: [1, "40"] },
        ],
      },
    });
    const client = new LokiClient({ baseUrl: "http://loki:3100", fetch });
    await expect(
      client.errorVolumeByNamespace("1h", new Date(1000)),
    ).resolves.toEqual([
      { namespace: "temporal", lines: 40 },
      { namespace: "birmel", lines: 3 },
    ]);
    const url = new URL(requests[0]?.url ?? "");
    expect(url.pathname).toBe("/loki/api/v1/query");
    expect(url.searchParams.get("query")).toBe(errorVolumeQuery("1h"));
    expect(url.searchParams.get("time")).toBe("1000000000");
  });

  test("an error status fails", async () => {
    const { fetch } = sequence({ status: "error", error: "parse error" });
    const client = new LokiClient({ baseUrl: "http://loki:3100", fetch });
    await expect(
      client.errorVolumeByNamespace("1h", new Date()),
    ).rejects.toThrow(/^loki: /u);
  });

  test("namespaceVolume24h queries bytes_over_time and sorts largest first", async () => {
    const { fetch, requests } = sequence({
      status: "success",
      data: {
        resultType: "vector",
        result: [
          { metric: { namespace: "scout" }, value: [1, "1048576"] },
          { metric: { namespace: "observability" }, value: [1, "52428800"] },
        ],
      },
    });
    const client = new LokiClient({ baseUrl: "http://loki:3100", fetch });
    await expect(client.namespaceVolume24h(new Date(2000))).resolves.toEqual([
      { namespace: "observability", bytes: 52_428_800 },
      { namespace: "scout", bytes: 1_048_576 },
    ]);
    const url = new URL(requests[0]?.url ?? "");
    expect(url.searchParams.get("query")).toBe(NAMESPACE_BYTES_24H_QUERY);
  });

  test("warningEvents1h groups by namespace and reason and returns empty on 404", async () => {
    const ok = sequence({
      status: "success",
      data: {
        resultType: "vector",
        result: [
          {
            metric: { namespace: "scout", reason: "BackOff" },
            value: [1, "7"],
          },
          { metric: { reason: "NodeNotReady" }, value: [1, "1"] },
        ],
      },
    });
    const client = new LokiClient({
      baseUrl: "http://loki:3100",
      fetch: ok.fetch,
    });
    await expect(client.warningEvents1h(new Date(1000))).resolves.toEqual([
      { namespace: "scout", reason: "BackOff", count: 7 },
      { namespace: "(cluster)", reason: "NodeNotReady", count: 1 },
    ]);
    expect(new URL(ok.requests[0]?.url ?? "").searchParams.get("query")).toBe(
      WARNING_EVENTS_1H_QUERY,
    );

    const notFound = fakeFetch(
      () => new Response("not found", { status: 404 }),
    );
    const emptyClient = new LokiClient({
      baseUrl: "http://loki:3100",
      fetch: notFound.fetch,
    });
    await expect(emptyClient.warningEvents1h()).resolves.toEqual([]);
  });

  test("rulerRulesCount supports YAML, JSON, and graceful 0 on 404", async () => {
    const yamlBody = [
      "observability:",
      "  - name: kubernetes-events",
      "    rules:",
      "      - alert: KubernetesWarningEvent",
      '        expr: count_over_time({app="kubernetes-events"}[5m]) > 0',
      "      - record: namespace:log_errors:rate5m",
      '        expr: sum by (namespace) (rate({namespace=~".+"}[5m]))',
    ].join("\n");

    const responses = [
      new Response(yamlBody, { status: 200 }),
      Response.json({
        status: "success",
        data: {
          groups: [{ rules: [{ name: "a" }, { name: "b" }, { name: "c" }] }],
        },
      }),
      new Response("no rule groups found", { status: 404 }),
    ];
    const { fetch } = fakeFetch((_req, index) => {
      const resp = responses[index];
      if (resp === undefined) {
        throw new Error("unexpected request");
      }
      return resp;
    });
    const client = new LokiClient({ baseUrl: "http://loki:3100", fetch });
    await expect(client.rulerRulesCount()).resolves.toBe(2);
    await expect(client.rulerRulesCount()).resolves.toBe(3);
    await expect(client.rulerRulesCount()).resolves.toBe(0);
  });
});
