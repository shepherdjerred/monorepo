import { describe, expect, test } from "vitest";
import { LokiClient } from "@shepherdjerred/ops-clients/loki.ts";
import { PrometheusClient } from "@shepherdjerred/ops-clients/prometheus.ts";
import { ServiceIndex } from "@shepherdjerred/ops-model/catalog.ts";
import {
  ClusterFacetSchema,
  MonorepoFacetSchema,
  ObservabilityFacetSchema,
  TemporalFacetSchema,
} from "@shepherdjerred/ops-model/facets.ts";
import { collectClusterFacet } from "./cluster-facet.ts";
import {
  compactVerifyDiagnosticsJson,
  summarizeDiagnosticsRuns,
} from "./monorepo-diagnostics.ts";
import {
  clearMonorepoCacheForTests,
  collectMonorepoFacet,
} from "./monorepo-facet.ts";
import { collectObservabilityFacet } from "./observability-facet.ts";
import {
  buildTemporalFacet,
  parseTemporalWorkerDeployments,
} from "./temporal-facet.ts";

const now = new Date("2026-11-21T22:00:00.000Z");
const services = new ServiceIndex();

describe("monorepo and cluster facets", () => {
  test("monorepo facet compacts diagnostics, computes Turbo hit ratio, and builds workspace inventory", async () => {
    clearMonorepoCacheForTests();
    const run = compactVerifyDiagnosticsJson({
      turbo: [
        {
          tasks: [
            {
              taskId: "@shepherdjerred/ops-model#test",
              cache: { status: "HIT" },
              execution: { startTime: 1000, endTime: 1100 },
            },
            {
              taskId: "@shepherdjerred/temporal#test",
              cache: { status: "MISS" },
              execution: { startTime: 1000, endTime: 13_000 },
            },
          ],
        },
      ],
    });
    const summary = summarizeDiagnosticsRuns([run, run]);
    expect(summary.verifyRunsAnalyzed).toBe(2);
    expect(summary.turboHitRatio7d).toBe(0.5);
    expect(summary.expensiveTasks[0]?.packageName).toBe(
      "@shepherdjerred/temporal",
    );

    const facet = await collectMonorepoFacet({ services, now });
    expect(() => MonorepoFacetSchema.parse(facet)).not.toThrow();
    expect(facet.packageCount).toBeGreaterThan(20);
    expect(facet.catalogPinsCount).toBeGreaterThan(0);
  });

  test("cluster facet combines K8s nodes, workloads, databases, zpools, NVMe, SeaweedFS, and ArgoCD", async () => {
    const prometheus = new PrometheusClient({
      baseUrl: "http://prometheus:9090",
      fetch: (input) => {
        const q = new URL(String(input)).searchParams.get("query") ?? "";
        let result: {
          metric: Record<string, string>;
          value: [number, string];
        }[] = [];
        if (q.includes("node_cpu_seconds_total") && q.startsWith("count")) {
          result = [{ metric: { node: "torvalds" }, value: [1, "16"] }];
        } else if (q.includes("zfs_zpool_size_bytes")) {
          result = [
            {
              metric: { instance: "torvalds", zpool_name: "zfspv-pool-nvme" },
              value: [1, "1000000000000"],
            },
          ];
        } else if (q.includes("zfs_zpool_free_bytes")) {
          result = [
            {
              metric: { instance: "torvalds", zpool_name: "zfspv-pool-nvme" },
              value: [1, "600000000000"],
            },
          ];
        } else if (q.includes("nvme_data_units_written_total")) {
          result = [
            {
              metric: {
                node: "torvalds",
                device: "nvme0n1",
                serial: "S1",
                model: "Samsung 990 PRO",
              },
              value: [1, "10737418240"],
            },
          ];
        } else if (q.includes("SeaweedFS_volumeServer_volumes")) {
          result = [{ metric: {}, value: [1, "12"] }];
        } else if (q.includes("SeaweedFS_volumeServer_max_volumes")) {
          result = [{ metric: {}, value: [1, "64"] }];
        }
        return Promise.resolve(
          Response.json({
            status: "success",
            data: { resultType: "vector", result },
          }),
        );
      },
    });

    const facet = await collectClusterFacet({
      services,
      prometheus,
      kubernetes: {
        listNodes: () =>
          Promise.resolve([
            {
              name: "torvalds",
              ready: true,
              readySince: "2026-11-01T00:00:00Z",
              osImage: "Talos (v1.11.2)",
              kubeletVersion: "v1.34.1",
            },
          ]),
        listPods: () =>
          Promise.resolve([
            {
              namespace: "tracker",
              name: "tracker-postgres-0",
              phase: "Running",
              createdAt: "2026-11-20T00:00:00Z",
              ownerKind: "StatefulSet",
              restarts: 0,
              problem: undefined,
              stuck: false,
            },
            {
              namespace: "temporal",
              name: "temporal-wf-retained-abc-12345",
              phase: "Running",
              createdAt: "2026-11-20T00:00:00Z",
              ownerKind: "ReplicaSet",
              restarts: 0,
              problem: undefined,
              stuck: false,
            },
          ]),
        listArgoApplications: () =>
          Promise.resolve([
            {
              name: "tracker",
              project: "default",
              destinationNamespace: "tracker",
              sync: "Synced",
              health: "Healthy",
              revision: "abcdef1234567890",
              history: [],
              operation: undefined,
            },
          ]),
        listVeleroBackups: () => Promise.resolve([]),
        listVeleroSchedules: () =>
          Promise.resolve([
            {
              name: "daily",
              namespace: "velero",
              createdAt: "2026-01-01T00:00:00Z",
              cronSchedule: "0 2 * * *",
              paused: false,
              maxAgeSeconds: 86_400,
              alertForSeconds: 300,
              alertSeverity: "warning",
            },
          ]),
      },
    });

    expect(() => ClusterFacetSchema.parse(facet)).not.toThrow();
    expect(facet.nodes[0]).toMatchObject({
      name: "torvalds",
      cpuCores: 16,
      talosVersion: "v1.11.2",
    });
    expect(facet.workloadSummary.retainedPools).toBe(1);
    expect(facet.databases[0]).toMatchObject({
      namespace: "tracker",
      engine: "postgres",
      veleroBackedUp: true,
    });
    expect(facet.zpools[0]).toMatchObject({
      node: "torvalds",
      pool: "zfspv-pool-nvme",
      usedBytes: 400_000_000_000,
    });
    expect(facet.nvmeDrives[0]).toMatchObject({
      node: "torvalds",
      device: "nvme0n1",
      model: "Samsung 990 PRO",
    });
    expect(facet.seaweedfs).toMatchObject({ volumeCount: 12, maxVolumes: 64 });
    expect(facet.argoApps[0]).toMatchObject({
      name: "tracker",
      syncStatus: "Synced",
      autoSync: true,
    });
  });
});

describe("observability and temporal facets", () => {
  test("observability facet combines Prometheus, Loki, Tempo RED, and Grafana", async () => {
    const prometheus = new PrometheusClient({
      baseUrl: "http://prometheus:9090",
      fetch: (input) => {
        const q = new URL(String(input)).searchParams.get("query") ?? "";
        let result: {
          metric: Record<string, string>;
          value: [number, string];
        }[] = [];
        if (q.includes("prometheus_tsdb_head_series")) {
          result = [{ metric: {}, value: [1, "150000"] }];
        } else if (q === "up == 0") {
          result = [
            {
              metric: { job: "node-exporter", instance: "10.0.0.2" },
              value: [1, "0"],
            },
          ];
        } else if (
          q.startsWith(
            "sum by (service) (rate(traces_spanmetrics_calls_total[5m]))",
          )
        ) {
          result = [{ metric: { service: "tracker" }, value: [1, "3.45"] }];
        }
        return Promise.resolve(
          Response.json({
            status: "success",
            data: { resultType: "vector", result },
          }),
        );
      },
    });

    const loki = new LokiClient({
      baseUrl: "http://loki:3100",
      fetch: (input) => {
        const url = String(input);
        if (url.includes("/loki/api/v1/rules")) {
          return Promise.resolve(
            Response.json({ data: { groups: [{ rules: [{}, {}] }] } }),
          );
        }
        return Promise.resolve(
          Response.json({
            status: "success",
            data: {
              resultType: "vector",
              result: [
                {
                  metric: { namespace: "temporal", reason: "BackOff" },
                  value: [1, "5"],
                },
              ],
            },
          }),
        );
      },
    });

    const facet = await collectObservabilityFacet({
      prometheus,
      loki,
      grafanaUrl: "http://grafana:3000",
      grafanaApiKey: "gf-key",
      fetchImpl: (input) => {
        const url = String(input);
        return Promise.resolve(
          Response.json(
            url.includes("/api/search")
              ? [
                  {
                    uid: "zfs-dashboard",
                    title: "ZFS Storage",
                    folderTitle: "Storage",
                  },
                ]
              : [{}, {}, {}],
          ),
        );
      },
      now,
    });

    expect(() => ObservabilityFacetSchema.parse(facet)).not.toThrow();
    expect(facet.prometheus.headSeries).toBe(150_000);
    expect(facet.prometheus.downTargets).toHaveLength(1);
    expect(facet.loki.rulerRulesCount).toBe(2);
    expect(facet.tempo.servicesRed[0]).toMatchObject({
      service: "tracker",
      spanRate: 3.45,
    });
    expect(facet.grafana).toMatchObject({
      datasourcesCount: 3,
      dashboardsCount: 1,
    });
  });

  test("temporal facet excludes retained worker pools and summarizes schedules", async () => {
    const deployments = parseTemporalWorkerDeployments({
      items: [
        {
          metadata: { name: "temporal-temporal-ops-worker" },
          spec: {
            replicas: 2,
            template: {
              spec: {
                containers: [
                  { env: [{ name: "TEMPORAL_WORKER_ROLE", value: "ops" }] },
                ],
              },
            },
          },
          status: { readyReplicas: 2 },
        },
        {
          metadata: { name: "temporal-wf-retained-old-worker" },
          spec: { replicas: 1 },
          status: { readyReplicas: 1 },
        },
      ],
    });
    expect(deployments).toHaveLength(1);

    const facet = await buildTemporalFacet({
      observations: [
        {
          namespace: "prod",
          scheduleId: "ops-snapshot",
          workflowType: "runOpsSnapshot",
          taskQueue: "monorepo-workflows",
          paused: false,
          nextScheduledAt: "2026-11-21T22:05:00Z",
          observedAt: now.toISOString(),
          running: false,
          completedActions: [],
          actions: [
            {
              scheduledAt: "2026-11-21T22:00:00Z",
              workflowId: "wf-1",
              firstExecutionRunId: "r-1",
              status: "COMPLETED",
              closedAt: "2026-11-21T22:00:05Z",
            },
          ],
        },
      ],
      workerDeployments: deployments,
      now,
    });

    expect(() => TemporalFacetSchema.parse(facet)).not.toThrow();
    expect(facet.workerPools).toEqual([
      {
        deployment: "temporal-temporal-ops-worker",
        taskQueue: "ops",
        readyReplicas: 2,
        desiredReplicas: 2,
        pollers: null,
        slotsAvailable: null,
      },
    ]);
    expect(facet.scheduleSummary).toEqual({
      total: 1,
      active: 1,
      paused: 0,
      failing: 0,
    });
  });
});
