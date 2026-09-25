import type { AlertmanagerClient } from "@shepherdjerred/ops-clients/alertmanager.ts";
import type { BugsinkClient } from "@shepherdjerred/ops-clients/bugsink.ts";
import type { WoodpeckerClient } from "@shepherdjerred/ops-clients/woodpecker.ts";
import type {
  GitHubClient,
  OpenPullRequest,
} from "@shepherdjerred/ops-clients/github.ts";
import type { KubernetesClient } from "@shepherdjerred/ops-clients/kubernetes.ts";
import type { LinearClient } from "@shepherdjerred/ops-clients/linear.ts";
import type { LokiClient } from "@shepherdjerred/ops-clients/loki.ts";
import type { PostHogClient } from "@shepherdjerred/ops-clients/posthog.ts";
import type { PrometheusClient } from "@shepherdjerred/ops-clients/prometheus.ts";
import { DEPENDENCY_DASHBOARD_TITLE } from "@shepherdjerred/ops-clients/renovate.ts";
import {
  bugsinkIssuesUnresolved,
  githubPullRequestOldestOpenAgeSeconds,
  githubPullRequestsMerged7d,
  githubPullRequestsOpen,
  linearIssuesOpen,
  renovateUpdatesPending,
  talosNodeReady,
  talosServiceHealthy,
} from "#observability/metrics-ops.ts";
import { aiQueries, mapAi, monthToDateWindow } from "./ai.ts";
import { mapAlerts } from "./alerts.ts";
import { mapArgoApplications, updateOutOfSyncSince } from "./argocd.ts";
import { mapBugsink, unresolvedByProject } from "./bugsink.ts";
import { mapCi } from "./ci.ts";
import {
  authorClass,
  CHANGE_WINDOW_DAYS,
  mapGitHub,
  VERSION_CATALOG_PATH,
} from "./github.ts";
import { mapKubernetes } from "./kubernetes.ts";
import { mapLinear } from "./linear.ts";
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

function setPullRequestGauges(
  open: readonly OpenPullRequest[],
  merged7d: readonly { authorClass: string }[],
  now: Date,
): void {
  githubPullRequestsOpen.reset();
  githubPullRequestOldestOpenAgeSeconds.reset();
  const oldest = new Map<string, number>();
  for (const pr of open) {
    const author = authorClass(pr.author, pr.branch);
    githubPullRequestsOpen.inc({
      author_class: author,
      draft: String(pr.draft),
    });
    if (!pr.draft) {
      const age = (now.getTime() - Date.parse(pr.createdAt)) / 1000;
      oldest.set(author, Math.max(oldest.get(author) ?? 0, age));
    }
  }
  for (const [author, age] of oldest) {
    githubPullRequestOldestOpenAgeSeconds.set({ author_class: author }, age);
  }
  githubPullRequestsMerged7d.reset();
  for (const pr of merged7d) {
    githubPullRequestsMerged7d.inc({ author_class: pr.authorClass });
  }
}

export async function collectGitHub(
  github: GitHubClient,
  context: OpsContext,
): Promise<OpsCollection> {
  const [open, merged30d, imagePins] = await Promise.all([
    github.openPullRequests(),
    github.mergedPullRequests(daysBefore(context.now, 30)),
    github.commitsTouching({
      branch: "main",
      path: VERSION_CATALOG_PATH,
      since: daysBefore(context.now, CHANGE_WINDOW_DAYS),
    }),
  ]);
  const weekAgo = daysBefore(context.now, 7).getTime();
  setPullRequestGauges(
    open,
    merged30d
      .filter((pr) => Date.parse(pr.mergedAt) >= weekAgo)
      .map((pr) => ({ authorClass: authorClass(pr.author, "") })),
    context.now,
  );
  return mapGitHub({ open, merged30d, imagePins }, context);
}

export async function collectRenovate(
  github: GitHubClient,
): Promise<OpsCollection> {
  const [dashboard, open] = await Promise.all([
    github.openIssueByTitle(DEPENDENCY_DASHBOARD_TITLE),
    github.openPullRequests(),
  ]);
  const { counts, ...collection } = mapRenovate(dashboard, open);
  renovateUpdatesPending.reset();
  for (const [state, count] of Object.entries(counts)) {
    renovateUpdatesPending.set({ state }, count);
  }
  return collection;
}

export async function collectLinear(
  linear: LinearClient,
): Promise<OpsCollection> {
  const overview = await linear.overview();
  linearIssuesOpen.reset();
  for (const [team, states] of Object.entries(overview.counts)) {
    for (const [stateType, count] of Object.entries(states)) {
      linearIssuesOpen.set({ team, state_type: stateType }, count);
    }
  }
  return mapLinear(overview);
}

export async function collectBugsink(
  bugsink: BugsinkClient,
  context: OpsContext,
): Promise<OpsCollection> {
  const projects = await bugsink.projects();
  const withIssues = await Promise.all(
    projects.map(async (project) => ({
      project,
      issues: await bugsink.unresolvedIssues(project.id),
    })),
  );
  bugsinkIssuesUnresolved.reset();
  for (const [project, count] of unresolvedByProject(withIssues)) {
    bugsinkIssuesUnresolved.set({ project }, count);
  }
  return mapBugsink(withIssues, context);
}

export async function collectPostHog(
  posthog: PostHogClient,
  context: OpsContext,
): Promise<OpsCollection> {
  const [sites, topPages] = await Promise.all([
    posthog.pageviewsByHost24h(),
    posthog.topPages24h(),
  ]);
  return mapPostHog(sites, topPages, context);
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

export async function collectMaintenance(
  prometheus: PrometheusClient,
): Promise<OpsCollection> {
  const run = (key: MaintenanceQuery) =>
    prometheus.query(MAINTENANCE_QUERIES[key]);
  const [
    certificates,
    probeCertificates,
    filesystems,
    zpools,
    seaweedfsBackups,
    veleroBackups,
    cpu,
    memory,
  ] = await Promise.all([
    run("certificates"),
    run("probeCertificates"),
    run("filesystems"),
    run("zpools"),
    run("seaweedfsBackups"),
    run("veleroBackups"),
    run("cpu"),
    run("memory"),
  ]);
  return mapMaintenance({
    certificates,
    probeCertificates,
    filesystems,
    zpools,
    seaweedfsBackups,
    veleroBackups,
    cpu,
    memory,
  });
}

export async function collectAi(
  prometheus: PrometheusClient,
  context: OpsContext,
): Promise<OpsCollection> {
  const queries = aiQueries(monthToDateWindow(context.now));
  const run = (key: keyof typeof queries) => prometheus.query(queries[key]);
  const [
    billedMtd,
    openAiToday,
    macCostMtd,
    macTokens24h,
    clusterTokens24h,
    quotas,
    quotaResets,
  ] = await Promise.all([
    run("billedMtd"),
    run("openAiToday"),
    run("macCostMtd"),
    run("macTokens24h"),
    run("clusterTokens24h"),
    run("quotas"),
    run("quotaResets"),
  ]);
  return mapAi(
    {
      billedMtd,
      openAiToday,
      macCostMtd,
      macTokens24h,
      clusterTokens24h,
      quotas,
      quotaResets,
    },
    context.now,
  );
}
