import { WorkflowNotFoundError } from "@temporalio/client";
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
  buildCodeReviewPoolAudit,
  collectMonorepoCodeReview,
  describeCodeReviewCoordinatorMemo,
  readProdCodeReviewCoordinator,
} from "./monorepo-code-review.ts";
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

type VectorRow = {
  metric: Record<string, string>;
  value: [number, string];
};

function createMockPrometheus(
  respond: (query: string) => VectorRow[],
): PrometheusClient {
  return new PrometheusClient({
    baseUrl: "http://prometheus:9090",
    fetch: (input) => {
      const query = new URL(String(input)).searchParams.get("query") ?? "";
      return Promise.resolve(
        Response.json({
          status: "success",
          data: { resultType: "vector", result: respond(query) },
        }),
      );
    },
  });
}

function createClusterTestPrometheus(): PrometheusClient {
  return createMockPrometheus((q) => {
    if (q.includes("node_cpu_seconds_total") && q.startsWith("count")) {
      return [{ metric: { node: "torvalds" }, value: [1, "16"] }];
    }
    if (q.includes("zfs_zpool_size_bytes")) {
      return [
        {
          metric: { instance: "torvalds", zpool_name: "zfspv-pool-nvme" },
          value: [1, "1000000000000"],
        },
      ];
    }
    if (q.includes("zfs_zpool_free_bytes")) {
      return [
        {
          metric: { instance: "torvalds", zpool_name: "zfspv-pool-nvme" },
          value: [1, "600000000000"],
        },
      ];
    }
    if (q.includes("zfs_zpool == 1")) {
      return [
        {
          metric: {
            instance: "torvalds",
            zpool_name: "zfspv-pool-nvme",
            health: "DEGRADED",
          },
          value: [1, "1"],
        },
      ];
    }
    if (q.includes("kube_pod_spec_volumes_persistentvolumeclaims_info")) {
      return [
        {
          metric: {
            namespace: "tracker",
            pod: "tracker-postgres-0",
            persistentvolumeclaim: "tracker-db-pvc",
          },
          value: [1, "1"],
        },
        {
          metric: {
            namespace: "cache",
            pod: "cache-postgres-0",
            persistentvolumeclaim: "cache-scratch-pvc",
          },
          value: [1, "1"],
        },
      ];
    }
    if (q.includes("kube_persistentvolumeclaim_labels")) {
      return [
        {
          metric: {
            namespace: "tracker",
            persistentvolumeclaim: "tracker-db-pvc",
          },
          value: [1, "1"],
        },
      ];
    }
    if (q.includes("nvme_data_units_written_total")) {
      return [
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
    }
    if (q.includes("SeaweedFS_volumeServer_volumes")) {
      return [{ metric: {}, value: [1, "12"] }];
    }
    return q.includes("SeaweedFS_volumeServer_max_volumes")
      ? [{ metric: {}, value: [1, "64"] }]
      : [];
  });
}

describe("monorepo facet", () => {
  test("compacts diagnostics, computes Turbo hit ratio, and builds workspace inventory", async () => {
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

    const facet = await collectMonorepoFacet({
      services,
      now,
      prometheus: createMockPrometheus((q) => {
        if (q.includes("pr_code_review_assignments_total")) {
          return [
            { metric: { provider: "coderabbit" }, value: [1, "15"] },
            { metric: { provider: "codex" }, value: [1, "33"] },
          ];
        }
        if (q.includes("pr_code_review_provider_outcomes_total")) {
          return [
            {
              metric: { provider: "coderabbit", outcome: "completed" },
              value: [1, "10"],
            },
            {
              metric: { provider: "coderabbit", outcome: "usage-limited" },
              value: [1, "5"],
            },
            {
              metric: { provider: "codex", outcome: "completed" },
              value: [1, "26"],
            },
            {
              metric: { provider: "codex", outcome: "timed-out" },
              value: [1, "7"],
            },
          ];
        }
        if (q.includes("pr_code_review_provider_cooldowns_total")) {
          return [{ metric: { provider: "coderabbit" }, value: [1, "5"] }];
        }
        if (q.includes("pr_code_review_outcomes_total")) {
          return [
            { metric: { reason: "clean" }, value: [1, "36"] },
            { metric: { reason: "prior-round" }, value: [1, "31"] },
            { metric: { reason: "quota-exempt" }, value: [1, "5"] },
          ];
        }
        if (q.includes("histogram_quantile(0.5")) {
          return [{ metric: {}, value: [1, "13.66"] }];
        }
        return q.includes("histogram_quantile(0.95")
          ? [{ metric: {}, value: [1, "NaN"] }]
          : [];
      }),
      codeReviewOptions: {
        loadRuntimeConfig: () =>
          Promise.resolve({
            enabled: true,
            settings: {
              weights: { coderabbit: 3, codex: 1, cubic: 0 },
              quotaCooldownSeconds: 3600,
              timeoutCooldownSeconds: 900,
              requestRetrySeconds: 720,
              providerTimeoutSeconds: 1500,
            },
          }),
        readCoordinator: () =>
          Promise.resolve({
            observed: true,
            running: true,
            processedCount: 195,
            currentWeights: { coderabbit: 2, codex: -2 },
            cooldownUntilMs: {
              coderabbit: now.getTime() + 1_800_000,
            },
          }),
      },
    });
    expect(() => MonorepoFacetSchema.parse(facet)).not.toThrow();
    expect(facet.packageCount).toBeGreaterThan(20);
    expect(facet.catalogPinsCount).toBeGreaterThan(0);
    expect(facet.codeReview?.coordinatorObserved).toBe(true);
    expect(facet.codeReview?.coordinatorProcessedCount).toBe(195);
    expect(facet.codeReview?.activeProvidersCount).toBe(2);
    expect(facet.codeReview?.readyProvidersCount).toBe(1);
    expect(facet.codeReview?.coolingDownProvidersCount).toBe(1);
    expect(facet.codeReview?.medianDurationSeconds7d).toBe(13.7);
    expect(facet.codeReview?.p95DurationSeconds7d).toBeNull();
    expect(facet.codeReview?.outcomes7d.priorRound).toBe(31);
    const rabbit = facet.codeReview?.providers.find(
      (p) => p.id === "coderabbit",
    );
    expect(rabbit).toMatchObject({
      tier: "free",
      configuredWeight: 3,
      targetShareRatio: 0.75,
      status: "cooldown",
      assignments7d: 15,
      completed7d: 10,
      usageLimited7d: 5,
      cooldowns7d: 5,
    });
    const codex = facet.codeReview?.providers.find((p) => p.id === "codex");
    expect(codex).toMatchObject({
      tier: "paid",
      configuredWeight: 1,
      targetShareRatio: 0.25,
      status: "ready",
      assignments7d: 33,
      completed7d: 26,
      timedOut7d: 7,
    });
    expect(facet.audits.find((a) => a.id === "code-review-pool")).toMatchObject(
      {
        status: "ok",
        detail: "1/2 active providers ready",
      },
    );
  });
});

describe("monorepo code-review collector", () => {
  test("propagates runtime configuration validation failures instead of inventing default weights", async () => {
    await expect(
      collectMonorepoCodeReview({
        now,
        loadRuntimeConfig: () =>
          Promise.reject(new Error("Invalid temporal-code-review-settings")),
        readCoordinator: () =>
          Promise.resolve({
            observed: true,
            running: true,
            processedCount: 10,
            currentWeights: {},
            cooldownUntilMs: {},
          }),
      }),
    ).rejects.toThrow("Invalid temporal-code-review-settings");
  });

  test("distinguishes unstarted coordinator from failed coordinator reads and suppresses readiness claims", async () => {
    const unstarted = await describeCodeReviewCoordinatorMemo(() =>
      Promise.reject(
        new WorkflowNotFoundError("not found", "code-review-coordinator", ""),
      ),
    );
    expect(unstarted).toEqual({
      observed: true,
      running: false,
      processedCount: 0,
      currentWeights: {},
      cooldownUntilMs: {},
    });

    const prevAddress = Bun.env["TEMPORAL_ADDRESS"];
    Bun.env["TEMPORAL_ADDRESS"] = "temporal.prod:7233";
    let failedRead;
    try {
      failedRead = await readProdCodeReviewCoordinator(() =>
        Promise.reject(new Error("Temporal RPC unavailable")),
      );
    } finally {
      if (prevAddress === undefined) {
        delete Bun.env["TEMPORAL_ADDRESS"];
      } else {
        Bun.env["TEMPORAL_ADDRESS"] = prevAddress;
      }
    }
    expect(failedRead.observed).toBe(false);

    const codeReview = await collectMonorepoCodeReview({
      now,
      loadRuntimeConfig: () =>
        Promise.resolve({
          enabled: true,
          settings: {
            weights: { coderabbit: 3, codex: 1, cubic: 0 },
            quotaCooldownSeconds: 3600,
            timeoutCooldownSeconds: 900,
            requestRetrySeconds: 720,
            providerTimeoutSeconds: 1500,
          },
        }),
      readCoordinator: () => Promise.resolve(failedRead),
    });

    expect(codeReview.coordinatorObserved).toBe(false);
    expect(codeReview.activeProvidersCount).toBe(2);
    expect(codeReview.readyProvidersCount).toBe(0);
    expect(codeReview.coolingDownProvidersCount).toBe(0);
    expect(
      codeReview.providers.find((p) => p.id === "coderabbit")?.status,
    ).toBe("unknown");
    expect(codeReview.providers.find((p) => p.id === "cubic")?.status).toBe(
      "standby",
    );
    expect(buildCodeReviewPoolAudit(codeReview, now.toISOString())).toEqual({
      id: "code-review-pool",
      label: "PR code-review provider pool",
      status: "unknown",
      lastRunAt: now.toISOString(),
      detail: "Coordinator state unavailable; pool readiness not observed",
    });
  });
});

describe("cluster facet", () => {
  test("combines K8s nodes, workloads, databases, zpools, NVMe, SeaweedFS, and ArgoCD", async () => {
    const facet = await collectClusterFacet({
      services,
      prometheus: createClusterTestPrometheus(),
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
              namespace: "cache",
              name: "cache-postgres-0",
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
            {
              namespace: "promtail",
              name: "promtail-aaaaa",
              phase: "Running",
              createdAt: "2026-11-20T00:00:00Z",
              ownerKind: "DaemonSet",
              restarts: 0,
              problem: undefined,
              stuck: false,
            },
            {
              namespace: "promtail",
              name: "promtail-bbbbb",
              phase: "Running",
              createdAt: "2026-11-20T00:00:00Z",
              ownerKind: "DaemonSet",
              restarts: 3,
              problem: "CrashLoopBackOff",
              stuck: true,
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
        listVeleroBackups: () =>
          Promise.resolve([
            {
              name: "daily-20261121020000",
              namespace: "velero",
              schedule: "daily",
              createdAt: "2026-11-21T02:00:00Z",
              startedAt: "2026-11-21T02:00:01Z",
              completedAt: "2026-11-21T02:05:00Z",
              phase: "Completed",
            },
          ]),
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
    expect(facet.workloadSummary.degraded).toBe(1);
    expect(
      facet.workloads.find(
        (w) => w.namespace === "promtail" && w.name === "promtail",
      ),
    ).toMatchObject({
      kind: "DaemonSet",
      readyReplicas: 1,
      desiredReplicas: 2,
      restarts24h: 3,
    });
    expect(
      facet.databases.find((db) => db.namespace === "tracker"),
    ).toMatchObject({
      namespace: "tracker",
      engine: "postgres",
      veleroBackedUp: true,
    });
    expect(
      facet.databases.find((db) => db.namespace === "cache"),
    ).toMatchObject({
      namespace: "cache",
      engine: "postgres",
      veleroBackedUp: false,
    });
    expect(facet.zpools[0]).toMatchObject({
      node: "torvalds",
      pool: "zfspv-pool-nvme",
      usedBytes: 400_000_000_000,
      health: "DEGRADED",
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
    const prometheus = createMockPrometheus((q) => {
      if (q.includes("prometheus_tsdb_head_series")) {
        return [{ metric: {}, value: [1, "150000"] }];
      }
      if (q === "up == 0") {
        return [
          {
            metric: { job: "node-exporter", instance: "10.0.0.2" },
            value: [1, "0"],
          },
        ];
      }
      return q.startsWith(
        "sum by (service) (rate(traces_spanmetrics_calls_total[5m]))",
      )
        ? [{ metric: { service: "tracker" }, value: [1, "3.45"] }]
        : [];
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
