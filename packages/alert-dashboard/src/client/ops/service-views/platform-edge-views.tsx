import type {
  CloudflareCheckStatus,
  CloudflareFacet,
  ClusterFacet,
  TailscaleFacet,
} from "@shepherdjerred/ops-model/facets.ts";

import { useOptionalFacet } from "./platform-facet.ts";
import { SeriesChart } from "#client/charts/series-chart.tsx";
import {
  ChartGrid,
  inlineBudgetMeter,
  numTableCol,
  statusPill,
  tableCol,
  ZPOOL_COLUMNS,
} from "#client/ops/pages/cluster-page.tsx";
import { kpiCard } from "#client/ops/pages/cluster-storage-section.tsx";
import {
  BudgetMeter,
  DataTable,
  StatusMatrix,
  type DataTableColumn,
  type MatrixCellStatus,
  type StatusMatrixColumn,
  type StatusMatrixRow,
} from "#client/visuals/index.ts";
import { formatValue } from "#shared/ops-format";
import type { SeriesRange } from "#shared/ops-schema";

const R2_FREE_BYTES = 10 * 1024 * 1024 * 1024;

function mapCfCheck(status: CloudflareCheckStatus): MatrixCellStatus {
  return status === "ok" ? "ok" : status === "warn" ? "warning" : "missing";
}

const CF_COLUMNS: readonly StatusMatrixColumn[] = [
  { key: "expiry", label: "Expiry" },
  { key: "dnssec", label: "DNSSEC" },
  { key: "spf", label: "SPF" },
  { key: "dmarc", label: "DMARC" },
  { key: "mx", label: "MX" },
  { key: "mtaSts", label: "MTA-STS" },
  { key: "tls", label: "TLS" },
];

function domainRow(d: CloudflareFacet["domains"][number]): StatusMatrixRow {
  const days = d.registrarExpiryDays;
  const expiryStatus: MatrixCellStatus =
    days === null
      ? "missing"
      : days < 14
        ? "error"
        : days < 30
          ? "warning"
          : "ok";
  return {
    key: d.domain,
    label: d.domain,
    meta: `${String(d.recordCount)} DNS records`,
    cells: {
      expiry: {
        status: expiryStatus,
        label: days === null ? "Unknown" : `${String(days)}d`,
      },
      dnssec: { status: mapCfCheck(d.dnssec) },
      spf: { status: mapCfCheck(d.spf) },
      dmarc: { status: mapCfCheck(d.dmarc) },
      mx: { status: mapCfCheck(d.mx) },
      mtaSts: { status: mapCfCheck(d.mtaSts) },
      tls: { status: mapCfCheck(d.tls) },
    },
  };
}

const R2_COLUMNS: readonly DataTableColumn<
  CloudflareFacet["r2Buckets"][number]
>[] = [
  tableCol(
    "name",
    "Bucket",
    (r) => <span className="mono">{r.name}</span>,
    (r) => r.name,
  ),
  numTableCol(
    "bytes",
    "Storage",
    (r) => formatValue(r.storageBytes, "bytes"),
    (r) => r.storageBytes,
  ),
  numTableCol(
    "objects",
    "Objects",
    (r) => formatValue(r.objectCount, "count"),
    (r) => r.objectCount,
  ),
  numTableCol(
    "classA",
    "Class A (mo)",
    (r) => formatValue(r.classAOpsMonth, "count"),
    (r) => r.classAOpsMonth,
  ),
  numTableCol(
    "classB",
    "Class B (mo)",
    (r) => formatValue(r.classBOpsMonth, "count"),
    (r) => r.classBOpsMonth,
  ),
];

const TUNNEL_COLUMNS: readonly DataTableColumn<
  CloudflareFacet["tunnelRoutes"][number]
>[] = [
  tableCol(
    "hostname",
    "Hostname",
    (r) => <span className="mono">{r.hostname}</span>,
    (r) => r.hostname,
  ),
  tableCol("service", "Upstream Service", (r) => (
    <code className="platform-code-clip">{r.service}</code>
  )),
  tableCol("status", "Status", (r) =>
    r.status === "healthy"
      ? statusPill("ok", "✓", r.status)
      : statusPill("warning", "!", r.status),
  ),
];

const TAILSCALE_COLUMNS: readonly DataTableColumn<
  TailscaleFacet["devices"][number]
>[] = [
  tableCol(
    "name",
    "Device",
    (r) => <span className="mono">{r.hostname}</span>,
    (r) => r.hostname,
  ),
  tableCol(
    "os",
    "OS / Client",
    (r) => `${r.os} · ${r.clientVersion}`,
    (r) => r.os,
  ),
  tableCol(
    "online",
    "Status",
    (r) =>
      r.online
        ? statusPill("ok", "✓", "Online")
        : statusPill("neutral", "—", "Offline"),
    (r) => (r.online ? 1 : 0),
  ),
  numTableCol(
    "expiry",
    "Key Expiry",
    (r) =>
      r.daysToExpiry === null ? "No expiry" : `${String(r.daysToExpiry)}d`,
    (r) => r.daysToExpiry,
  ),
  tableCol("addresses", "Tailnet IPs", (r) => (
    <span className="mono">{r.addresses.join(", ") || "—"}</span>
  )),
];

export function NetworkingServiceView({
  range,
}: {
  readonly range: SeriesRange;
}): React.JSX.Element {
  const cf = useOptionalFacet("cloudflare");
  const ts = useOptionalFacet("tailscale");
  const r2Meters: readonly [
    string,
    number | null,
    number,
    "bytes" | "count",
  ][] = [
    [
      "R2 storage vs 10 GiB free tier",
      cf === null ? null : cf.r2Buckets.reduce((s, b) => s + b.storageBytes, 0),
      R2_FREE_BYTES,
      "bytes",
    ],
    [
      "R2 Class A ops (1M free)",
      cf === null
        ? null
        : cf.r2Buckets.reduce((s, b) => s + (b.classAOpsMonth ?? 0), 0),
      1_000_000,
      "count",
    ],
    [
      "R2 Class B ops (10M free)",
      cf === null
        ? null
        : cf.r2Buckets.reduce((s, b) => s + (b.classBOpsMonth ?? 0), 0),
      10_000_000,
      "count",
    ],
  ];

  return (
    <div className="platform-section">
      <h2 className="block-heading">Cloudflare & RDAP Domain Posture</h2>
      <StatusMatrix
        caption="Domain DNS, email & TLS baseline"
        rowHeaderLabel="Domain"
        columns={CF_COLUMNS}
        rows={(cf?.domains ?? []).map((d) => domainRow(d))}
      />
      <h2 className="block-heading">Cloudflare R2 Free-Tier Budgets & Edge</h2>
      <div className="platform-three-col">
        {r2Meters.map(([label, val, max, unit]) => (
          <div key={label} className="panel platform-meter-card">
            <BudgetMeter label={label} value={val} max={max} unit={unit} />
          </div>
        ))}
      </div>
      <ChartGrid
        range={range}
        syncKey="networking"
        charts={["cloudflare-r2-bytes", "cloudflare-probe-latency"]}
      />
      {cf !== null && cf.r2Buckets.length > 0 ? (
        <DataTable
          caption="Cloudflare R2 buckets"
          rows={cf.r2Buckets}
          rowKey={(r) => r.name}
          columns={R2_COLUMNS}
        />
      ) : null}
      <DataTable
        caption="Cloudflare tunnel routes"
        rows={cf?.tunnelRoutes ?? []}
        rowKey={(r) => `${r.hostname}->${r.service}`}
        columns={TUNNEL_COLUMNS}
        searchText={(r) => `${r.hostname} ${r.service}`}
      />
      <h2 className="block-heading">Tailscale Tailnet & Cluster Ingress</h2>
      {ts === null ? null : (
        <div className="platform-kpi-grid">
          {kpiCard(
            "Devices Online",
            `${String(ts.onlineDevices)} / ${String(ts.totalDevices)}`,
            "Tailnet fleet",
          )}
          {kpiCard(
            "Expiring Keys Soon",
            String(ts.expiringKeysSoon),
            "Within warning window",
            ts.expiringKeysSoon > 0 ? "warning" : "ok",
          )}
          {kpiCard(
            "Cluster Services",
            String(ts.clusterServicesCount),
            "Tailscale operator ingress",
            "info",
          )}
        </div>
      )}
      <SeriesChart
        preset="tailscale-node-bps"
        range={range}
        mode="stacked-area"
        syncKey="networking"
      />
      {ts === null || ts.devices.length === 0 ? (
        <p className="platform-note">
          Tailscale cloud API device list is unconfigured; cluster ingress
          services and node <code>tailscale0</code> throughput remain active.
        </p>
      ) : (
        <DataTable
          caption="Tailnet devices"
          rows={ts.devices}
          rowKey={(r) => r.id}
          columns={TAILSCALE_COLUMNS}
          searchText={(r) => `${r.hostname} ${r.os} ${r.addresses.join(" ")}`}
        />
      )}
    </div>
  );
}

const NVME_COLUMNS: readonly DataTableColumn<
  ClusterFacet["nvmeDrives"][number]
>[] = [
  tableCol(
    "drive",
    "Node / Device",
    (r) => <span className="mono">{`${r.node}/${r.device}`}</span>,
    (r) => `${r.node}/${r.device}`,
  ),
  tableCol(
    "model",
    "Model",
    (r) => r.model ?? "—",
    (r) => r.model,
  ),
  tableCol(
    "budget",
    "24h Writes vs Budget",
    (r) =>
      inlineBudgetMeter(
        `${r.node}/${r.device} writes`,
        r.written24hBytes,
        r.dailyBudgetBytes,
      ),
    (r) => r.written24hBytes / Math.max(1, r.dailyBudgetBytes),
  ),
  numTableCol(
    "wear",
    "Wear",
    (r) => (r.wearPercent === null ? "—" : `${String(r.wearPercent)}%`),
    (r) => r.wearPercent,
  ),
  numTableCol(
    "temp",
    "Temp",
    (r) => formatValue(r.tempCelsius, "celsius"),
    (r) => r.tempCelsius,
  ),
];

export function StorageServiceView({
  range,
}: {
  readonly range: SeriesRange;
}): React.JSX.Element {
  const cluster = useOptionalFacet("cluster");
  const sw = cluster?.seaweedfs;
  return (
    <div className="platform-section">
      <h2 className="block-heading">SeaweedFS, Backblaze B2, Velero & ZFS</h2>
      <div className="panel platform-meter-card">
        <BudgetMeter
          label="SeaweedFS volume slots"
          value={sw?.volumeCount ?? null}
          max={sw !== undefined && sw.maxVolumes > 0 ? sw.maxVolumes : 500}
          unit="count"
          detail={
            sw === undefined
              ? "500 volume slot threshold"
              : `${String(sw.bucketsCount)} buckets · replication lag ${formatValue(sw.backupLagSeconds, "seconds")}`
          }
        />
      </div>
      <ChartGrid
        range={range}
        syncKey="storage"
        charts={[
          {
            preset: "seaweedfs-volume-slots",
            threshold: { value: 500, label: "500 slot cap", tone: "warning" },
          },
          "seaweedfs-backup-lag",
          "seaweedfs-s3-rps",
          { preset: "velero-backups", mode: "bar" },
          "nvme-writes-24h",
          "zpool-usage-ratio",
        ]}
      />
      <DataTable
        caption="NVMe endurance & daily write budgets"
        rows={cluster?.nvmeDrives ?? []}
        rowKey={(r) => `${r.node}/${r.device}`}
        columns={NVME_COLUMNS}
      />
      <DataTable
        caption="ZFS storage pools"
        rows={cluster?.zpools ?? []}
        rowKey={(r) => `${r.node}/${r.pool}`}
        columns={ZPOOL_COLUMNS}
      />
    </div>
  );
}
