import { Loaded } from "@shepherdjerred/loaded";
import { LoadingBlock } from "@shepherdjerred/loaded/react.tsx";
import type {
  ClusterFacet,
  ClusterWorkload,
} from "@shepherdjerred/ops-model/facets.ts";
import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { SeriesChart } from "#client/charts/series-chart.tsx";
import type { ChartMode, ChartThreshold } from "#client/charts/uplot-chart.tsx";
import { facetQuery } from "#client/ops/ops-api.ts";
import { PageHeading, ServiceLink } from "#client/ops/ops-ui.tsx";
import { StaleNotice } from "#client/stale-notice.tsx";
import { BudgetMeter, type DataTableColumn } from "#client/visuals/index.ts";
import { formatValue, type ValueUnit } from "#shared/ops-format";
import type { SeriesPresetId, SeriesRange } from "#shared/ops-schema";
import "#styles/platform.css";

import { ClusterExplorerBody } from "./cluster-workloads-section.tsx";

export const CLUSTER_TABS = [
  "nodes",
  "workloads",
  "databases",
  "storage",
] as const;
export type ClusterTab = (typeof CLUSTER_TABS)[number];

const CLUSTER_TAB_LABELS: Record<ClusterTab, string> = {
  nodes: "Nodes & Hardware",
  workloads: "Workloads",
  databases: "Databases",
  storage: "Storage, ZFS & NVMe",
};

export type ChartSpec =
  | SeriesPresetId
  | {
      readonly preset: SeriesPresetId;
      readonly mode?: ChartMode;
      readonly target?: string;
      readonly title?: string;
      readonly threshold?: ChartThreshold;
    };

export function ChartGrid(props: {
  readonly charts: readonly ChartSpec[];
  readonly range: SeriesRange;
  readonly syncKey: string;
}): React.JSX.Element {
  return (
    <div className="chart-grid">
      {props.charts.map((entry) => {
        const spec = typeof entry === "string" ? { preset: entry } : entry;
        return (
          <SeriesChart
            key={`${spec.preset}-${spec.target ?? ""}`}
            {...spec}
            range={props.range}
            syncKey={props.syncKey}
          />
        );
      })}
    </div>
  );
}

export function UrlTabBar<T extends string>(props: {
  readonly baseId: string;
  readonly label: string;
  readonly tabs: readonly T[];
  readonly labels: Readonly<Record<T, string>>;
  readonly active: T;
  readonly onSelect: (next: T) => void;
}): React.JSX.Element {
  const { baseId, label, tabs, labels, active, onSelect } = props;
  return (
    <div className="platform-tablist" role="tablist" aria-label={label}>
      {tabs.map((tab, index) => {
        const selected = tab === active;
        return (
          <button
            key={tab}
            id={`${baseId}-${tab}`}
            type="button"
            role="tab"
            className="platform-tab"
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => {
              onSelect(tab);
            }}
            onKeyDown={(event) => {
              const nextMap: Record<string, number> = {
                ArrowRight: (index + 1) % tabs.length,
                ArrowLeft: (index - 1 + tabs.length) % tabs.length,
                Home: 0,
                End: tabs.length - 1,
              };
              const nextIdx = nextMap[event.key];
              if (nextIdx !== undefined) {
                const nextTab = tabs[nextIdx];
                if (nextTab !== undefined) {
                  event.preventDefault();
                  onSelect(nextTab);
                  const sibling = event.currentTarget.parentElement
                    ?.querySelectorAll('[role="tab"]')
                    .item(nextIdx);
                  if (sibling instanceof HTMLElement) {
                    sibling.focus();
                  }
                }
              }
            }}
          >
            {labels[tab]}
          </button>
        );
      })}
    </div>
  );
}

export function statusPill(
  tone: "ok" | "warning" | "error" | "info" | "neutral",
  glyph: string,
  text: string,
): React.JSX.Element {
  return (
    <span className={`visual-pill visual-pill-${tone}`}>
      <span aria-hidden="true">{glyph}</span>
      <span>{text}</span>
    </span>
  );
}

export function inlineBudgetMeter(
  label: string,
  value: number | null,
  max: number,
  unit: ValueUnit = "bytes",
): React.JSX.Element {
  return (
    <div className="platform-inline-meter">
      <BudgetMeter label={label} value={value} max={max} unit={unit} />
    </div>
  );
}

export function tableCol<T>(
  key: string,
  header: string,
  render: (row: T) => ReactNode,
  sortValue?: (row: T) => string | number | null | undefined,
): DataTableColumn<T> {
  return { key, header, render, sortValue };
}

export function numTableCol<T>(
  key: string,
  header: string,
  render: (row: T) => ReactNode,
  sortValue?: (row: T) => string | number | null | undefined,
): DataTableColumn<T> {
  return { key, header, align: "right", render, sortValue };
}

export function isWorkloadDegraded(workload: ClusterWorkload): boolean {
  return (
    workload.readyReplicas < workload.desiredReplicas ||
    workload.oomKills24h > 0 ||
    workload.restarts24h > 0
  );
}

/** Degraded workloads (unready replicas, OOM kills, or 24h restarts) always sort first. */
export function sortClusterWorkloads(
  workloads: readonly ClusterWorkload[],
): ClusterWorkload[] {
  const score = (w: ClusterWorkload) =>
    Math.max(0, w.desiredReplicas - w.readyReplicas) * 1_000_000 +
    w.oomKills24h * 10_000 +
    w.restarts24h;
  return [...workloads].sort((left, right) => {
    const diff = score(right) - score(left);
    return diff === 0
      ? `${left.namespace}/${left.name}`.localeCompare(
          `${right.namespace}/${right.name}`,
        )
      : diff;
  });
}

export function filterClusterWorkloads(
  workloads: readonly ClusterWorkload[],
  includeRetainedPools: boolean,
): ClusterWorkload[] {
  return sortClusterWorkloads(
    includeRetainedPools ? workloads : workloads.filter((w) => !w.retainedPool),
  );
}

function shortImageRef(image: string): string {
  const trimmed = image.replace(/^docker\.io\//u, "");
  const [namePart, digestPart] = trimmed.split("@sha256:");
  return namePart === undefined || digestPart === undefined
    ? trimmed
    : `${namePart}@${digestPart.slice(0, 7)}`;
}

export const WORKLOAD_COLUMNS: readonly DataTableColumn<ClusterWorkload>[] = [
  tableCol(
    "workload",
    "Workload",
    (r) => (
      <div className="platform-cell-stack">
        <span className="platform-cell-primary mono">{`${r.namespace}/${r.name}`}</span>
        <span className="platform-cell-secondary">
          <span>{r.kind}</span>
          {r.retainedPool ? statusPill("neutral", "•", "Retained pool") : null}
        </span>
      </div>
    ),
    (r) => `${r.namespace}/${r.name}`,
  ),
  tableCol(
    "ready",
    "Ready",
    (r) => {
      const err = r.desiredReplicas > 0 && r.readyReplicas === 0;
      const tone = err
        ? "error"
        : r.readyReplicas < r.desiredReplicas
          ? "warning"
          : "ok";
      const glyph = tone === "ok" ? "✓" : tone === "warning" ? "!" : "✕";
      return statusPill(
        tone,
        glyph,
        `${String(r.readyReplicas)}/${String(r.desiredReplicas)} ${tone === "ok" ? "Ready" : "Degraded"}`,
      );
    },
    (r) => r.readyReplicas - r.desiredReplicas,
  ),
  tableCol(
    "restarts",
    "24h Restarts / OOMs",
    (r) =>
      r.oomKills24h > 0 ? (
        statusPill(
          "error",
          "✕",
          `${String(r.restarts24h)} restarts · ${String(r.oomKills24h)} OOM`,
        )
      ) : r.restarts24h > 0 ? (
        statusPill("warning", "!", `${String(r.restarts24h)} restarts · 0 OOM`)
      ) : (
        <span className="mono muted">0 restarts · 0 OOM</span>
      ),
    (r) => r.oomKills24h * 1000 + r.restarts24h,
  ),
  tableCol(
    "image",
    "Image",
    (r) => (
      <code className="platform-code-clip" title={r.image}>
        {shortImageRef(r.image)}
      </code>
    ),
    (r) => r.image,
  ),
  tableCol(
    "service",
    "Service",
    (r) => (r.serviceId === null ? "—" : <ServiceLink id={r.serviceId} />),
    (r) => r.serviceId,
  ),
  tableCol(
    "argoApp",
    "Argo App",
    (r) => <span className="mono">{r.argoApp ?? "—"}</span>,
    (r) => r.argoApp,
  ),
];

export const ZPOOL_COLUMNS: readonly DataTableColumn<
  ClusterFacet["zpools"][number]
>[] = [
  tableCol(
    "pool",
    "Node / Pool",
    (r) => <span className="mono">{`${r.node}/${r.pool}`}</span>,
    (r) => `${r.node}/${r.pool}`,
  ),
  tableCol(
    "usage",
    "Used / Size",
    (r) =>
      inlineBudgetMeter(
        `${r.node}/${r.pool} capacity`,
        r.usedBytes,
        r.sizeBytes,
      ),
    (r) => (r.sizeBytes > 0 ? r.usedBytes / r.sizeBytes : 0),
  ),
  numTableCol(
    "free",
    "Free",
    (r) => formatValue(r.freeBytes, "bytes"),
    (r) => r.freeBytes,
  ),
  numTableCol(
    "frag",
    "Fragmentation",
    (r) =>
      r.fragmentationPercent === null
        ? "—"
        : `${String(r.fragmentationPercent)}%`,
    (r) => r.fragmentationPercent,
  ),
  tableCol(
    "health",
    "Health",
    (r) =>
      r.health === "ONLINE"
        ? statusPill("ok", "✓", r.health)
        : r.health === "UNKNOWN"
          ? statusPill("warning", "!", r.health)
          : statusPill("error", "✕", r.health),
    (r) => r.health,
  ),
];

export function ClusterPage(): React.JSX.Element {
  const clusterEnvelope = Loaded.fromQuery(useQuery(facetQuery("cluster")));
  return (
    <main className="platform-page">
      <title>Cluster · Hub</title>
      <LoadingBlock
        values={{ clusterEnvelope }}
        fallback={<div className="loading-state">Loading Cluster…</div>}
        renderError={() => (
          <div className="error-state">Cluster telemetry is unavailable.</div>
        )}
      >
        {({ clusterEnvelope: envelope }, meta) => (
          <>
            <StaleNotice errors={meta.errors} />
            {envelope.data === null ? (
              <>
                <PageHeading title="Cluster" meta="Kubernetes & Talos" />
                <div className="empty-state">
                  No cluster facet has been ingested yet. The Temporal
                  ops-snapshot workflow posts one every five minutes.
                </div>
              </>
            ) : (
              <ClusterExplorerBody
                cluster={envelope.data}
                generatedAt={envelope.generatedAt}
                stale={envelope.stale}
                workloadColumns={WORKLOAD_COLUMNS}
                zpoolColumns={ZPOOL_COLUMNS}
                filterWorkloads={filterClusterWorkloads}
                renderTabBar={(baseId, active, onSelect) => (
                  <UrlTabBar
                    baseId={baseId}
                    label="Cluster explorer"
                    tabs={CLUSTER_TABS}
                    labels={CLUSTER_TAB_LABELS}
                    active={active}
                    onSelect={onSelect}
                  />
                )}
              />
            )}
          </>
        )}
      </LoadingBlock>
    </main>
  );
}
