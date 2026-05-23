import * as common from "@grafana/grafana-foundation-sdk/common";
import * as dashboard from "@grafana/grafana-foundation-sdk/dashboard";
import * as prometheus from "@grafana/grafana-foundation-sdk/prometheus";
import * as stat from "@grafana/grafana-foundation-sdk/stat";
import * as timeseries from "@grafana/grafana-foundation-sdk/timeseries";
import { exportDashboardWithHelmEscaping } from "./dashboard-export.ts";

const PROMETHEUS_DATASOURCE = {
  type: "prometheus",
  uid: "Prometheus",
};

function endpointFilter() {
  return 'job=~"static-site-.*",site=~"$site",endpoint=~"$endpoint"';
}

function createVariable(options: {
  name: string;
  label: string;
  query: string;
}) {
  return new dashboard.QueryVariableBuilder(options.name)
    .label(options.label)
    .query(options.query)
    .datasource(PROMETHEUS_DATASOURCE)
    .multi(true)
    .includeAll(true)
    .allValue(".*");
}

function createStatPanel(options: {
  title: string;
  description: string;
  query: string;
  legend: string;
  gridPos: { x: number; y: number; w: number; h: number };
  unit?: string;
  thresholds?: { value: number; color: string }[];
}) {
  const panel = new stat.PanelBuilder()
    .title(options.title)
    .description(options.description)
    .datasource(PROMETHEUS_DATASOURCE)
    .withTarget(
      new prometheus.DataqueryBuilder()
        .expr(options.query)
        .legendFormat(options.legend),
    )
    .unit(options.unit ?? "short")
    .colorMode(common.BigValueColorMode.Value)
    .graphMode(common.BigValueGraphMode.Area)
    .gridPos(options.gridPos);

  if (options.thresholds !== undefined) {
    panel.thresholds(
      new dashboard.ThresholdsConfigBuilder()
        .mode(dashboard.ThresholdsMode.Absolute)
        .steps(options.thresholds),
    );
  }

  return panel;
}

function createTimeseriesPanel(options: {
  title: string;
  description: string;
  targets: { query: string; legend: string }[];
  gridPos: { x: number; y: number; w: number; h: number };
  unit?: string;
}) {
  const panel = new timeseries.PanelBuilder()
    .title(options.title)
    .description(options.description)
    .datasource(PROMETHEUS_DATASOURCE)
    .unit(options.unit ?? "short")
    .lineWidth(2)
    .fillOpacity(10)
    .gridPos(options.gridPos);

  for (const target of options.targets) {
    panel.withTarget(
      new prometheus.DataqueryBuilder()
        .expr(target.query)
        .legendFormat(target.legend),
    );
  }

  return panel;
}

/**
 * Builds the "Static Site Probes" Grafana dashboard for the homelab
 * blackbox-exporter fleet. The dashboard surfaces probe success rate, HTTP
 * status, request duration, and TLS expiry across all `static-site-*` jobs,
 * with `$site` / `$endpoint` template variables for drill-down.
 *
 * @returns A `dashboard.Dashboard` ready to serialize to JSON.
 *
 * @example
 * ```ts
 * import { createStaticSiteProbesDashboard } from "./static-site-probes-dashboard.ts";
 * const dashboard = createStaticSiteProbesDashboard();
 * ```
 */
export function createStaticSiteProbesDashboard() {
  const siteVariable = createVariable({
    name: "site",
    label: "Site",
    query: 'label_values(probe_success{job=~"static-site-.*"}, site)',
  });
  const endpointVariable = createVariable({
    name: "endpoint",
    label: "Endpoint",
    query:
      'label_values(probe_success{job=~"static-site-.*",site=~"$site"}, endpoint)',
  });

  const builder = new dashboard.DashboardBuilder("Static Site Probes")
    .uid("static-site-probes")
    .tags(["static-sites", "blackbox", "rss"])
    .time({ from: "now-24h", to: "now" })
    .refresh("30s")
    .timezone("browser")
    .editable()
    .withVariable(siteVariable)
    .withVariable(endpointVariable);

  const successThresholds = [
    { value: 0, color: "red" },
    { value: 1, color: "green" },
  ];
  const statusThresholds = [
    { value: 0, color: "red" },
    { value: 200, color: "green" },
    { value: 300, color: "yellow" },
    { value: 400, color: "red" },
  ];
  const durationThresholds = [
    { value: 0, color: "green" },
    { value: 1, color: "yellow" },
    { value: 3, color: "red" },
  ];

  builder.withRow(
    new dashboard.RowBuilder("Overview").gridPos({ x: 0, y: 0, w: 24, h: 1 }),
  );

  builder.withPanel(
    createStatPanel({
      title: "RSS Probe",
      description:
        "Current blackbox-exporter status for https://sjer.red/rss.xml.",
      query:
        'max(probe_success{job="static-site-sjer.red-rss",site="sjer.red",endpoint="rss",path="/rss.xml"})',
      legend: "rss",
      unit: "short",
      thresholds: successThresholds,
      gridPos: { x: 0, y: 1, w: 6, h: 4 },
    }),
  );

  builder.withPanel(
    createStatPanel({
      title: "Selected Endpoints Up",
      description:
        "Number of selected static-site endpoints currently returning successful probes.",
      query: `sum(probe_success{${endpointFilter()}})`,
      legend: "up",
      unit: "short",
      thresholds: [
        { value: 0, color: "red" },
        { value: 1, color: "green" },
      ],
      gridPos: { x: 6, y: 1, w: 6, h: 4 },
    }),
  );

  builder.withPanel(
    createStatPanel({
      title: "RSS HTTP Status",
      description: "Last observed HTTP status code for the RSS endpoint.",
      query:
        'max(probe_http_status_code{job="static-site-sjer.red-rss",site="sjer.red",endpoint="rss",path="/rss.xml"})',
      legend: "rss",
      unit: "short",
      thresholds: statusThresholds,
      gridPos: { x: 12, y: 1, w: 6, h: 4 },
    }),
  );

  builder.withPanel(
    createStatPanel({
      title: "RSS Duration",
      description: "Total blackbox probe duration for the RSS endpoint.",
      query:
        'sum(probe_http_duration_seconds{job="static-site-sjer.red-rss",site="sjer.red",endpoint="rss",path="/rss.xml",phase=~"resolve|connect|tls|processing|transfer"})',
      legend: "rss",
      unit: "s",
      thresholds: durationThresholds,
      gridPos: { x: 18, y: 1, w: 6, h: 4 },
    }),
  );

  builder.withRow(
    new dashboard.RowBuilder("History").gridPos({ x: 0, y: 5, w: 24, h: 1 }),
  );

  builder.withPanel(
    createTimeseriesPanel({
      title: "Probe Success",
      description: "Blackbox probe success by site endpoint.",
      targets: [
        {
          query: `probe_success{${endpointFilter()}}`,
          legend: "{{site}} {{endpoint}} {{path}}",
        },
      ],
      unit: "short",
      gridPos: { x: 0, y: 6, w: 12, h: 8 },
    }),
  );

  builder.withPanel(
    createTimeseriesPanel({
      title: "Response Duration",
      description: "Total blackbox HTTP probe duration by endpoint.",
      targets: [
        {
          query: `sum by (site, endpoint, path) (probe_http_duration_seconds{${endpointFilter()},phase=~"resolve|connect|tls|processing|transfer"})`,
          legend: "{{site}} {{endpoint}} {{path}}",
        },
      ],
      unit: "s",
      gridPos: { x: 12, y: 6, w: 12, h: 8 },
    }),
  );

  builder.withRow(
    new dashboard.RowBuilder("TLS").gridPos({ x: 0, y: 14, w: 24, h: 1 }),
  );

  builder.withPanel(
    createTimeseriesPanel({
      title: "Certificate Days Remaining",
      description:
        "TLS certificate lifetime for root static-site endpoints. Path-specific probes share the same certificate.",
      targets: [
        {
          query:
            '(probe_ssl_earliest_cert_expiry{job=~"static-site-.*",endpoint="root",site=~"$site"} - time()) / 86400',
          legend: "{{site}}",
        },
      ],
      unit: "d",
      gridPos: { x: 0, y: 15, w: 24, h: 8 },
    }),
  );

  return builder.build();
}

/**
 * Serializes the Static Site Probes dashboard to JSON with Helm-safe escaping
 * applied (so values containing `{{ ... }}` survive Helm rendering when the
 * dashboard ships in a ConfigMap template).
 *
 * @returns The dashboard JSON ready for inclusion in a Helm template.
 *
 * @example
 * ```ts
 * import { exportStaticSiteProbesDashboardJson } from "./static-site-probes-dashboard.ts";
 * const json = exportStaticSiteProbesDashboardJson();
 * // Write `json` to a ConfigMap data entry.
 * ```
 */
export function exportStaticSiteProbesDashboardJson(): string {
  return exportDashboardWithHelmEscaping(createStaticSiteProbesDashboard());
}
