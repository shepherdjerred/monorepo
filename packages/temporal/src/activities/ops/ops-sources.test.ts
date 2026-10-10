import { describe, expect, test } from "vitest";
import { GitHubClient } from "@shepherdjerred/ops-clients/github.ts";
import { PrometheusClient } from "@shepherdjerred/ops-clients/prometheus.ts";
import { register } from "#observability/metrics.ts";
import { recordVeleroOutcomes } from "#observability/metrics-velero.ts";
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
    const result = await collectMaintenance(
      prometheus,
      {
        listVeleroSchedules: () => Promise.resolve([]),
        listVeleroBackups: () => Promise.resolve([]),
        listVeleroRestores: () => Promise.resolve([]),
        listDeletingZfsVolumes: () => Promise.resolve([]),
      },
      new Date("2026-10-01T12:00:00Z"),
    );
    expect(queries.toSorted()).toEqual(
      [
        ...Object.values(MAINTENANCE_QUERIES),
        "max by (node,dataset_name) (zfs_dataset_referenced_bytes)",
      ].toSorted(),
    );
    expect(result.signals).toHaveLength(3);
    expect(
      result.signals.every((signal) => signal.severity === "unknown"),
    ).toBe(true);
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

  test("a failed inventory read retains old outcome evidence and its old observation time", async () => {
    recordVeleroOutcomes(
      [{ namespace: "velero", schedule: "daily", failed: true }],
      new Date("2026-10-01T12:00:00Z"),
    );
    const beforeText = await metricsText();
    const before = beforeText
      .split("\n")
      .filter((line) => line.startsWith("velero_schedule_"));
    const prometheus = new PrometheusClient({
      baseUrl: "http://prometheus:9090",
      fetch: () =>
        Promise.resolve(
          Response.json({
            status: "success",
            data: { resultType: "vector", result: [] },
          }),
        ),
    });
    await expect(
      collectMaintenance(
        prometheus,
        {
          listVeleroSchedules: () => Promise.resolve([]),
          listVeleroBackups: () =>
            Promise.reject(new Error("inventory unavailable")),
          listVeleroRestores: () => Promise.resolve([]),
          listDeletingZfsVolumes: () => Promise.resolve([]),
        },
        new Date("2026-10-01T13:00:00Z"),
      ),
    ).rejects.toThrow("inventory unavailable");
    const failedReadText = await metricsText();
    expect(
      failedReadText
        .split("\n")
        .filter((line) => line.startsWith("velero_schedule_")),
    ).toEqual(before);
    recordVeleroOutcomes(
      [{ namespace: "velero", schedule: "new", failed: undefined }],
      new Date("2026-10-01T13:00:00Z"),
    );
    const after = await metricsText();
    expect(after).not.toContain("velero_schedule_last_terminal_failed{");
    expect(after).toContain(
      'velero_schedule_observation_timestamp_seconds{backup_namespace="velero",schedule="new",component="temporal-worker"} 1790859600',
    );
  });
});
