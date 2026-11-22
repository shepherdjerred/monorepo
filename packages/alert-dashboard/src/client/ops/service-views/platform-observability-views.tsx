import type { ObservabilityFacet } from "@shepherdjerred/ops-model/facets.ts";
import { ExternalLinkIcon } from "lucide-react";
import { useId } from "react";
import { useSearchParams } from "react-router";
import { z } from "zod";

import { useOptionalFacet } from "./platform-facet.ts";
import { SeriesChart } from "#client/charts/series-chart.tsx";
import {
  ServiceLink,
  services as serviceCatalog,
} from "#client/ops/ops-ui.tsx";
import {
  ChartGrid,
  kpiCard,
  numTableCol,
  statusPill,
  tableCol,
  UrlTabBar,
} from "#client/ops/pages/cluster-page.tsx";
import {
  BudgetMeter,
  DataTable,
  type DataTableColumn,
} from "#client/visuals/index.ts";
import { formatValue } from "#shared/ops-format";
import type { SeriesRange } from "#shared/ops-schema";

const PROM_TSDB_CAP_BYTES = 200 * 1024 * 1024 * 1024;
const OBS_TABS = ["prometheus", "loki", "tempo", "grafana", "phoenix"] as const;
const ObsTabSchema = z.enum(OBS_TABS);
type ObsTab = z.infer<typeof ObsTabSchema>;

const OBS_TAB_LABELS: Record<ObsTab, string> = {
  prometheus: "Prometheus",
  loki: "Loki",
  tempo: "Tempo",
  grafana: "Grafana",
  phoenix: "Phoenix & Alloy",
};

const DOWN_COLS: readonly DataTableColumn<
  ObservabilityFacet["prometheus"]["downTargets"][number]
>[] = [
  tableCol("job", "Job", (r) => <span className="mono">{r.job}</span>),
  tableCol("instance", "Instance", (r) => (
    <span className="mono">{r.instance}</span>
  )),
  tableCol("health", "Health", (r) => statusPill("error", "✕", r.health)),
];

const CARDINALITY_COLS: readonly DataTableColumn<
  ObservabilityFacet["prometheus"]["topMetricNames"][number]
>[] = [
  tableCol("name", "Metric Name", (r) => (
    <span className="mono">{r.name}</span>
  )),
  numTableCol(
    "series",
    "Active Series",
    (r) => formatValue(r.series, "count"),
    (r) => r.series,
  ),
];

const NOISY_NS_COLS: readonly DataTableColumn<
  ObservabilityFacet["loki"]["noisyNamespaces"][number]
>[] = [
  tableCol("ns", "Namespace", (r) => (
    <span className="mono">{r.namespace}</span>
  )),
  numTableCol(
    "bytes",
    "Bytes (24h)",
    (r) => formatValue(r.bytes24h, "bytes"),
    (r) => r.bytes24h,
  ),
  numTableCol(
    "err",
    "Error Lines (1h)",
    (r) => formatValue(r.errorLines1h, "count"),
    (r) => r.errorLines1h,
  ),
];

const WARN_EVENT_COLS: readonly DataTableColumn<
  ObservabilityFacet["loki"]["warningEvents"][number]
>[] = [
  tableCol("ns", "Namespace", (r) => (
    <span className="mono">{r.namespace}</span>
  )),
  tableCol("reason", "Reason", (r) => statusPill("warning", "!", r.reason)),
  numTableCol(
    "count",
    "Count (1h)",
    (r) => String(r.count1h),
    (r) => r.count1h,
  ),
];

const RED_COLS: readonly DataTableColumn<
  ObservabilityFacet["tempo"]["servicesRed"][number]
>[] = [
  tableCol(
    "service",
    "Service",
    (r) =>
      serviceCatalog.byId(r.service) === undefined ? (
        <span className="mono">{r.service}</span>
      ) : (
        <ServiceLink id={r.service} />
      ),
    (r) => r.service,
  ),
  numTableCol(
    "rate",
    "Span Rate (/s)",
    (r) => `${r.spanRate.toFixed(1)}/s`,
    (r) => r.spanRate,
  ),
  numTableCol(
    "err",
    "Error Rate",
    (r) => formatValue(r.errorRate, "ratio"),
    (r) => r.errorRate,
  ),
  numTableCol(
    "p95",
    "p95 Latency",
    (r) => formatValue(r.p95Ms, "ms"),
    (r) => r.p95Ms,
  ),
];

const DASHBOARD_COLS: readonly DataTableColumn<
  ObservabilityFacet["grafana"]["dashboards"][number]
>[] = [
  tableCol(
    "title",
    "Dashboard",
    (r) => (
      <a href={r.url} target="_blank" rel="noreferrer">
        {r.title} <ExternalLinkIcon aria-hidden="true" />
      </a>
    ),
    (r) => r.title,
  ),
  tableCol(
    "folder",
    "Folder",
    (r) => r.folder ?? "General",
    (r) => r.folder,
  ),
  tableCol("uid", "UID", (r) => <span className="mono">{r.uid}</span>),
];

function ObsPrometheusPanel({
  obs,
  range,
}: {
  readonly obs: ObservabilityFacet | null;
  readonly range: SeriesRange;
}): React.JSX.Element {
  return (
    <>
      <div className="panel platform-meter-card">
        <BudgetMeter
          label="Prometheus TSDB WAL + blocks (200 GiB cap)"
          value={obs?.prometheus.walPlusBlocksBytes ?? null}
          max={PROM_TSDB_CAP_BYTES}
          unit="bytes"
          detail={`Head series: ${formatValue(obs?.prometheus.headSeries ?? null, "count")}`}
        />
      </div>
      <ChartGrid
        range={range}
        syncKey="obs-prom"
        charts={[
          "prometheus-tsdb-series",
          {
            preset: "prometheus-tsdb-bytes",
            threshold: {
              value: PROM_TSDB_CAP_BYTES,
              label: "200 GiB cap",
              tone: "warning",
            },
          },
        ]}
      />
      <DataTable
        caption="Down scrape targets"
        rows={obs?.prometheus.downTargets ?? []}
        rowKey={(r) => `${r.job}/${r.instance}`}
        columns={DOWN_COLS}
        emptyMessage="All Prometheus scrape targets are healthy."
      />
      <DataTable
        caption="Top cardinality metric names"
        rows={obs?.prometheus.topMetricNames ?? []}
        rowKey={(r) => r.name}
        initialCap={10}
        columns={CARDINALITY_COLS}
      />
    </>
  );
}

function ObsLokiPanel({
  obs,
  range,
}: {
  readonly obs: ObservabilityFacet | null;
  readonly range: SeriesRange;
}): React.JSX.Element {
  return (
    <>
      <div className="platform-kpi-grid">
        {kpiCard(
          "24h Log Ingestion",
          formatValue(obs?.loki.ingestedBytes24h ?? null, "bytes"),
          "Compressed stream volume",
          "info",
        )}
        {kpiCard(
          "Loki Ruler Rules",
          String(obs?.loki.rulerRulesCount ?? 0),
          "Active recording & alert rules",
        )}
      </div>
      <SeriesChart
        preset="loki-ingested-bps"
        range={range}
        syncKey="obs-loki"
      />
      <DataTable
        caption="Noisiest namespaces (24h)"
        rows={obs?.loki.noisyNamespaces ?? []}
        rowKey={(r) => r.namespace}
        columns={NOISY_NS_COLS}
      />
      <DataTable
        caption="Kubernetes warning events (1h)"
        rows={obs?.loki.warningEvents ?? []}
        rowKey={(r) => `${r.namespace}/${r.reason}`}
        columns={WARN_EVENT_COLS}
      />
    </>
  );
}

export function ObservabilityServiceView({
  range,
}: {
  readonly range: SeriesRange;
}): React.JSX.Element {
  const baseId = useId();
  const [params, setParams] = useSearchParams();
  const obs = useOptionalFacet("observability");
  const parsed = ObsTabSchema.safeParse(params.get("tab"));
  const activeTab: ObsTab = parsed.success ? parsed.data : "prometheus";

  return (
    <div className="platform-section">
      <UrlTabBar
        baseId={baseId}
        label="Observability stack"
        tabs={OBS_TABS}
        labels={OBS_TAB_LABELS}
        active={activeTab}
        onSelect={(next) => {
          const updated = new URLSearchParams(params);
          updated.set("tab", next);
          setParams(updated, { replace: true });
        }}
      />
      <div
        role="tabpanel"
        aria-labelledby={`${baseId}-${activeTab}`}
        className="platform-tabpanel"
      >
        {activeTab === "prometheus" ? (
          <ObsPrometheusPanel obs={obs} range={range} />
        ) : activeTab === "loki" ? (
          <ObsLokiPanel obs={obs} range={range} />
        ) : activeTab === "tempo" ? (
          <>
            <ChartGrid
              range={range}
              syncKey="obs-tempo"
              charts={["tempo-span-rate", "tempo-error-rate"]}
            />
            <DataTable
              caption="Service RED span metrics"
              rows={obs?.tempo.servicesRed ?? []}
              rowKey={(r) => r.service}
              searchText={(r) => r.service}
              columns={RED_COLS}
            />
          </>
        ) : activeTab === "grafana" ? (
          <>
            <div className="platform-kpi-grid">
              {kpiCard(
                "Datasources",
                String(obs?.grafana.datasourcesCount ?? 0),
                "Provisioned backends",
              )}
              {kpiCard(
                "Provisioned Dashboards",
                String(obs?.grafana.dashboardsCount ?? 0),
                "GitOps managed",
                "info",
              )}
            </div>
            <DataTable
              caption="Provisioned Grafana dashboards"
              rows={obs?.grafana.dashboards ?? []}
              rowKey={(r) => r.uid}
              columns={DASHBOARD_COLS}
              searchPlaceholder="Search dashboard title or folder…"
              searchText={(r) => `${r.title} ${r.folder ?? ""} ${r.uid}`}
            />
          </>
        ) : (
          <ChartGrid
            range={range}
            syncKey="obs-phoenix"
            charts={[
              { preset: "llm-token-cache-mix", mode: "stacked-area" },
              "llm-p95-latency",
              {
                preset: "namespace-cpu",
                target: "phoenix|alloy|alloy-gateway",
                title: "Phoenix & Alloy CPU",
              },
              {
                preset: "namespace-memory",
                target: "phoenix|alloy|alloy-gateway",
                title: "Phoenix & Alloy memory",
              },
            ]}
          />
        )}
      </div>
    </div>
  );
}
