import * as dashboard from "@grafana/grafana-foundation-sdk/dashboard";
import * as common from "@grafana/grafana-foundation-sdk/common";
import * as timeseries from "@grafana/grafana-foundation-sdk/timeseries";
import * as stat from "@grafana/grafana-foundation-sdk/stat";
import * as prometheus from "@grafana/grafana-foundation-sdk/prometheus";
import { exportDashboardWithHelmEscaping } from "./dashboard-export.ts";

// TODO: grafana is not creating this one

/**
 * Creates a Grafana dashboard for Gitckup backup monitoring
 * Shows backup success rates and backup counts (repos, sources, destinations)
 */
export function createGitckupDashboard() {
  // Create Prometheus datasource reference
  const prometheusDatasource = {
    type: "prometheus",
    uid: "Prometheus",
  };

  // Build the main dashboard
  const builder = new dashboard.DashboardBuilder("Gitckup - Backup Monitoring")
    .uid("gitckup-dashboard")
    .tags(["gitckup", "backup", "git", "github"])
    .time({ from: "now-7d", to: "now" })
    .refresh("30s")
    .timezone("browser")
    .editable();

  // Row 1: Backup Success Overview
  builder.withRow(new dashboard.RowBuilder("Backup Success Overview"));

  // Repository Backup Success Rate
  builder.withPanel(
    new stat.PanelBuilder()
      .title("Repository Backup Success Rate")
      .description("Percentage of repositories successfully backed up")
      .datasource(prometheusDatasource)
      .withTarget(
        new prometheus.DataqueryBuilder()
          .expr("(count(gickup_repo_success == 1) / gickup_repos_discovered) * 100")
          .legendFormat("Success Rate"),
      )
      .unit("percent")
      .decimals(1)
      .colorMode(common.BigValueColorMode.Value)
      .graphMode(common.BigValueGraphMode.Area)
      .thresholds(
        new dashboard.ThresholdsConfigBuilder().mode(dashboard.ThresholdsMode.Absolute).steps([
          { value: 0, color: "red" },
          { value: 95, color: "yellow" },
          { value: 99, color: "green" },
        ]),
      )
      .gridPos({ x: 0, y: 1, w: 6, h: 4 }),
  );

  // Sources Backup Success Rate
  builder.withPanel(
    new stat.PanelBuilder()
      .title("Sources Backup Success Rate")
      .description("Percentage of sources successfully backed up")
      .datasource(prometheusDatasource)
      .withTarget(
        new prometheus.DataqueryBuilder()
          .expr("(gickup_sources_complete / gickup_sources) * 100")
          .legendFormat("Success Rate"),
      )
      .unit("percent")
      .decimals(1)
      .colorMode(common.BigValueColorMode.Value)
      .graphMode(common.BigValueGraphMode.Area)
      .thresholds(
        new dashboard.ThresholdsConfigBuilder().mode(dashboard.ThresholdsMode.Absolute).steps([
          { value: 0, color: "red" },
          { value: 95, color: "yellow" },
          { value: 99, color: "green" },
        ]),
      )
      .gridPos({ x: 6, y: 1, w: 6, h: 4 }),
  );

  // Destinations Backup Success Rate
  builder.withPanel(
    new stat.PanelBuilder()
      .title("Destinations Backup Success Rate")
      .description("Percentage of destinations successfully backed up")
      .datasource(prometheusDatasource)
      .withTarget(
        new prometheus.DataqueryBuilder()
          .expr("(gickup_destinations_complete / gickup_destinations) * 100")
          .legendFormat("Success Rate"),
      )
      .unit("percent")
      .decimals(1)
      .colorMode(common.BigValueColorMode.Value)
      .graphMode(common.BigValueGraphMode.Area)
      .thresholds(
        new dashboard.ThresholdsConfigBuilder().mode(dashboard.ThresholdsMode.Absolute).steps([
          { value: 0, color: "red" },
          { value: 95, color: "yellow" },
          { value: 99, color: "green" },
        ]),
      )
      .gridPos({ x: 12, y: 1, w: 6, h: 4 }),
  );

  // Job Completion Status
  builder.withPanel(
    new stat.PanelBuilder()
      .title("Job Completion Status")
      .description("1 = Jobs balanced, 0 = Jobs failed")
      .datasource(prometheusDatasource)
      .withTarget(
        new prometheus.DataqueryBuilder()
          .expr("increase(gickup_jobs_started[25h]) <= increase(gickup_jobs_complete[25h])")
          .legendFormat("Status"),
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
      .gridPos({ x: 18, y: 1, w: 6, h: 4 }),
  );

  // Row 2: Backup Counts (Size Proxies)
  builder.withRow(new dashboard.RowBuilder("Backup Counts"));

  // Repositories Discovered
  builder.withPanel(
    new stat.PanelBuilder()
      .title("Repositories Discovered")
      .description("Total number of repositories discovered")
      .datasource(prometheusDatasource)
      .withTarget(new prometheus.DataqueryBuilder().expr("gickup_repos_discovered").legendFormat("Repos"))
      .unit("short")
      .colorMode(common.BigValueColorMode.Value)
      .graphMode(common.BigValueGraphMode.Area)
      .gridPos({ x: 0, y: 5, w: 6, h: 4 }),
  );

  // Repositories Successfully Backed Up
  builder.withPanel(
    new stat.PanelBuilder()
      .title("Repositories Backed Up")
      .description("Number of repositories successfully backed up")
      .datasource(prometheusDatasource)
      .withTarget(new prometheus.DataqueryBuilder().expr("count(gickup_repo_success == 1)").legendFormat("Success"))
      .unit("short")
      .colorMode(common.BigValueColorMode.Value)
      .graphMode(common.BigValueGraphMode.Area)
      .gridPos({ x: 6, y: 5, w: 6, h: 4 }),
  );

  // Total Sources
  builder.withPanel(
    new stat.PanelBuilder()
      .title("Total Sources")
      .description("Total number of backup sources configured")
      .datasource(prometheusDatasource)
      .withTarget(new prometheus.DataqueryBuilder().expr("gickup_sources").legendFormat("Sources"))
      .unit("short")
      .colorMode(common.BigValueColorMode.Value)
      .graphMode(common.BigValueGraphMode.Area)
      .gridPos({ x: 12, y: 5, w: 6, h: 4 }),
  );

  // Total Destinations
  builder.withPanel(
    new stat.PanelBuilder()
      .title("Total Destinations")
      .description("Total number of backup destinations configured")
      .datasource(prometheusDatasource)
      .withTarget(new prometheus.DataqueryBuilder().expr("gickup_destinations").legendFormat("Destinations"))
      .unit("short")
      .colorMode(common.BigValueColorMode.Value)
      .graphMode(common.BigValueGraphMode.Area)
      .gridPos({ x: 18, y: 5, w: 6, h: 4 }),
  );

  // Row 3: Job Statistics
  builder.withRow(new dashboard.RowBuilder("Job Statistics"));

  // Jobs Started (7 days)
  builder.withPanel(
    new stat.PanelBuilder()
      .title("Jobs Started (7d)")
      .description("Total backup jobs started in the last 7 days")
      .datasource(prometheusDatasource)
      .withTarget(new prometheus.DataqueryBuilder().expr("increase(gickup_jobs_started[7d])").legendFormat("Started"))
      .unit("short")
      .colorMode(common.BigValueColorMode.Value)
      .graphMode(common.BigValueGraphMode.Area)
      .gridPos({ x: 0, y: 9, w: 6, h: 4 }),
  );

  // Jobs Completed (7 days)
  builder.withPanel(
    new stat.PanelBuilder()
      .title("Jobs Completed (7d)")
      .description("Total backup jobs completed in the last 7 days")
      .datasource(prometheusDatasource)
      .withTarget(
        new prometheus.DataqueryBuilder().expr("increase(gickup_jobs_complete[7d])").legendFormat("Completed"),
      )
      .unit("short")
      .colorMode(common.BigValueColorMode.Value)
      .graphMode(common.BigValueGraphMode.Area)
      .gridPos({ x: 6, y: 9, w: 6, h: 4 }),
  );

  // Average Job Duration
  builder.withPanel(
    new stat.PanelBuilder()
      .title("Average Job Duration")
      .description("Average duration of backup jobs")
      .datasource(prometheusDatasource)
      .withTarget(
        new prometheus.DataqueryBuilder()
          .expr("gickup_job_duration_sum / gickup_job_duration_count")
          .legendFormat("Duration"),
      )
      .unit("s")
      .colorMode(common.BigValueColorMode.Value)
      .graphMode(common.BigValueGraphMode.Area)
      .gridPos({ x: 12, y: 9, w: 6, h: 4 }),
  );

  // Failed Repositories
  builder.withPanel(
    new stat.PanelBuilder()
      .title("Failed Repositories")
      .description("Number of repositories that failed to backup")
      .datasource(prometheusDatasource)
      .withTarget(
        new prometheus.DataqueryBuilder()
          .expr("gickup_repos_discovered - count(gickup_repo_success == 1)")
          .legendFormat("Failed"),
      )
      .unit("short")
      .colorMode(common.BigValueColorMode.Value)
      .graphMode(common.BigValueGraphMode.Area)
      .thresholds(
        new dashboard.ThresholdsConfigBuilder().mode(dashboard.ThresholdsMode.Absolute).steps([
          { value: 0, color: "green" },
          { value: 1, color: "yellow" },
          { value: 5, color: "red" },
        ]),
      )
      .gridPos({ x: 18, y: 9, w: 6, h: 4 }),
  );

  // Row 4: Backup Success Over Time
  builder.withRow(new dashboard.RowBuilder("Backup Success Over Time"));

  // Repository Success Rate Over Time
  builder.withPanel(
    new timeseries.PanelBuilder()
      .title("Repository Success Rate Over Time")
      .description("Percentage of repositories successfully backed up")
      .datasource(prometheusDatasource)
      .withTarget(
        new prometheus.DataqueryBuilder()
          .expr("(count(gickup_repo_success == 1) / gickup_repos_discovered) * 100")
          .legendFormat("Success Rate"),
      )
      .unit("percent")
      .decimals(1)
      .lineWidth(2)
      .fillOpacity(10)
      .thresholds(
        new dashboard.ThresholdsConfigBuilder().mode(dashboard.ThresholdsMode.Absolute).steps([
          { value: 0, color: "red" },
          { value: 95, color: "yellow" },
          { value: 99, color: "green" },
        ]),
      )
      .gridPos({ x: 0, y: 13, w: 12, h: 8 }),
  );

  // Sources and Destinations Success Rate Over Time
  builder.withPanel(
    new timeseries.PanelBuilder()
      .title("Sources & Destinations Success Rate")
      .description("Success rate for sources and destinations")
      .datasource(prometheusDatasource)
      .withTarget(
        new prometheus.DataqueryBuilder()
          .expr("(gickup_sources_complete / gickup_sources) * 100")
          .legendFormat("Sources"),
      )
      .withTarget(
        new prometheus.DataqueryBuilder()
          .expr("(gickup_destinations_complete / gickup_destinations) * 100")
          .legendFormat("Destinations"),
      )
      .unit("percent")
      .decimals(1)
      .lineWidth(2)
      .fillOpacity(10)
      .thresholds(
        new dashboard.ThresholdsConfigBuilder().mode(dashboard.ThresholdsMode.Absolute).steps([
          { value: 0, color: "red" },
          { value: 95, color: "yellow" },
          { value: 99, color: "green" },
        ]),
      )
      .gridPos({ x: 12, y: 13, w: 12, h: 8 }),
  );

  // Row 5: Backup Counts Over Time
  builder.withRow(new dashboard.RowBuilder("Backup Counts Over Time"));

  // Repositories Over Time
  builder.withPanel(
    new timeseries.PanelBuilder()
      .title("Repositories Over Time")
      .description("Repositories discovered vs successfully backed up")
      .datasource(prometheusDatasource)
      .withTarget(new prometheus.DataqueryBuilder().expr("gickup_repos_discovered").legendFormat("Discovered"))
      .withTarget(new prometheus.DataqueryBuilder().expr("count(gickup_repo_success == 1)").legendFormat("Backed Up"))
      .unit("short")
      .lineWidth(2)
      .fillOpacity(10)
      .gridPos({ x: 0, y: 21, w: 12, h: 8 }),
  );

  // Sources and Destinations Over Time
  builder.withPanel(
    new timeseries.PanelBuilder()
      .title("Sources & Destinations Over Time")
      .description("Total vs completed sources and destinations")
      .datasource(prometheusDatasource)
      .withTarget(new prometheus.DataqueryBuilder().expr("gickup_sources").legendFormat("Sources Total"))
      .withTarget(new prometheus.DataqueryBuilder().expr("gickup_sources_complete").legendFormat("Sources Complete"))
      .withTarget(new prometheus.DataqueryBuilder().expr("gickup_destinations").legendFormat("Destinations Total"))
      .withTarget(
        new prometheus.DataqueryBuilder().expr("gickup_destinations_complete").legendFormat("Destinations Complete"),
      )
      .unit("short")
      .lineWidth(2)
      .fillOpacity(10)
      .gridPos({ x: 12, y: 21, w: 12, h: 8 }),
  );

  // Row 6: Job Performance
  builder.withRow(new dashboard.RowBuilder("Job Performance"));

  // Job Duration Over Time
  builder.withPanel(
    new timeseries.PanelBuilder()
      .title("Job Duration Over Time")
      .description("Average backup job duration")
      .datasource(prometheusDatasource)
      .withTarget(
        new prometheus.DataqueryBuilder()
          .expr("gickup_job_duration_sum / gickup_job_duration_count")
          .legendFormat("Average Duration"),
      )
      .unit("s")
      .lineWidth(2)
      .fillOpacity(10)
      .gridPos({ x: 0, y: 29, w: 12, h: 8 }),
  );

  // Jobs Started vs Completed Over Time
  builder.withPanel(
    new timeseries.PanelBuilder()
      .title("Jobs Started vs Completed")
      .description("Backup job execution rate")
      .datasource(prometheusDatasource)
      .withTarget(new prometheus.DataqueryBuilder().expr("rate(gickup_jobs_started[5m])").legendFormat("Started Rate"))
      .withTarget(
        new prometheus.DataqueryBuilder().expr("rate(gickup_jobs_complete[5m])").legendFormat("Completed Rate"),
      )
      .unit("ops")
      .lineWidth(2)
      .fillOpacity(10)
      .gridPos({ x: 12, y: 29, w: 12, h: 8 }),
  );

  return builder.build();
}

/**
 * Exports the dashboard as JSON string for use in ConfigMaps or API calls
 */
export function exportGitckupDashboardJson(): string {
  const dashboard = createGitckupDashboard();
  return exportDashboardWithHelmEscaping(dashboard);
}
