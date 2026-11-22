import type {
  ClusterFacet,
  ClusterNode,
  ClusterNvmeDrive,
} from "@shepherdjerred/ops-model/facets.ts";
import type { Severity } from "@shepherdjerred/ops-model/severity.ts";

import { SeriesChart } from "#client/charts/series-chart.tsx";
import { SeverityBadge } from "#client/ops/ops-ui.tsx";
import {
  BudgetMeter,
  DataTable,
  type DataTableColumn,
} from "#client/visuals/index.ts";
import { formatValue } from "#shared/ops-format";
import type { SeriesPresetId, SeriesRange } from "#shared/ops-schema";

function PresetChartGrid(props: {
  readonly charts: readonly SeriesPresetId[];
  readonly range: SeriesRange;
  readonly syncKey: string;
}): React.JSX.Element {
  return (
    <div className="chart-grid">
      {props.charts.map((preset) => (
        <SeriesChart
          key={`${preset}-`}
          preset={preset}
          range={props.range}
          syncKey={props.syncKey}
        />
      ))}
    </div>
  );
}

export function kpiCard(
  label: string,
  value: string,
  sub: string,
  severity: Severity = "ok",
): React.JSX.Element {
  return (
    <div
      key={label}
      className={`platform-kpi-card platform-kpi-card-${severity}`}
    >
      <div className="platform-kpi-head">
        <span className="platform-kpi-label">{label}</span>
        {severity === "info" ? null : <SeverityBadge severity={severity} />}
      </div>
      <strong className="platform-kpi-value">{value}</strong>
      <p className="platform-kpi-sub">{sub}</p>
    </div>
  );
}

export function ClusterOverviewStrip({
  cluster,
}: {
  readonly cluster: ClusterFacet;
}): React.JSX.Element {
  const totalNodes = cluster.nodes.length > 0 ? cluster.nodes.length : 2;
  const readyNodes = cluster.nodes.filter((n) => n.ready).length;
  const nodesSev: Severity =
    readyNodes === totalNodes && cluster.nodes.length > 0 ? "ok" : "error";
  const { healthy, total, degraded } = cluster.workloadSummary;
  const criticalWorkload = cluster.workloads.some(
    (w) =>
      w.oomKills24h > 0 || (w.desiredReplicas > 0 && w.readyReplicas === 0),
  );
  const workSev: Severity =
    degraded === 0 ? "ok" : criticalWorkload ? "error" : "warning";
  const totalDbs = cluster.databases.length;
  const readyDbs = cluster.databases.filter((d) => d.ready).length;
  const backedUp = cluster.databases.filter((d) => d.veleroBackedUp).length;
  const lag = cluster.seaweedfs.backupLagSeconds;
  const lagSev: Severity =
    lag === null
      ? "unknown"
      : lag > 900
        ? "error"
        : lag > 300
          ? "warning"
          : "ok";

  return (
    <section className="platform-kpi-grid" aria-label="Cluster overview">
      {kpiCard(
        "Nodes Ready",
        `${String(readyNodes)}/${String(totalNodes)}`,
        cluster.nodes.map((n) => n.name).join(" · ") || "Talos Linux",
        nodesSev,
      )}
      {kpiCard(
        "Workloads Healthy",
        `${String(healthy)} / ${String(total)}`,
        degraded > 0
          ? `${String(degraded)} degraded requiring attention`
          : "0 degraded",
        workSev,
      )}
      {kpiCard(
        "Databases Ready",
        `${String(readyDbs)}/${String(totalDbs)}`,
        `${String(backedUp)}/${String(totalDbs)} Velero backed up`,
        readyDbs === totalDbs ? "ok" : "error",
      )}
      <div className="platform-kpi-card">
        <BudgetMeter
          label="SeaweedFS volume slots"
          value={cluster.seaweedfs.volumeCount}
          max={cluster.seaweedfs.maxVolumes}
          unit="count"
          detail={`${String(cluster.seaweedfs.bucketsCount)} S3 buckets`}
        />
      </div>
      {kpiCard(
        "SeaweedFS → B2 Lag",
        formatValue(lag, "seconds"),
        "Offsite B2 replication",
        lagSev,
      )}
    </section>
  );
}

function NodeCard({ node }: { readonly node: ClusterNode }): React.JSX.Element {
  const cpuPct =
    node.cpuRatio === null ? null : Math.round(node.cpuRatio * 100);
  const memUsed =
    node.memoryRatio === null
      ? null
      : Math.round(node.memoryRatio * node.memoryBytes);
  const facts: readonly [string, string][] = [
    ["ZFS ARC", formatValue(node.zfsArcBytes, "bytes")],
    ["Package temp", formatValue(node.tempCelsius, "celsius")],
    ["Kubelet", node.kubeletVersion],
    ["Talos", node.talosVersion ?? "—"],
    ["Kernel", node.kernelVersion ?? "—"],
  ];
  return (
    <article
      className="panel platform-node-card"
      aria-labelledby={`node-${node.name}`}
    >
      <header className="platform-card-head">
        <h3 id={`node-${node.name}`}>{node.name}</h3>
        <SeverityBadge severity={node.ready ? "ok" : "error"} />
      </header>
      <BudgetMeter
        label={`${node.name} CPU`}
        value={cpuPct}
        max={100}
        unit="percent"
        detail={`${String(node.cpuCores)} cores`}
      />
      <BudgetMeter
        label={`${node.name} memory`}
        value={memUsed}
        max={node.memoryBytes}
        unit="bytes"
        detail={
          node.memoryRatio === null
            ? undefined
            : `${formatValue(node.memoryRatio, "ratio")} allocated`
        }
      />
      <dl className="platform-kv-grid">
        {facts.map(([dt, dd]) => (
          <div key={dt}>
            <dt>{dt}</dt>
            <dd>{dd}</dd>
          </div>
        ))}
      </dl>
    </article>
  );
}

function NvmeCard({
  drive,
}: {
  readonly drive: ClusterNvmeDrive;
}): React.JSX.Element {
  const title = `${drive.node}/${drive.device}`;
  const wear =
    drive.wearPercent === null ? "—" : `${String(drive.wearPercent)}% wear`;
  return (
    <article className="panel platform-meter-card">
      <div className="platform-card-head">
        <h3 className="mono">{title}</h3>
        <span className="mono muted">{`${wear} · ${formatValue(drive.tempCelsius, "celsius")}`}</span>
      </div>
      {drive.model === undefined ? null : (
        <p className="platform-card-subtitle">{drive.model}</p>
      )}
      <BudgetMeter
        label={`${title} 24h write budget`}
        value={drive.written24hBytes}
        max={drive.dailyBudgetBytes}
        unit="bytes"
        detail="5-year endurance daily write budget"
      />
    </article>
  );
}

export function ClusterNodesSection(props: {
  readonly nodes: ClusterFacet["nodes"];
  readonly range: SeriesRange;
}): React.JSX.Element {
  return (
    <>
      <div className="platform-two-col">
        {props.nodes.map((n) => (
          <NodeCard key={n.name} node={n} />
        ))}
      </div>
      <PresetChartGrid
        range={props.range}
        syncKey="cluster-nodes"
        charts={[
          "node-cpu",
          "node-memory",
          "node-temp",
          "node-psi-cpu",
          "etcd-db-bytes",
        ]}
      />
    </>
  );
}

export function ClusterStorageSection(props: {
  readonly cluster: ClusterFacet;
  readonly range: SeriesRange;
  readonly zpoolColumns: readonly DataTableColumn<
    ClusterFacet["zpools"][number]
  >[];
}): React.JSX.Element {
  const { cluster, range, zpoolColumns } = props;
  return (
    <>
      <section className="platform-section" aria-labelledby="nvme-heading">
        <h2 className="block-heading" id="nvme-heading">
          NVMe 5-year daily write budgets
        </h2>
        <div className="platform-two-col">
          {cluster.nvmeDrives.map((d) => (
            <NvmeCard key={`${d.node}/${d.device}`} drive={d} />
          ))}
        </div>
        <PresetChartGrid
          range={range}
          syncKey="cluster-storage"
          charts={["nvme-writes-24h", "nvme-temp"]}
        />
      </section>
      <section className="platform-section" aria-labelledby="zfs-heading">
        <h2 className="block-heading" id="zfs-heading">
          ZFS storage pools
        </h2>
        <DataTable
          caption="ZFS pools by node"
          rows={cluster.zpools}
          rowKey={(r) => `${r.node}/${r.pool}`}
          columns={zpoolColumns}
          exportFilename="cluster-zpools"
        />
        <PresetChartGrid
          range={range}
          syncKey="cluster-storage"
          charts={["zpool-usage-ratio", "zpool-arc-hit-ratio"]}
        />
      </section>
    </>
  );
}
