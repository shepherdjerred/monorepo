import * as dashboard from "@grafana/grafana-foundation-sdk/dashboard";
import * as common from "@grafana/grafana-foundation-sdk/common";
import * as timeseries from "@grafana/grafana-foundation-sdk/timeseries";
import * as stat from "@grafana/grafana-foundation-sdk/stat";
import * as prometheus from "@grafana/grafana-foundation-sdk/prometheus";
import { exportDashboardWithHelmEscaping } from "./dashboard-export.ts";

const PROMETHEUS_DATASOURCE = {
  type: "prometheus",
  uid: "Prometheus",
};

function buildFilter() {
  return 'app=~"$app",provider=~"$provider",kind=~"$kind",source=~"$source"';
}

function buildFilterWithoutKind() {
  return 'app=~"$app",provider=~"$provider",source=~"$source"';
}

function activeIssueExpr(filter: string) {
  return `sum(max by (app, provider, kind, source) (ai_provider_issue_active{${filter}})) or on() vector(0)`;
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
  thresholds: { value: number; color: string }[];
}) {
  return new stat.PanelBuilder()
    .title(options.title)
    .description(options.description)
    .datasource(PROMETHEUS_DATASOURCE)
    .withTarget(
      new prometheus.DataqueryBuilder()
        .expr(options.query)
        .legendFormat(options.legend),
    )
    .unit("short")
    .colorMode(common.BigValueColorMode.Value)
    .graphMode(common.BigValueGraphMode.Area)
    .thresholds(
      new dashboard.ThresholdsConfigBuilder()
        .mode(dashboard.ThresholdsMode.Absolute)
        .steps(options.thresholds),
    )
    .gridPos(options.gridPos);
}

function createTimeseriesPanel(options: {
  title: string;
  description: string;
  targets: { query: string; legend: string }[];
  gridPos: { x: number; y: number; w: number; h: number };
}) {
  const basePanel = new timeseries.PanelBuilder()
    .title(options.title)
    .description(options.description)
    .datasource(PROMETHEUS_DATASOURCE)
    .unit("short")
    .lineWidth(2)
    .fillOpacity(10)
    .gridPos(options.gridPos);

  return options.targets.reduce(
    (panel, target) =>
      panel.withTarget(
        new prometheus.DataqueryBuilder()
          .expr(target.query)
          .legendFormat(target.legend),
      ),
    basePanel,
  );
}

export function createAiProviderDashboard() {
  const appVariable = createVariable({
    name: "app",
    label: "App",
    query: "label_values(ai_provider_issue_active, app)",
  });

  const providerVariable = createVariable({
    name: "provider",
    label: "Provider",
    query: 'label_values(ai_provider_errors_total{app=~"$app"}, provider)',
  });

  const kindVariable = createVariable({
    name: "kind",
    label: "Kind",
    query:
      'label_values(ai_provider_errors_total{app=~"$app",provider=~"$provider"}, kind)',
  });

  const sourceVariable = createVariable({
    name: "source",
    label: "Source",
    query:
      'label_values(ai_provider_errors_total{app=~"$app",provider=~"$provider",kind=~"$kind"}, source)',
  });

  const builder = new dashboard.DashboardBuilder("AI Provider Health")
    .uid("ai-provider-health")
    .tags(["ai", "providers", "alerts"])
    .time({ from: "now-24h", to: "now" })
    .refresh("30s")
    .timezone("browser")
    .editable()
    .withVariable(appVariable)
    .withVariable(providerVariable)
    .withVariable(kindVariable)
    .withVariable(sourceVariable);

  const filter = buildFilter();
  const filterWithoutKind = buildFilterWithoutKind();
  const issueThresholds = [
    { value: 0, color: "green" },
    { value: 1, color: "red" },
  ];
  const errorThresholds = [
    { value: 0, color: "green" },
    { value: 1, color: "yellow" },
    { value: 5, color: "red" },
  ];

  builder.withRow(
    new dashboard.RowBuilder("Overview").gridPos({ x: 0, y: 0, w: 24, h: 1 }),
  );

  builder.withPanel(
    createStatPanel({
      title: "Active Provider Issues",
      description:
        "Provider issue gauges currently set to active. This is the broad operational view across instrumented apps.",
      query: activeIssueExpr(filter),
      legend: "active",
      thresholds: issueThresholds,
      gridPos: { x: 0, y: 1, w: 6, h: 4 },
    }),
  );

  builder.withPanel(
    createStatPanel({
      title: "Scout Active Issues",
      description:
        "Active provider issue gauges for scout-for-lol. The Scout alert uses the same underlying gauge.",
      query: activeIssueExpr(
        'app="scout-for-lol",provider=~"$provider",kind=~"$kind",source=~"$source"',
      ),
      legend: "scout-for-lol",
      thresholds: issueThresholds,
      gridPos: { x: 6, y: 1, w: 6, h: 4 },
    }),
  );

  builder.withPanel(
    createStatPanel({
      title: "Temporal Active Issues",
      description:
        "Active provider issue gauges for Temporal activities. The Temporal alert uses the same underlying gauge.",
      query: activeIssueExpr(
        'app="temporal",provider=~"$provider",kind=~"$kind",source=~"$source"',
      ),
      legend: "temporal",
      thresholds: issueThresholds,
      gridPos: { x: 12, y: 1, w: 6, h: 4 },
    }),
  );

  builder.withPanel(
    createStatPanel({
      title: "Provider Errors (24h)",
      description:
        "Total provider operational classifications over the trailing 24h.",
      query: `sum(increase(ai_provider_errors_total{${filter}}[24h])) or on() vector(0)`,
      legend: "errors",
      thresholds: errorThresholds,
      gridPos: { x: 18, y: 1, w: 6, h: 4 },
    }),
  );

  builder.withRow(
    new dashboard.RowBuilder("Issues").gridPos({ x: 0, y: 5, w: 24, h: 1 }),
  );

  builder.withPanel(
    createTimeseriesPanel({
      title: "Active Issues by Source",
      description:
        "Current ai_provider_issue_active series by app, provider, kind, and source. A sustained value of 1 is what triggers the alerts.",
      targets: [
        {
          query: `max by (app, provider, kind, source) (ai_provider_issue_active{${filter}}) or on() vector(0)`,
          legend: "{{app}} {{provider}} {{kind}} {{source}}",
        },
      ],
      gridPos: { x: 0, y: 6, w: 24, h: 8 },
    }),
  );

  builder.withRow(
    new dashboard.RowBuilder("Errors").gridPos({ x: 0, y: 14, w: 24, h: 1 }),
  );

  builder.withPanel(
    createTimeseriesPanel({
      title: "Provider Errors per Hour",
      description:
        "Hourly error rate grouped by app, provider, kind, and source.",
      targets: [
        {
          query: `sum by (app, provider, kind, source) (rate(ai_provider_errors_total{${filter}}[5m])) * 3600 or on() vector(0)`,
          legend: "{{app}} {{provider}} {{kind}} {{source}}",
        },
      ],
      gridPos: { x: 0, y: 15, w: 12, h: 8 },
    }),
  );

  builder.withPanel(
    createTimeseriesPanel({
      title: "Provider Errors by App and Kind",
      description:
        "Hourly provider errors collapsed to app/provider/kind to separate quota, rate-limit, budget, and context-limit failures.",
      targets: [
        {
          query: `sum by (app, provider, kind) (rate(ai_provider_errors_total{${filter}}[5m])) * 3600 or on() vector(0)`,
          legend: "{{app}} {{provider}} {{kind}}",
        },
      ],
      gridPos: { x: 12, y: 15, w: 12, h: 8 },
    }),
  );

  builder.withPanel(
    createTimeseriesPanel({
      title: "Quota Errors per Hour",
      description:
        "Quota-classified provider errors per hour. This is the path for insufficient-credit incidents.",
      targets: [
        {
          query: `sum by (app, provider, source) (rate(ai_provider_errors_total{${filterWithoutKind},kind="quota"}[5m])) * 3600 or on() vector(0)`,
          legend: "{{app}} {{provider}} {{source}}",
        },
      ],
      gridPos: { x: 0, y: 23, w: 12, h: 8 },
    }),
  );

  builder.withPanel(
    createTimeseriesPanel({
      title: "Rate Limit Errors per Hour",
      description:
        "Rate-limit-classified provider errors per hour, separate from quota exhaustion.",
      targets: [
        {
          query: `sum by (app, provider, source) (rate(ai_provider_errors_total{${filterWithoutKind},kind="rate_limit"}[5m])) * 3600 or on() vector(0)`,
          legend: "{{app}} {{provider}} {{source}}",
        },
      ],
      gridPos: { x: 12, y: 23, w: 12, h: 8 },
    }),
  );

  builder.withPanel(
    createTimeseriesPanel({
      title: "Budget Exceeded per Hour",
      description:
        "Scout OpenAI token-budget circuit breaker events per hour. This captures expected spend-control skips outside Bugsink.",
      targets: [
        {
          query: `sum by (app, provider, source) (rate(ai_provider_errors_total{${filterWithoutKind},kind="budget_exceeded"}[5m])) * 3600 or on() vector(0)`,
          legend: "{{app}} {{provider}} {{source}}",
        },
      ],
      gridPos: { x: 0, y: 31, w: 12, h: 8 },
    }),
  );

  builder.withPanel(
    createTimeseriesPanel({
      title: "Context Limit Errors per Hour",
      description:
        "OpenAI input/context token limit errors per hour. These indicate oversized prompts or unusually large match timelines.",
      targets: [
        {
          query: `sum by (app, provider, source) (rate(ai_provider_errors_total{${filterWithoutKind},kind="context_limit"}[5m])) * 3600 or on() vector(0)`,
          legend: "{{app}} {{provider}} {{source}}",
        },
      ],
      gridPos: { x: 12, y: 31, w: 12, h: 8 },
    }),
  );

  return builder.build();
}

export function exportAiProviderDashboardJson(): string {
  return exportDashboardWithHelmEscaping(createAiProviderDashboard());
}
