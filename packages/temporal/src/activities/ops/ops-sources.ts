import type { AlertmanagerClient } from "@shepherdjerred/ops-clients/alertmanager.ts";
import type { BugsinkClient } from "@shepherdjerred/ops-clients/bugsink.ts";
import type { WoodpeckerClient } from "@shepherdjerred/ops-clients/woodpecker.ts";
import type { GitHubClient } from "@shepherdjerred/ops-clients/github.ts";
import type { KubernetesClient } from "@shepherdjerred/ops-clients/kubernetes.ts";
import type { TrackerClient } from "@shepherdjerred/ops-clients/tracker.ts";
import type { LokiClient } from "@shepherdjerred/ops-clients/loki.ts";
import type { PostHogClient } from "@shepherdjerred/ops-clients/posthog.ts";
import {
  errorTraceQuery,
  slowTraceQuery,
  type TempoClient,
} from "@shepherdjerred/ops-clients/tempo.ts";
import type { PrometheusClient } from "@shepherdjerred/ops-clients/prometheus.ts";
import { DEPENDENCY_DASHBOARD_TITLE } from "@shepherdjerred/ops-clients/renovate.ts";
import { OPS_POLICY } from "@shepherdjerred/ops-model/policy.ts";
import {
  bugsinkIssuesUnresolved,
  trackerIssuesOpen,
  renovateUpdatesPending,
  talosNodeReady,
  talosServiceHealthy,
} from "#observability/metrics-ops.ts";
import { recordVeleroOutcomes } from "#observability/metrics-velero.ts";
import { readLatestRenovateQueue } from "#activities/renovate/store.ts";
import { aiQueries, mapAi, monthToDateWindow } from "./ai.ts";
import { mapAlerts } from "./alerts.ts";
import { mapArgoApplications, updateOutOfSyncSince } from "./argocd.ts";
import { mapBugsink, unresolvedByProject } from "./bugsink.ts";
import { mapCi } from "./ci.ts";
import {
  buildBugsinkFacet,
  fetchBugsinkIssuesBounded,
  recordBugsinkFacetGauges,
} from "./facets/bugsink-facet.ts";
import {
  buildGitHubFacet,
  recordGitHubPullRequestGauges,
  safeGitHubRateLimits,
} from "./facets/github-facet.ts";
import {
  buildPostHogFacet,
  POSTHOG_FUNNEL_EVENTS,
  recordPostHogFacetGauges,
} from "./facets/posthog-facet.ts";
import {
  buildRenovateFacet,
  readLatestRenovateDeltas,
  type RenovateDeltaReader,
} from "./facets/renovate-facet.ts";
import { buildTrackerFacet } from "./facets/tracker-facet.ts";
import {
  authorClass,
  CHANGE_WINDOW_DAYS,
  mapGitHub,
  VERSION_CATALOG_PATH,
} from "./github.ts";
import { mapKubernetes } from "./kubernetes.ts";
import { mapTracker } from "./tracker.ts";
import { LOG_WINDOW, mapLogs } from "./logs.ts";
import {
  MAINTENANCE_QUERIES,
  mapMaintenance,
  type MaintenanceQuery,
} from "./maintenance.ts";
import {
  daysBefore,
  type OpsCollection,
  type OpsContext,
} from "./ops-types.ts";
import { mapPostHog, mapProbes, PROBE_QUERY } from "./product.ts";
import { mapRenovate } from "./renovate.ts";
import { mapTalos, parseMachineStatuses, parseServices } from "./talos.ts";
import { mapTraces, TRACE_WINDOW_MS } from "./traces.ts";
import { veleroOutcomes } from "./velero-outcomes.ts";
import { veleroRestoreSignals } from "./storage/velero-restores.ts";
import {
  zfsDeletionSignals,
  ZFS_DELETION_BYTES_QUERY,
} from "./storage/zfs-deletion.ts";

// Each collector does the I/O for one source, updates that source's gauges,
// and hands the upstream data to its pure mapper.

export async function collectAlerts(
  alertmanager: AlertmanagerClient,
  context: OpsContext,
): Promise<OpsCollection> {
  const [alerts, silences] = await Promise.all([
    alertmanager.firingAlerts(),
    alertmanager.activeSilences(),
  ]);
  return mapAlerts(alerts, silences, context);
}

export async function collectKubernetes(
  kubernetes: KubernetesClient,
  context: OpsContext,
): Promise<OpsCollection> {
  const [nodes, pods] = await Promise.all([
    kubernetes.listNodes(),
    kubernetes.listPods(),
  ]);
  return mapKubernetes(nodes, pods, context);
}

export async function collectArgo(
  kubernetes: KubernetesClient,
  outOfSyncSince: Map<string, Date>,
  context: OpsContext,
): Promise<OpsCollection> {
  const apps = await kubernetes.listArgoApplications();
  updateOutOfSyncSince(outOfSyncSince, apps, context.now);
  return mapArgoApplications(apps, outOfSyncSince, context);
}

/** Runs `talosctl <args>` and returns stdout; throws on a non-zero exit. */
export type Talosctl = (args: readonly string[]) => Promise<string>;

export async function collectTalos(talosctl: Talosctl): Promise<OpsCollection> {
  const [machineOutput, serviceOutput] = await Promise.all([
    talosctl(["get", "machinestatus", "-o", "json"]),
    talosctl(["get", "services", "-o", "json"]),
  ]);
  const machines = parseMachineStatuses(machineOutput);
  const services = parseServices(serviceOutput);
  talosNodeReady.reset();
  for (const machine of machines) {
    talosNodeReady.set({ node: machine.node }, machine.ready ? 1 : 0);
  }
  talosServiceHealthy.reset();
  for (const service of services) {
    talosServiceHealthy.set(
      { node: service.node, service: service.service },
      service.running && service.healthy !== false ? 1 : 0,
    );
  }
  return mapTalos(machines, services);
}

export async function collectCi(
  woodpecker: WoodpeckerClient,
  context: OpsContext,
): Promise<OpsCollection> {
  return mapCi(await woodpecker.branchStatus("main"), context);
}

export async function collectGitHub(
  github: GitHubClient,
  context: OpsContext,
): Promise<OpsCollection> {
  const [open, merged30d, imagePins, rateLimits] = await Promise.all([
    github.openPullRequests(),
    github.mergedPullRequests(daysBefore(context.now, 30)),
    github.commitsTouching({
      branch: "main",
      path: VERSION_CATALOG_PATH,
      since: daysBefore(context.now, CHANGE_WINDOW_DAYS),
    }),
    safeGitHubRateLimits(github),
  ]);
  const weekAgo = daysBefore(context.now, 7).getTime();
  recordGitHubPullRequestGauges(
    open,
    merged30d
      .filter((pr) => Date.parse(pr.mergedAt) >= weekAgo)
      .map((pr) => ({ authorClass: authorClass(pr.author, pr.branch ?? "") })),
    context.now,
  );
  const collection = mapGitHub({ open, merged30d, imagePins }, context);
  const githubFacet = buildGitHubFacet({
    open,
    merged30d,
    rateLimits,
    now: context.now,
  });
  return {
    ...collection,
    facets: { github: githubFacet },
  };
}

export async function collectRenovate(
  github: GitHubClient,
  options?: {
    now?: Date;
    readDeltas?: RenovateDeltaReader;
    readRanking?: typeof readLatestRenovateQueue;
  },
): Promise<OpsCollection> {
  const now = options?.now ?? new Date();
  const readDeltas = options?.readDeltas ?? readLatestRenovateDeltas;
  const [dashboard, open, merged30d, deltasByBranch, ranking] =
    await Promise.all([
      github.openIssueByTitle(DEPENDENCY_DASHBOARD_TITLE),
      github.openPullRequests(),
      github.mergedPullRequests(daysBefore(now, 30)),
      readDeltas(),
      (options?.readRanking ?? readLatestRenovateQueue)(),
    ]);
  const { counts: legacyCounts, ...collection } = mapRenovate(dashboard, open);
  const renovateFacet = buildRenovateFacet({
    dashboard,
    openPullRequests: open,
    merged30d,
    deltasByBranch,
    now,
  });
  renovateUpdatesPending.reset();
  for (const [state, count] of Object.entries(renovateFacet.counts)) {
    renovateUpdatesPending.set({ state }, count);
  }
  renovateUpdatesPending.set({ state: "open-pr" }, legacyCounts["open-pr"]);
  return {
    ...collection,
    facets: {
      renovate: {
        ...renovateFacet,
        ...(ranking === undefined ? {} : { ranking }),
      },
    },
  };
}

export async function collectTracker(
  tracker: TrackerClient,
  now = new Date(),
): Promise<OpsCollection> {
  const [overview, secondary] = await Promise.all([
    tracker.overview(),
    Promise.allSettled([
      tracker.activeForumNotices(),
      tracker.projectIssueCounts(now),
      tracker.completedThroughput7d(now),
    ]),
  ]);
  const notices = secondary[0].status === "fulfilled" ? secondary[0].value : [];
  const projects =
    secondary[1].status === "fulfilled" ? secondary[1].value : [];
  const throughput =
    secondary[2].status === "fulfilled" ? secondary[2].value : null;

  trackerIssuesOpen.reset();
  for (const [team, states] of Object.entries(overview.counts)) {
    for (const [stateType, count] of Object.entries(states)) {
      trackerIssuesOpen.set({ team, state_type: stateType }, count);
    }
  }
  const collection = mapTracker(overview);
  const trackerFacet = buildTrackerFacet({
    overview,
    notices,
    projects,
    throughput,
  });
  return {
    ...collection,
    facets: { tracker: trackerFacet },
  };
}

export async function collectBugsink(
  bugsink: BugsinkClient,
  context: OpsContext,
): Promise<OpsCollection> {
  const withIssues = await fetchBugsinkIssuesBounded(bugsink);
  bugsinkIssuesUnresolved.reset();
  for (const [project, count] of unresolvedByProject(withIssues)) {
    bugsinkIssuesUnresolved.set({ project }, count);
  }
  const collection = mapBugsink(withIssues, context);
  const bugsinkFacet = buildBugsinkFacet({
    projectsWithIssues: withIssues,
    now: context.now,
  });
  recordBugsinkFacetGauges(bugsinkFacet);
  return {
    ...collection,
    facets: { bugsink: bugsinkFacet },
  };
}

export async function collectPostHog(
  posthog: PostHogClient,
  context: OpsContext,
): Promise<OpsCollection> {
  const [traffic, topPages, secondary] = await Promise.all([
    posthog.siteTrafficSummary(context.now),
    posthog.topPages24h(),
    Promise.allSettled([
      posthog.webVitalsByHost24h(),
      posthog.topReferrers24h(),
      posthog.eventCountsWindow(POSTHOG_FUNNEL_EVENTS),
    ]),
  ]);

  const webVitals =
    secondary[0].status === "fulfilled" ? secondary[0].value : [];
  const topReferrers =
    secondary[1].status === "fulfilled" ? secondary[1].value : [];
  const funnelCounts =
    secondary[2].status === "fulfilled" ? secondary[2].value : [];

  const sitePageviews = traffic.map((row) => ({
    siteKey: row.siteKey,
    host: row.host,
    pageviews: row.pageviews24h,
  }));
  const collection = mapPostHog(sitePageviews, topPages, context);
  const posthogFacet = buildPostHogFacet({
    traffic,
    topPages,
    webVitals,
    topReferrers,
    funnelCounts,
    services: context.services,
  });
  recordPostHogFacetGauges(posthogFacet);
  return {
    ...collection,
    facets: { posthog: posthogFacet },
  };
}

export async function collectProbes(
  prometheus: PrometheusClient,
  context: OpsContext,
): Promise<OpsCollection> {
  return mapProbes(await prometheus.query(PROBE_QUERY), context);
}

export async function collectLogs(
  loki: LokiClient,
  context: OpsContext,
): Promise<OpsCollection> {
  return mapLogs(
    await loki.errorVolumeByNamespace(LOG_WINDOW, context.now),
    context,
  );
}

export async function collectTraces(
  tempo: TempoClient,
  context: OpsContext,
): Promise<OpsCollection> {
  const window = {
    start: new Date(context.now.getTime() - TRACE_WINDOW_MS),
    end: context.now,
    limit: OPS_POLICY.traceSearchLimit,
  };
  const [errors, slow] = await Promise.all([
    tempo.search({ query: errorTraceQuery(), ...window }),
    tempo.search({
      query: slowTraceQuery(OPS_POLICY.slowTraceSeconds),
      ...window,
    }),
  ]);
  return mapTraces(errors, slow, context);
}

export async function collectMaintenance(
  prometheus: PrometheusClient,
  kubernetes: Pick<
    KubernetesClient,
    | "listVeleroSchedules"
    | "listVeleroBackups"
    | "listVeleroRestores"
    | "listDeletingZfsVolumes"
  >,
  now: Date,
): Promise<OpsCollection> {
  const run = (key: MaintenanceQuery) =>
    prometheus.query(MAINTENANCE_QUERIES[key]);
  const [
    certificates,
    probeCertificates,
    filesystems,
    zpools,
    veleroBackups,
    cpu,
    memory,
    seaweedfsVolumes,
    seaweedfsBackupLag,
    schedules,
    backupResources,
    restoreResources,
    deletingVolumes,
    referencedBytes,
  ] = await Promise.all([
    run("certificates"),
    run("probeCertificates"),
    run("filesystems"),
    run("zpools"),
    run("veleroBackups"),
    run("cpu"),
    run("memory"),
    run("seaweedfsVolumes"),
    run("seaweedfsBackupLag"),
    kubernetes.listVeleroSchedules(),
    kubernetes.listVeleroBackups(),
    kubernetes.listVeleroRestores(),
    kubernetes.listDeletingZfsVolumes(),
    prometheus.query(ZFS_DELETION_BYTES_QUERY),
  ]);
  const collection = mapMaintenance(
    {
      certificates,
      probeCertificates,
      filesystems,
      zpools,
      veleroBackups,
      cpu,
      memory,
      seaweedfsVolumes,
      seaweedfsBackupLag,
    },
    schedules,
    backupResources,
    now,
  );
  recordVeleroOutcomes(
    veleroOutcomes(backupResources, schedules).observations,
    now,
  );
  return {
    ...collection,
    signals: [
      ...collection.signals,
      ...veleroRestoreSignals(restoreResources),
      ...zfsDeletionSignals(deletingVolumes, referencedBytes, now),
    ],
  };
}

export async function collectAi(
  prometheus: PrometheusClient,
  context: OpsContext,
): Promise<OpsCollection> {
  const queries = aiQueries(monthToDateWindow(context.now));
  const run = (key: keyof typeof queries) => prometheus.query(queries[key]);
  const [
    clusterMtd,
    billedToday,
    macCostMtd,
    macTokens24h,
    clusterTokens24h,
    quotas,
    quotaResets,
  ] = await Promise.all([
    run("clusterMtd"),
    run("billedToday"),
    run("macCostMtd"),
    run("macTokens24h"),
    run("clusterTokens24h"),
    run("quotas"),
    run("quotaResets"),
  ]);
  return mapAi(
    {
      clusterMtd,
      billedToday,
      macCostMtd,
      macTokens24h,
      clusterTokens24h,
      quotas,
      quotaResets,
    },
    context.now,
  );
}
