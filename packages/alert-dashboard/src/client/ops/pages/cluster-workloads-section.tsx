import type {
  ClusterFacet,
  ClusterWorkload,
} from "@shepherdjerred/ops-model/facets.ts";
import { useId, useMemo, type ReactNode } from "react";
import { useSearchParams } from "react-router";
import { z } from "zod";

import { useRange } from "#client/charts/use-range.ts";
import { PageHeading, RangePicker } from "#client/ops/ops-ui.tsx";
import { age } from "#client/time.ts";
import {
  BudgetMeter,
  DataTable,
  type DataTableColumn,
} from "#client/visuals/index.ts";
import type { SeriesRange } from "#shared/ops-schema";

import {
  ClusterNodesSection,
  ClusterOverviewStrip,
  ClusterStorageSection,
} from "./cluster-storage-section.tsx";

const ExplorerTabSchema = z.enum([
  "nodes",
  "workloads",
  "databases",
  "storage",
]);
type ExplorerTab = z.infer<typeof ExplorerTabSchema>;

function dbPill(
  tone: "ok" | "warning" | "error" | "info",
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

const DATABASE_COLUMNS: readonly DataTableColumn<
  ClusterFacet["databases"][number]
>[] = [
  {
    key: "name",
    header: "Cluster",
    render: (r) => <span className="mono">{r.name}</span>,
    sortValue: (r) => r.name,
  },
  {
    key: "namespace",
    header: "Namespace",
    render: (r) => <span className="mono">{r.namespace}</span>,
    sortValue: (r) => r.namespace,
  },
  {
    key: "engine",
    header: "Engine",
    render: (r) => dbPill("info", "•", r.engine),
    sortValue: (r) => r.engine,
  },
  {
    key: "ready",
    header: "Ready",
    render: (r) =>
      r.ready ? dbPill("ok", "✓", "Ready") : dbPill("error", "✕", "Not ready"),
    sortValue: (r) => (r.ready ? 1 : 0),
  },
  {
    key: "pvc",
    header: "PVC Usage",
    render: (r) =>
      r.capacityBytes === null || r.capacityBytes <= 0 ? (
        "—"
      ) : (
        <div className="platform-inline-meter">
          <BudgetMeter
            label={`${r.name} PVC`}
            value={r.usedBytes}
            max={r.capacityBytes}
            unit="bytes"
          />
        </div>
      ),
    sortValue: (r) =>
      r.usedBytes !== null && r.capacityBytes !== null && r.capacityBytes > 0
        ? r.usedBytes / r.capacityBytes
        : null,
  },
  {
    key: "velero",
    header: "Velero Backed Up",
    render: (r) =>
      r.veleroBackedUp === true
        ? dbPill("ok", "✓", "Backed up")
        : r.veleroBackedUp === false
          ? dbPill("warning", "!", "Missing backup")
          : dbPill("info", "•", "Unknown"),
    sortValue: (r) =>
      r.veleroBackedUp === true ? 2 : r.veleroBackedUp === null ? 1 : 0,
  },
];

function ClusterWorkloadsSection(props: {
  readonly cluster: ClusterFacet;
  readonly includeRetained: boolean;
  readonly onToggleRetained: () => void;
  readonly workloadColumns: readonly DataTableColumn<ClusterWorkload>[];
  readonly filterWorkloads: (
    workloads: readonly ClusterWorkload[],
    includeRetainedPools: boolean,
  ) => ClusterWorkload[];
}): React.JSX.Element {
  const {
    cluster,
    includeRetained,
    onToggleRetained,
    workloadColumns,
    filterWorkloads,
  } = props;
  const workloads = useMemo(
    () => filterWorkloads(cluster.workloads, includeRetained),
    [cluster.workloads, filterWorkloads, includeRetained],
  );
  const inRows = cluster.workloads.filter((w) => w.retainedPool).length;
  const retainedCount =
    inRows > 0 ? inRows : cluster.workloadSummary.retainedPools;
  return (
    <>
      <div className="platform-toolbar">
        <p className="platform-toolbar-meta">
          Degraded workloads (replica deficit, OOM kills, or 24h restarts) sort
          first.
        </p>
        <button
          type="button"
          className="button platform-toggle"
          aria-pressed={includeRetained}
          onClick={onToggleRetained}
        >
          {`Include retained pools (${String(retainedCount)})`}
        </button>
      </div>
      <DataTable
        caption="Kubernetes workloads"
        rows={workloads}
        rowKey={(r) => `${r.namespace}/${r.kind}/${r.name}`}
        rowLabel={(r) => `${r.namespace}/${r.name}`}
        columns={workloadColumns}
        searchPlaceholder="Search namespace, workload, image, or service…"
        searchText={(r) =>
          `${r.namespace} ${r.name} ${r.kind} ${r.image} ${r.serviceId ?? ""} ${r.argoApp ?? ""}`
        }
        exportFilename="cluster-workloads"
      />
    </>
  );
}

function ClusterTabContent(props: {
  readonly tab: ExplorerTab;
  readonly cluster: ClusterFacet;
  readonly range: SeriesRange;
  readonly includeRetained: boolean;
  readonly onToggleRetained: () => void;
  readonly workloadColumns: readonly DataTableColumn<ClusterWorkload>[];
  readonly zpoolColumns: readonly DataTableColumn<
    ClusterFacet["zpools"][number]
  >[];
  readonly filterWorkloads: (
    workloads: readonly ClusterWorkload[],
    includeRetainedPools: boolean,
  ) => ClusterWorkload[];
}): React.JSX.Element {
  const { tab, cluster, range, includeRetained, onToggleRetained } = props;
  switch (tab) {
    case "nodes":
      return <ClusterNodesSection nodes={cluster.nodes} range={range} />;
    case "workloads":
      return (
        <ClusterWorkloadsSection
          cluster={cluster}
          includeRetained={includeRetained}
          onToggleRetained={onToggleRetained}
          workloadColumns={props.workloadColumns}
          filterWorkloads={props.filterWorkloads}
        />
      );
    case "databases":
      return (
        <DataTable
          caption="PostgreSQL and MariaDB clusters"
          rows={cluster.databases}
          rowKey={(r) => `${r.namespace}/${r.name}`}
          columns={DATABASE_COLUMNS}
          searchPlaceholder="Search database cluster or namespace…"
          searchText={(r) => `${r.name} ${r.namespace} ${r.engine}`}
          exportFilename="cluster-databases"
        />
      );
    case "storage":
      return (
        <ClusterStorageSection
          cluster={cluster}
          range={range}
          zpoolColumns={props.zpoolColumns}
        />
      );
  }
}

export function ClusterExplorerBody(props: {
  readonly cluster: ClusterFacet;
  readonly generatedAt: string | null;
  readonly stale: boolean;
  readonly workloadColumns: readonly DataTableColumn<ClusterWorkload>[];
  readonly zpoolColumns: readonly DataTableColumn<
    ClusterFacet["zpools"][number]
  >[];
  readonly filterWorkloads: (
    workloads: readonly ClusterWorkload[],
    includeRetainedPools: boolean,
  ) => ClusterWorkload[];
  readonly renderTabBar: (
    baseId: string,
    active: ExplorerTab,
    onSelect: (next: ExplorerTab) => void,
  ) => ReactNode;
}): React.JSX.Element {
  const baseId = useId();
  const [range, setRange] = useRange("7d");
  const [params, setParams] = useSearchParams();
  const parsed = ExplorerTabSchema.safeParse(params.get("tab"));
  const activeTab: ExplorerTab = parsed.success ? parsed.data : "nodes";
  const includeRetained = params.get("retained") === "1";

  return (
    <>
      <PageHeading eyebrow="Kubernetes & Talos" title="Cluster">
        <div className="platform-heading-actions">
          <RangePicker value={range} onChange={setRange} />
        </div>
      </PageHeading>
      {props.generatedAt === null ? null : (
        <p className="lede">{`Cluster facet observed ${age(props.generatedAt)}${props.stale ? " · stale" : ""}.`}</p>
      )}
      <ClusterOverviewStrip cluster={props.cluster} />
      {props.renderTabBar(`${baseId}-tab`, activeTab, (next) => {
        const updated = new URLSearchParams(params);
        updated.set("tab", next);
        setParams(updated, { replace: true });
      })}
      <div
        role="tabpanel"
        aria-labelledby={`${baseId}-tab-${activeTab}`}
        className="platform-tabpanel"
      >
        <ClusterTabContent
          tab={activeTab}
          cluster={props.cluster}
          range={range}
          includeRetained={includeRetained}
          onToggleRetained={() => {
            const updated = new URLSearchParams(params);
            if (includeRetained) {
              updated.delete("retained");
            } else {
              updated.set("retained", "1");
            }
            setParams(updated, { replace: true });
          }}
          workloadColumns={props.workloadColumns}
          zpoolColumns={props.zpoolColumns}
          filterWorkloads={props.filterWorkloads}
        />
      </div>
    </>
  );
}
