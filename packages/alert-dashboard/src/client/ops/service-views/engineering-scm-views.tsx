import { Loaded } from "@shepherdjerred/loaded";
import type {
  ClusterArgoApp,
  MonorepoExpensiveTask,
} from "@shepherdjerred/ops-model/facets.ts";
import {
  APP_HOSTS,
  argocdApplicationLink,
} from "@shepherdjerred/ops-model/tool-links.ts";
import { useQuery } from "@tanstack/react-query";
import { ExternalLinkIcon } from "lucide-react";

import { SeriesChart } from "#client/charts/series-chart.tsx";
import { mapGitHubPrToStackPr } from "#client/ops/flow-enrichment.tsx";
import { facetQuery } from "#client/ops/ops-api.ts";
import { StaleNotice } from "#client/stale-notice.tsx";
import {
  DataTable,
  StackTree,
  type DataTableColumn,
} from "#client/visuals/index.ts";
import { formatValue } from "#shared/ops-format";
import type { SeriesRange } from "#shared/ops-schema";

const CI_TASK_COLUMNS: readonly DataTableColumn<MonorepoExpensiveTask>[] = [
  {
    key: "taskId",
    header: "Task",
    sortValue: (row) => row.taskId,
    render: (row) => <code className="eng-pkg-name">{row.taskId}</code>,
  },
  {
    key: "hits",
    header: "Hits",
    align: "right",
    sortValue: (row) => row.hits,
    render: (row) => formatValue(row.hits, "count"),
  },
  {
    key: "misses",
    header: "Misses",
    align: "right",
    sortValue: (row) => row.misses,
    render: (row) => formatValue(row.misses, "count"),
  },
  {
    key: "hitRatio",
    header: "Hit Ratio",
    align: "right",
    sortValue: (row) => row.hitRatio,
    render: (row) => formatValue(row.hitRatio, "ratio"),
  },
  {
    key: "medianMissMs",
    header: "Median Miss",
    align: "right",
    sortValue: (row) => row.medianMissMs,
    render: (row) => formatValue(row.medianMissMs, "ms"),
  },
  {
    key: "totalMissMinutes",
    header: "Total Miss Time",
    align: "right",
    sortValue: (row) => row.totalMissMinutes,
    render: (row) => `${row.totalMissMinutes.toFixed(1)} min`,
  },
];

const ARGO_COLUMNS: readonly DataTableColumn<ClusterArgoApp>[] = [
  {
    key: "name",
    header: "Application",
    sortValue: (app) => app.name,
    render: (app) => {
      const link = argocdApplicationLink(app.name);
      return (
        <div className="eng-pkg-cell">
          <a
            className="eng-ext-link"
            href={link.url}
            target="_blank"
            rel="noreferrer"
          >
            {app.name}
            <ExternalLinkIcon aria-hidden="true" />
          </a>
          <span className="eng-pkg-sub">{app.namespace}</span>
        </div>
      );
    },
  },
  {
    key: "syncStatus",
    header: "Sync Status",
    sortValue: (app) => app.syncStatus,
    render: (app) => (
      <span
        className={`visual-pill visual-pill-${app.syncStatus === "Synced" ? "ok" : "warning"}`}
      >
        <span aria-hidden="true">
          {app.syncStatus === "Synced" ? "✓" : "!"}
        </span>
        {app.syncStatus}
      </span>
    ),
  },
  {
    key: "healthStatus",
    header: "Health",
    sortValue: (app) => app.healthStatus,
    render: (app) => (
      <span
        className={`visual-pill visual-pill-${app.healthStatus === "Healthy" ? "ok" : app.healthStatus === "Progressing" ? "info" : "error"}`}
      >
        <span aria-hidden="true">
          {app.healthStatus === "Healthy"
            ? "✓"
            : app.healthStatus === "Progressing"
              ? "•"
              : "✕"}
        </span>
        {app.healthStatus}
      </span>
    ),
  },
  {
    key: "autoSync",
    header: "Sync Policy",
    sortValue: (app) => (app.autoSync ? "auto" : "manual"),
    render: (app) => (
      <span className="visual-pill visual-pill-neutral">
        {app.autoSync ? "auto" : "manual"}
      </span>
    ),
  },
  {
    key: "revision",
    header: "Revision",
    sortValue: (app) => app.revision,
    render: (app) => <code className="visual-branch-chip">{app.revision}</code>,
  },
];

export function CiServiceView({
  range,
}: {
  readonly range: SeriesRange;
}): React.JSX.Element {
  const githubLoaded = Loaded.fromQuery(useQuery(facetQuery("github")));
  const monorepoLoaded = Loaded.fromQuery(useQuery(facetQuery("monorepo")));
  const github = Loaded.getOrElse(githubLoaded, undefined)?.data ?? null;
  const monorepo = Loaded.getOrElse(monorepoLoaded, undefined)?.data ?? null;

  return (
    <section className="eng-service-view" aria-label="CI telemetry and queue">
      <div className="chart-grid">
        <SeriesChart
          preset="woodpecker-pipelines"
          range={range}
          mode="bar"
          title="Woodpecker active CI pods"
          syncKey="svc-ci"
        />
        <SeriesChart
          preset="kueue-pending-workloads"
          range={range}
          title="Kueue pending workloads"
          syncKey="svc-ci"
        />
        <SeriesChart
          preset="kueue-cpu-quota"
          range={range}
          threshold={{ value: 23, label: "23 CPU quota", tone: "warning" }}
          title="Kueue CPU usage vs reservation"
          syncKey="svc-ci"
        />
        <SeriesChart
          preset="prs-merged"
          range={range}
          mode="bar"
          title="Pull requests merged (7d)"
          syncKey="svc-ci"
        />
        <SeriesChart
          preset="github-rate-limit"
          range={range}
          title="GitHub API rate limit remaining"
          syncKey="svc-ci"
        />
        <SeriesChart
          preset="turbo-network-bps"
          range={range}
          mode="stacked-area"
          title="Turborepo cache throughput"
          syncKey="svc-ci"
        />
      </div>
      {github === null ? null : (
        <div className="eng-flow-panel">
          <div className="eng-flow-head">
            <h3>Open pull request stacks</h3>
          </div>
          <StackTree
            pullRequests={github.openPrs.map((pr) => mapGitHubPrToStackPr(pr))}
            emptyMessage="No open pull requests."
          />
        </div>
      )}
      {monorepo === null ? null : (
        <DataTable
          caption="Expensive Turborepo cache misses"
          rows={monorepo.expensiveTasks}
          rowKey={(row) => row.taskId}
          columns={CI_TASK_COLUMNS}
          defaultSort={{ key: "totalMissMinutes", direction: "descending" }}
          initialCap={10}
          exportFilename="ci-expensive-tasks"
          emptyMessage="No expensive cache misses recorded."
        />
      )}
    </section>
  );
}

export function DeliveryServiceView({
  range,
}: {
  readonly range: SeriesRange;
}): React.JSX.Element {
  return (
    <section className="eng-service-view" aria-label="Delivery control plane">
      <div className="eng-callout">
        <div className="eng-callout-body">
          <p className="eng-callout-title">
            Read-only Delivery release telemetry. Manage gates, rollbacks, and
            promotions in{" "}
            <a
              className="eng-ext-link"
              href={APP_HOSTS.delivery}
              target="_blank"
              rel="noreferrer"
            >
              Delivery ({APP_HOSTS.delivery})
              <ExternalLinkIcon aria-hidden="true" />
            </a>
            .
          </p>
        </div>
      </div>
      <div className="chart-grid">
        <SeriesChart
          preset="delivery-active"
          range={range}
          mode="stacked-area"
          title="Active Delivery deployments"
          syncKey="svc-delivery"
        />
        <SeriesChart
          preset="delivery-outcomes"
          range={range}
          mode="bar"
          title="Delivery deployments by outcome"
          syncKey="svc-delivery"
        />
      </div>
    </section>
  );
}

export function GitOpsServiceView({
  range,
}: {
  readonly range: SeriesRange;
}): React.JSX.Element {
  const loaded = Loaded.fromQuery(useQuery(facetQuery("cluster")));
  const cluster = Loaded.getOrElse(loaded, undefined)?.data ?? null;

  return (
    <section className="eng-service-view" aria-label="Argo CD GitOps status">
      {loaded.status === "degraded" ? (
        <StaleNotice errors={loaded.errors} />
      ) : null}
      <div className="chart-grid">
        <SeriesChart
          preset="argocd-sync-status"
          range={range}
          mode="stacked-area"
          title="Argo CD applications by sync status"
          syncKey="svc-gitops"
        />
        <SeriesChart
          preset="argocd-health-status"
          range={range}
          mode="stacked-area"
          title="Argo CD applications by health"
          syncKey="svc-gitops"
        />
      </div>
      {cluster === null ? null : (
        <DataTable
          caption="Argo CD applications"
          rows={cluster.argoApps}
          rowKey={(app) => `${app.namespace}/${app.name}`}
          columns={ARGO_COLUMNS}
          defaultSort={{ key: "name", direction: "ascending" }}
          initialCap={25}
          searchPlaceholder="Search application, sync, health, or revision…"
          searchText={(app) =>
            `${app.name} ${app.namespace} ${app.syncStatus} ${app.healthStatus} ${app.revision}`
          }
          exportFilename="argocd-applications"
          emptyMessage="No Argo CD applications reported."
        />
      )}
    </section>
  );
}
