import type {
  BugsinkTopIssue,
  ClusterFacet,
  TemporalFacet,
} from "@shepherdjerred/ops-model/facets.ts";
import { ExternalLinkIcon } from "lucide-react";
import { useMemo, useState } from "react";

import {
  NetworkingServiceView,
  StorageServiceView,
} from "./platform-edge-views.tsx";
import { useOptionalFacet } from "./platform-facet.ts";
import { ObservabilityServiceView } from "./platform-observability-views.tsx";
import { SeriesChart } from "#client/charts/series-chart.tsx";
import {
  ChartGrid,
  kpiCard,
  numTableCol,
  statusPill,
  tableCol,
  WORKLOAD_COLUMNS,
} from "#client/ops/pages/cluster-page.tsx";
import { age } from "#client/time.ts";
import { DataTable, type DataTableColumn } from "#client/visuals/index.ts";
import { formatValue } from "#shared/ops-format";
import type { SeriesRange, ServiceDetail } from "#shared/ops-schema";
import "#styles/platform.css";

const POOL_COLUMNS: readonly DataTableColumn<
  TemporalFacet["workerPools"][number]
>[] = [
  tableCol(
    "dep",
    "Deployment",
    (r) => <span className="mono">{r.deployment}</span>,
    (r) => r.deployment,
  ),
  tableCol(
    "tq",
    "Task Queue",
    (r) => <span className="mono">{r.taskQueue}</span>,
    (r) => r.taskQueue,
  ),
  tableCol(
    "ready",
    "Ready",
    (r) =>
      statusPill(
        r.readyReplicas >= r.desiredReplicas ? "ok" : "warning",
        r.readyReplicas >= r.desiredReplicas ? "✓" : "!",
        `${String(r.readyReplicas)}/${String(r.desiredReplicas)}`,
      ),
    (r) => r.readyReplicas - r.desiredReplicas,
  ),
  numTableCol(
    "pollers",
    "Pollers",
    (r) => formatValue(r.pollers, "count"),
    (r) => r.pollers,
  ),
  numTableCol(
    "slots",
    "Slots Available",
    (r) => formatValue(r.slotsAvailable, "count"),
    (r) => r.slotsAvailable,
  ),
];

const SCHEDULE_COLUMNS: readonly DataTableColumn<
  TemporalFacet["schedules"][number]
>[] = [
  tableCol(
    "id",
    "Schedule",
    (r) => <span className="mono">{r.id}</span>,
    (r) => r.id,
  ),
  tableCol(
    "state",
    "State",
    (r) =>
      r.state === "active"
        ? statusPill("ok", "✓", r.state)
        : statusPill("neutral", "•", r.state),
    (r) => r.state,
  ),
  numTableCol(
    "failures",
    "Recent Failures",
    (r) =>
      r.recentFailures > 0
        ? statusPill("error", "✕", String(r.recentFailures))
        : "0",
    (r) => r.recentFailures,
  ),
  tableCol("tq", "Task Queue", (r) => (
    <span className="mono">{r.taskQueue ?? "—"}</span>
  )),
  tableCol("last", "Last Run", (r) =>
    r.lastRunAt === null ? "—" : age(r.lastRunAt),
  ),
];

function TemporalServiceView({
  range,
}: {
  readonly range: SeriesRange;
}): React.JSX.Element {
  const temporal = useOptionalFacet("temporal");
  const [stateFilter, setStateFilter] = useState("all");
  const summary = temporal?.scheduleSummary;
  const sortedSchedules = useMemo(() => {
    const sorted = [...(temporal?.schedules ?? [])].sort((a, b) =>
      b.recentFailures === a.recentFailures
        ? a.id.localeCompare(b.id)
        : b.recentFailures - a.recentFailures,
    );
    return stateFilter === "all"
      ? sorted
      : sorted.filter((s) => s.state === stateFilter);
  }, [stateFilter, temporal?.schedules]);

  return (
    <div className="platform-section">
      <h2 className="block-heading">Temporal Control Plane & Schedules</h2>
      {summary === undefined ? null : (
        <div className="platform-kpi-grid">
          {kpiCard(
            "Total Schedules",
            String(summary.total),
            "Declarative fleet",
          )}
          {kpiCard("Active", String(summary.active), "Running on cadence")}
          {kpiCard(
            "Paused",
            String(summary.paused),
            "Explicitly paused",
            "info",
          )}
          {kpiCard(
            "Failing",
            String(summary.failing),
            "Recent workflow failures",
            summary.failing > 0 ? "error" : "ok",
          )}
        </div>
      )}
      <SeriesChart
        preset="temporal-schedules-by-state"
        range={range}
        mode="stacked-area"
        syncKey="temporal"
      />
      <DataTable
        caption="Temporal worker pools"
        rows={temporal?.workerPools ?? []}
        rowKey={(r) => `${r.deployment}:${r.taskQueue}`}
        columns={POOL_COLUMNS}
      />
      <DataTable
        caption="Declarative schedules"
        rows={sortedSchedules}
        rowKey={(r) => r.id}
        columns={SCHEDULE_COLUMNS}
        initialCap={25}
        searchPlaceholder="Search schedule ID or task queue…"
        searchText={(r) => `${r.id} ${r.taskQueue ?? ""} ${r.state}`}
        filters={[
          {
            key: "state",
            label: "Schedule state",
            value: stateFilter,
            onChange: setStateFilter,
            options: [
              { value: "all", label: "All" },
              { value: "active", label: "Active" },
              { value: "paused", label: "Paused" },
            ],
          },
        ]}
      />
    </div>
  );
}

const NODE_COLUMNS: readonly DataTableColumn<ClusterFacet["nodes"][number]>[] =
  [
    tableCol(
      "name",
      "Node",
      (r) => <span className="mono">{r.name}</span>,
      (r) => r.name,
    ),
    tableCol("ready", "Ready", (r) =>
      r.ready
        ? statusPill("ok", "✓", "Ready")
        : statusPill("error", "✕", "NotReady"),
    ),
    numTableCol(
      "cpu",
      "CPU",
      (r) => formatValue(r.cpuRatio, "ratio"),
      (r) => r.cpuRatio,
    ),
    numTableCol(
      "mem",
      "Memory",
      (r) => formatValue(r.memoryRatio, "ratio"),
      (r) => r.memoryRatio,
    ),
    numTableCol(
      "temp",
      "Temp",
      (r) => formatValue(r.tempCelsius, "celsius"),
      (r) => r.tempCelsius,
    ),
    tableCol("os", "Kubelet / Talos", (r) => (
      <span className="mono">{`${r.kubeletVersion} · ${r.talosVersion ?? "—"}`}</span>
    )),
  ];

function ClusterBaselineView({
  range,
}: {
  readonly range: SeriesRange;
}): React.JSX.Element {
  const cluster = useOptionalFacet("cluster");
  return (
    <div className="platform-section">
      <h2 className="block-heading">Kubernetes & Talos Baseline</h2>
      <ChartGrid
        range={range}
        syncKey="cluster-baseline"
        charts={["node-cpu", "node-memory", "node-temp", "etcd-db-bytes"]}
      />
      <DataTable
        caption="Cluster nodes"
        rows={cluster?.nodes ?? []}
        rowKey={(r) => r.name}
        columns={NODE_COLUMNS}
      />
    </div>
  );
}

export function renderPlatformServiceView(
  id: string,
  range: SeriesRange,
): React.JSX.Element | null {
  switch (id) {
    case "networking":
      return <NetworkingServiceView range={range} />;
    case "storage":
      return <StorageServiceView range={range} />;
    case "static-sites":
      return (
        <div className="platform-section">
          <h2 className="block-heading">
            SeaweedFS & Caddy Static Sites Telemetry
          </h2>
          <ChartGrid
            range={range}
            syncKey="static-sites"
            charts={[
              "seaweedfs-s3-rps",
              "cloudflare-probe-latency",
              { preset: "namespace-cpu", target: "s3-static-sites" },
            ]}
          />
        </div>
      );
    case "observability":
    case "cluster-observability":
      return <ObservabilityServiceView range={range} />;
    case "temporal":
    case "temporal-data":
      return <TemporalServiceView range={range} />;
    case "cluster-platform":
    case "cluster-admission":
      return <ClusterBaselineView range={range} />;
    default:
      return null;
  }
}

const ISSUE_COLUMNS: readonly DataTableColumn<BugsinkTopIssue>[] = [
  tableCol(
    "issue",
    "Issue",
    (r) => (
      <a href={r.url} target="_blank" rel="noreferrer">
        {`${r.type}: ${r.value}`} <ExternalLinkIcon aria-hidden="true" />
      </a>
    ),
    (r) => r.type,
  ),
  tableCol("proj", "Project", (r) => (
    <span className="mono">{r.projectSlug}</span>
  )),
  numTableCol(
    "events",
    "Events",
    (r) => formatValue(r.events, "count"),
    (r) => r.events,
  ),
];

export function UniversalServiceTelemetry(props: {
  readonly detail: ServiceDetail;
  readonly range: SeriesRange;
}): React.JSX.Element | null {
  const { detail, range } = props;
  const hasNs = detail.service.namespaces.length > 0;
  const hasBugsink = detail.service.bugsinkProjects.length > 0;
  const cluster = useOptionalFacet("cluster", hasNs);
  const bugsink = useOptionalFacet("bugsink", hasNs && hasBugsink);

  if (!hasNs) {
    return null;
  }
  const nsTarget = detail.service.namespaces.join("|");
  const nsSet = new Set(detail.service.namespaces);
  const workloads = (cluster?.workloads ?? []).filter(
    (w) =>
      !w.retainedPool &&
      (w.serviceId === detail.service.id || nsSet.has(w.namespace)),
  );
  const slugSet = new Set(detail.service.bugsinkProjects);
  const issues = (bugsink?.topIssues ?? []).filter((i) =>
    slugSet.has(i.projectSlug),
  );

  return (
    <div className="platform-section">
      <h2 className="block-heading">Namespace & Service Telemetry</h2>
      <ChartGrid
        range={range}
        syncKey={`svc-${detail.service.id}`}
        charts={[
          { preset: "namespace-cpu", target: nsTarget },
          { preset: "namespace-memory", target: nsTarget },
          { preset: "namespace-restarts", target: nsTarget },
          { preset: "service-span-rate", target: detail.service.id },
        ]}
      />
      {workloads.length > 0 ? (
        <DataTable
          caption="Service workloads"
          rows={workloads}
          rowKey={(r) => `${r.namespace}/${r.kind}/${r.name}`}
          columns={WORKLOAD_COLUMNS}
        />
      ) : null}
      {hasBugsink && issues.length > 0 ? (
        <DataTable
          caption="Bugsink unresolved issues"
          rows={issues}
          rowKey={(r) => r.id}
          columns={ISSUE_COLUMNS}
        />
      ) : null}
    </div>
  );
}
