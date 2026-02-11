import * as dashboard from "@grafana/grafana-foundation-sdk/dashboard";
import * as common from "@grafana/grafana-foundation-sdk/common";
import * as timeseries from "@grafana/grafana-foundation-sdk/timeseries";
import * as stat from "@grafana/grafana-foundation-sdk/stat";
import * as prometheus from "@grafana/grafana-foundation-sdk/prometheus";
import { exportDashboardWithHelmEscaping } from "./dashboard-export.ts";

/**
 * Creates a Grafana dashboard for Scout for LoL usage and performance metrics
 * Uses Grafana Foundation SDK to define the dashboard programmatically
 */
export function createScoutDashboard() {
  // Create Prometheus datasource reference
  const prometheusDatasource = {
    type: "prometheus",
    uid: "Prometheus",
  };

  // Create environment variable for filtering
  const environmentVariable = new dashboard.QueryVariableBuilder("environment")
    .label("Environment")
    .query("label_values(discord_guilds, environment)")
    .datasource(prometheusDatasource)
    .multi(true)
    .includeAll(true)
    .allValue(".*");

  // Create server variable for optional filtering
  const serverVariable = new dashboard.QueryVariableBuilder("server")
    .label("Server")
    .query('label_values(discord_guilds{environment=~"$environment"}, instance)')
    .datasource(prometheusDatasource)
    .multi(true)
    .includeAll(true)
    .allValue(".*");

  // Helper function to build filter expression
  const buildFilter = () => {
    return 'environment=~"$environment",instance=~"$server"';
  };

  // Build the main dashboard
  const builder = new dashboard.DashboardBuilder("Scout for LoL - Usage & Performance")
    .uid("scout-for-lol-dashboard")
    .tags(["scout", "discord", "gaming"])
    .time({ from: "now-24h", to: "now" })
    .refresh("30s")
    .timezone("browser")
    .editable()
    .withVariable(environmentVariable)
    .withVariable(serverVariable);

  const createStatPanel = (
    title: string,
    query: string,
    legend: string,
    gridPos: {
      x: number;
      y: number;
      w: number;
      h: number;
    },
    unit = "short",
    graphMode = common.BigValueGraphMode.Area,
  ) => {
    return new stat.PanelBuilder()
      .title(title)
      .datasource(prometheusDatasource)
      .withTarget(new prometheus.DataqueryBuilder().expr(query).legendFormat(legend))
      .unit(unit)
      .colorMode(common.BigValueColorMode.Value)
      .graphMode(graphMode)
      .gridPos(gridPos);
  };

  // Row 1: Overview Stats
  builder.withRow(new dashboard.RowBuilder("Overview"));

  // Guild Count
  builder.withPanel(
    createStatPanel("Discord Guilds", `sum by (environment) (discord_guilds{${buildFilter()}})`, "{{environment}}", {
      x: 0,
      y: 1,
      w: 4,
      h: 4,
    }),
  );

  // User Count
  builder.withPanel(
    createStatPanel("Discord Users", `sum by (environment) (discord_users{${buildFilter()}})`, "{{environment}}", {
      x: 4,
      y: 1,
      w: 4,
      h: 4,
    }),
  );

  // Players Tracked
  builder.withPanel(
    createStatPanel(
      "Players Tracked",
      `sum by (environment) (players_tracked_total{${buildFilter()}})`,
      "{{environment}}",
      { x: 8, y: 1, w: 4, h: 4 },
    ),
  );

  // Accounts Tracked
  builder.withPanel(
    createStatPanel(
      "Accounts Tracked",
      `sum by (environment) (accounts_tracked_total{${buildFilter()}})`,
      "{{environment}}",
      { x: 12, y: 1, w: 4, h: 4 },
    ),
  );

  // Servers with Data
  builder.withPanel(
    createStatPanel(
      "Servers with Data",
      `sum by (environment) (servers_with_data_total{${buildFilter()}})`,
      "{{environment}}",
      { x: 16, y: 1, w: 4, h: 4 },
    ),
  );

  // Connection Status
  builder.withPanel(
    new stat.PanelBuilder()
      .title("Connection Status")
      .description("1 = Connected, 0 = Disconnected (min across servers)")
      .datasource(prometheusDatasource)
      .withTarget(
        new prometheus.DataqueryBuilder()
          .expr(`min by (environment) (discord_connection_status{${buildFilter()}})`)
          .legendFormat("{{environment}}"),
      )
      .unit("short")
      .colorMode(common.BigValueColorMode.Value)
      .graphMode(common.BigValueGraphMode.None)
      .thresholds(
        new dashboard.ThresholdsConfigBuilder().mode(dashboard.ThresholdsMode.Absolute).steps([
          { value: 0, color: "red" },
          { value: 1, color: "green" },
        ]),
      )
      .gridPos({ x: 20, y: 1, w: 4, h: 4 }),
  );

  // Row 2: Discord Metrics
  builder.withRow(new dashboard.RowBuilder("Discord Metrics"));

  // WebSocket Latency
  builder.withPanel(
    new timeseries.PanelBuilder()
      .title("WebSocket Latency")
      .datasource(prometheusDatasource)
      .withTarget(
        new prometheus.DataqueryBuilder()
          .expr(`avg by (environment) (discord_latency_ms{${buildFilter()}})`)
          .legendFormat("{{environment}}"),
      )
      .unit("ms")
      .lineWidth(2)
      .fillOpacity(10)
      .gridPos({ x: 0, y: 5, w: 12, h: 8 }),
  );

  // Command Rate
  builder.withPanel(
    new timeseries.PanelBuilder()
      .title("Command Rate")
      .description("Discord commands per second")
      .datasource(prometheusDatasource)
      .withTarget(
        new prometheus.DataqueryBuilder()
          .expr(`sum by (environment) (rate(discord_commands_total{${buildFilter()}}[5m]))`)
          .legendFormat("{{environment}}"),
      )
      .unit("reqps")
      .lineWidth(2)
      .fillOpacity(10)
      .gridPos({ x: 12, y: 5, w: 12, h: 8 }),
  );

  // Row 3: Application Performance
  builder.withRow(new dashboard.RowBuilder("Application Performance"));

  // Uptime
  builder.withPanel(
    createStatPanel(
      "Uptime",
      `max by (environment) (application_uptime_seconds{${buildFilter()}})`,
      "{{environment}}",
      { x: 0, y: 13, w: 6, h: 4 },
      "s",
    ),
  );

  // Active Competitions
  builder.withPanel(
    createStatPanel(
      "Active Competitions",
      `sum by (environment) (competitions_active_total{${buildFilter()}})`,
      "{{environment}}",
      { x: 6, y: 13, w: 6, h: 4 },
    ),
  );

  // Total Subscriptions
  builder.withPanel(
    createStatPanel(
      "Active Subscriptions",
      `sum by (environment) (subscriptions_total{${buildFilter()}})`,
      "{{environment}}",
      { x: 12, y: 13, w: 6, h: 4 },
    ),
  );

  // Average Accounts per Player
  builder.withPanel(
    createStatPanel(
      "Avg Accounts/Player",
      `avg by (environment) (avg_accounts_per_player{${buildFilter()}})`,
      "{{environment}}",
      { x: 18, y: 13, w: 6, h: 4 },
      "short",
      common.BigValueGraphMode.None,
    ).decimals(2),
  );

  // Cron Job Performance
  builder.withPanel(
    new timeseries.PanelBuilder()
      .title("Cron Job Duration (95th percentile)")
      .description("Duration of cron job execution")
      .datasource(prometheusDatasource)
      .withTarget(
        new prometheus.DataqueryBuilder()
          .expr(
            `sum(rate(cron_job_duration_seconds_sum{${buildFilter()}}[5m])) by (environment, job_name) / sum(rate(cron_job_duration_seconds_count{${buildFilter()}}[5m])) by (environment, job_name)`,
          )
          .legendFormat("{{environment}} - {{job_name}}"),
      )
      .unit("s")
      .lineWidth(2)
      .fillOpacity(10)
      .gridPos({ x: 0, y: 17, w: 12, h: 8 }),
  );

  // Cron Job Execution Rate
  builder.withPanel(
    new timeseries.PanelBuilder()
      .title("Cron Job Success Rate")
      .description("Successful cron job executions per minute")
      .datasource(prometheusDatasource)
      .withTarget(
        new prometheus.DataqueryBuilder()
          .expr(
            `sum by (environment, job_name) (rate(cron_job_executions_total{status="success",${buildFilter()}}[5m]))`,
          )
          .legendFormat("{{environment}} - {{job_name}}"),
      )
      .unit("reqps")
      .lineWidth(2)
      .fillOpacity(10)
      .gridPos({ x: 12, y: 17, w: 12, h: 8 }),
  );

  // Row 4: API Activity
  builder.withRow(new dashboard.RowBuilder("API Activity"));

  // Riot API Request Rate
  builder.withPanel(
    new timeseries.PanelBuilder()
      .title("Riot API Request Rate")
      .description("Requests per second to Riot API")
      .datasource(prometheusDatasource)
      .withTarget(
        new prometheus.DataqueryBuilder()
          .expr(`sum by (environment) (rate(riot_api_requests_total{${buildFilter()}}[5m]))`)
          .legendFormat("{{environment}}"),
      )
      .unit("reqps")
      .lineWidth(2)
      .fillOpacity(10)
      .gridPos({ x: 0, y: 25, w: 12, h: 8 }),
  );

  // Database Query Rate
  builder.withPanel(
    new timeseries.PanelBuilder()
      .title("Database Query Rate")
      .description("Database queries per second")
      .datasource(prometheusDatasource)
      .withTarget(
        new prometheus.DataqueryBuilder()
          .expr(`sum by (environment) (rate(database_queries_total{${buildFilter()}}[5m]))`)
          .legendFormat("{{environment}}"),
      )
      .unit("reqps")
      .lineWidth(2)
      .fillOpacity(10)
      .gridPos({ x: 12, y: 25, w: 12, h: 8 }),
  );

  // Reports Generated
  builder.withPanel(
    new timeseries.PanelBuilder()
      .title("Reports Generated")
      .description("Match reports generated per minute")
      .datasource(prometheusDatasource)
      .withTarget(
        new prometheus.DataqueryBuilder()
          .expr(`sum by (environment) (rate(reports_generated_total{${buildFilter()}}[5m])) * 60`)
          .legendFormat("{{environment}}"),
      )
      .unit("short")
      .lineWidth(2)
      .fillOpacity(10)
      .gridPos({ x: 0, y: 33, w: 12, h: 8 }),
  );

  // Riot API Rate Limit Errors
  builder.withPanel(
    new timeseries.PanelBuilder()
      .title("Riot API Rate Limit Errors")
      .description("Rate limit errors from Riot API")
      .datasource(prometheusDatasource)
      .withTarget(
        new prometheus.DataqueryBuilder()
          .expr(`sum by (environment) (rate(riot_api_rate_limit_errors_total{${buildFilter()}}[5m]))`)
          .legendFormat("{{environment}}"),
      )
      .unit("reqps")
      .lineWidth(2)
      .fillOpacity(10)
      .thresholds(
        new dashboard.ThresholdsConfigBuilder().mode(dashboard.ThresholdsMode.Absolute).steps([
          { value: 0, color: "green" },
          { value: 0.01, color: "yellow" },
          { value: 0.1, color: "red" },
        ]),
      )
      .gridPos({ x: 12, y: 33, w: 12, h: 8 }),
  );

  return builder.build();
}

/**
 * Exports the dashboard as JSON string for use in ConfigMaps or API calls
 * Uses Helm-escaped Grafana template variables for compatibility
 */
export function exportScoutDashboardJson(): string {
  const dashboard = createScoutDashboard();
  return exportDashboardWithHelmEscaping(dashboard);
}
