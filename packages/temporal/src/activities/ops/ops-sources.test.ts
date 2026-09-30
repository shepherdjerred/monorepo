import { describe, expect, test } from "vitest";
import { GitHubClient } from "@shepherdjerred/ops-clients/github.ts";
import { PrometheusClient } from "@shepherdjerred/ops-clients/prometheus.ts";
import { register } from "#observability/metrics.ts";
import { MAINTENANCE_QUERIES } from "./maintenance.ts";
import {
  collectMaintenance,
  collectRenovate,
  collectTalos,
} from "./ops-sources.ts";

async function metricsText(): Promise<string> {
  return await register.metrics();
}

describe("ops source collectors", () => {
  test("talos sets node and service gauges from talosctl output", async () => {
    const calls: string[][] = [];
    const result = await collectTalos((args) => {
      calls.push([...args]);
      return Promise.resolve(
        args[1] === "machinestatus"
          ? '{"node":"10.0.0.1","metadata":{"id":"machine"},"spec":{"stage":"running","status":{"ready":true}}}'
          : '{"node":"10.0.0.1","metadata":{"id":"etcd"},"spec":{"running":true,"healthy":false,"unknown":false}}',
      );
    });
    expect(calls).toEqual([
      ["get", "machinestatus", "-o", "json"],
      ["get", "services", "-o", "json"],
    ]);
    expect(result.signals.map((signal) => signal.id)).toEqual([
      "talos:service:10.0.0.1:etcd",
    ]);
    const text = await metricsText();
    expect(text).toContain(
      'talos_node_ready{node="10.0.0.1",component="temporal-worker"} 1',
    );
    expect(text).toContain(
      'talos_service_healthy{node="10.0.0.1",service="etcd",component="temporal-worker"} 0',
    );
  });

  test("maintenance runs every declared query", async () => {
    const queries: string[] = [];
    const prometheus = new PrometheusClient({
      baseUrl: "http://prometheus:9090",
      fetch: (input) => {
        queries.push(new URL(String(input)).searchParams.get("query") ?? "");
        return Promise.resolve(
          Response.json({
            status: "success",
            data: { resultType: "vector", result: [] },
          }),
        );
      },
    });
    const result = await collectMaintenance(prometheus);
    expect(queries.toSorted()).toEqual(
      Object.values(MAINTENANCE_QUERIES).toSorted(),
    );
    expect(result.signals).toEqual([]);
  });

  test("renovate sets the pending-update gauge by state", async () => {
    const github = new GitHubClient({
      owner: "shepherdjerred",
      name: "monorepo",
      token: () => Promise.resolve("t"),
      fetch: (_input, init) => {
        const body = typeof init?.body === "string" ? init.body : "";
        const data = body.includes("IssueSearch")
          ? {
              search: {
                nodes: [
                  {
                    number: 481,
                    title: "Dependency Dashboard",
                    url: "https://github.com/shepherdjerred/monorepo/issues/481",
                    body: " - [ ] <!-- approve-branch=renovate/a -->update a",
                  },
                ],
              },
            }
          : {
              repository: {
                pullRequests: {
                  pageInfo: { hasNextPage: false, endCursor: null },
                  nodes: [],
                },
              },
            };
        return Promise.resolve(Response.json({ data }));
      },
    });
    const result = await collectRenovate(github);
    expect(result.signals.map((signal) => signal.id)).toEqual([
      "renovate:approve:renovate/a",
    ]);
    expect("counts" in result).toBe(false);
    const text = await metricsText();
    expect(text).toContain(
      'renovate_updates_pending{state="awaiting-approval",component="temporal-worker"} 1',
    );
    expect(text).toContain(
      'renovate_updates_pending{state="open-pr",component="temporal-worker"} 0',
    );
  });
});
