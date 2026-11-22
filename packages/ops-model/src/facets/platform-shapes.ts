import { z } from "zod";

const MonorepoAuditStatusInternalSchema = z.enum([
  "ok",
  "warning",
  "error",
  "unknown",
]);

export const monorepoFacetShape = {
  packageCount: z.number(),
  turboHitRatio7d: z.number().nullable(),
  turboSavedHours7d: z.number().nullable(),
  verifyRunsAnalyzed: z.number(),
  packages: z.array(
    z.object({
      name: z.string(),
      path: z.string(),
      category: z.string(),
      serviceId: z.string().nullable(),
      hasExtendedTests: z.boolean(),
      openPrCount: z.number(),
      renovatePendingCount: z.number(),
      bugsinkOpenCount: z.number(),
      flagCount: z.number(),
      cacheHitRatio: z.number().nullable(),
      medianDurationMs: z.number().nullable(),
    }),
  ),
  expensiveTasks: z.array(
    z.object({
      taskId: z.string(),
      packageName: z.string(),
      task: z.string(),
      hits: z.number(),
      misses: z.number(),
      hitRatio: z.number(),
      medianMissMs: z.number(),
      totalMissMinutes: z.number(),
    }),
  ),
  catalogPinsCount: z.number(),
  audits: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
      status: MonorepoAuditStatusInternalSchema,
      lastRunAt: z.string().nullable(),
      detail: z.string().optional(),
    }),
  ),
};

const ClusterDatabaseEngineInternalSchema = z.enum(["postgres", "mariadb"]);

export const clusterFacetShape = {
  nodes: z.array(
    z.object({
      name: z.string(),
      ready: z.boolean(),
      cpuCores: z.number(),
      cpuRatio: z.number().nullable(),
      memoryBytes: z.number(),
      memoryRatio: z.number().nullable(),
      zfsArcBytes: z.number().nullable(),
      tempCelsius: z.number().nullable(),
      kubeletVersion: z.string(),
      talosVersion: z.string().nullable(),
      kernelVersion: z.string().nullable(),
    }),
  ),
  workloadSummary: z.object({
    total: z.number(),
    healthy: z.number(),
    degraded: z.number(),
    retainedPools: z.number(),
  }),
  workloads: z.array(
    z.object({
      namespace: z.string(),
      kind: z.string(),
      name: z.string(),
      readyReplicas: z.number(),
      desiredReplicas: z.number(),
      restarts24h: z.number(),
      oomKills24h: z.number(),
      image: z.string(),
      serviceId: z.string().nullable(),
      argoApp: z.string().nullable(),
      retainedPool: z.boolean(),
    }),
  ),
  databases: z.array(
    z.object({
      name: z.string(),
      namespace: z.string(),
      engine: ClusterDatabaseEngineInternalSchema,
      ready: z.boolean(),
      usedBytes: z.number().nullable(),
      capacityBytes: z.number().nullable(),
      veleroBackedUp: z.boolean(),
    }),
  ),
  zpools: z.array(
    z.object({
      node: z.string(),
      pool: z.string(),
      usedBytes: z.number(),
      sizeBytes: z.number(),
      freeBytes: z.number(),
      fragmentationPercent: z.number().nullable(),
      health: z.string(),
    }),
  ),
  nvmeDrives: z.array(
    z.object({
      node: z.string(),
      device: z.string(),
      model: z.string().optional(),
      written24hBytes: z.number(),
      dailyBudgetBytes: z.number(),
      wearPercent: z.number().nullable(),
      tempCelsius: z.number().nullable(),
    }),
  ),
  seaweedfs: z.object({
    volumeCount: z.number(),
    maxVolumes: z.number(),
    backupLagSeconds: z.number().nullable(),
    bucketsCount: z.number(),
  }),
  argoApps: z.array(
    z.object({
      name: z.string(),
      namespace: z.string(),
      syncStatus: z.string(),
      healthStatus: z.string(),
      revision: z.string(),
      autoSync: z.boolean(),
    }),
  ),
};

export const observabilityFacetShape = {
  prometheus: z.object({
    headSeries: z.number().nullable(),
    walPlusBlocksBytes: z.number().nullable(),
    downTargets: z.array(
      z.object({ job: z.string(), instance: z.string(), health: z.string() }),
    ),
    topMetricNames: z.array(z.object({ name: z.string(), series: z.number() })),
  }),
  loki: z.object({
    ingestedBytes24h: z.number().nullable(),
    noisyNamespaces: z.array(
      z.object({
        namespace: z.string(),
        bytes24h: z.number(),
        errorLines1h: z.number(),
      }),
    ),
    warningEvents: z.array(
      z.object({
        namespace: z.string(),
        reason: z.string(),
        count1h: z.number(),
      }),
    ),
    rulerRulesCount: z.number(),
  }),
  tempo: z.object({
    servicesRed: z.array(
      z.object({
        service: z.string(),
        spanRate: z.number(),
        errorRate: z.number(),
        p95Ms: z.number().nullable(),
      }),
    ),
  }),
  grafana: z.object({
    datasourcesCount: z.number(),
    dashboardsCount: z.number(),
    dashboards: z.array(
      z.object({
        uid: z.string(),
        title: z.string(),
        folder: z.string().optional(),
        url: z.string(),
      }),
    ),
  }),
};

export const temporalFacetShape = {
  workerPools: z.array(
    z.object({
      deployment: z.string(),
      taskQueue: z.string(),
      readyReplicas: z.number(),
      desiredReplicas: z.number(),
      pollers: z.number().nullable(),
      slotsAvailable: z.number().nullable(),
    }),
  ),
  scheduleSummary: z.object({
    total: z.number(),
    active: z.number(),
    paused: z.number(),
    failing: z.number(),
  }),
  schedules: z.array(
    z.object({
      id: z.string(),
      state: z.string(),
      recentFailures: z.number(),
      lastRunAt: z.string().nullable(),
      nextRunAt: z.string().nullable(),
      taskQueue: z.string().optional(),
    }),
  ),
};
