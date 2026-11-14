import * as dashboard from "@grafana/grafana-foundation-sdk/dashboard";
import * as timeseries from "@grafana/grafana-foundation-sdk/timeseries";
import * as stat from "@grafana/grafana-foundation-sdk/stat";
import * as prometheus from "@grafana/grafana-foundation-sdk/prometheus";

import {
  SCOUT_DASHBOARD_FILTER,
  type PrometheusDatasource,
} from "./scout-dashboard-filter.ts";

const CLIENT_FILTER = SCOUT_DASHBOARD_FILTER;

type GridPos = { x: number; y: number; w: number; h: number };

type PanelSpec = {
  readonly title: string;
  readonly description: string;
  readonly expression: string;
  readonly legend: string;
  readonly unit: string;
  readonly gridPos: GridPos;
};

function rateSeries(
  spec: PanelSpec,
  prometheusDatasource: PrometheusDatasource,
): timeseries.PanelBuilder {
  return new timeseries.PanelBuilder()
    .title(spec.title)
    .description(spec.description)
    .datasource(prometheusDatasource)
    .withTarget(
      new prometheus.DataqueryBuilder()
        .expr(spec.expression)
        .legendFormat(spec.legend),
    )
    .unit(spec.unit)
    .lineWidth(2)
    .fillOpacity(10)
    .gridPos(spec.gridPos);
}

function gaugeStat(
  spec: Omit<PanelSpec, "legend">,
  prometheusDatasource: PrometheusDatasource,
): stat.PanelBuilder {
  return new stat.PanelBuilder()
    .title(spec.title)
    .description(spec.description)
    .datasource(prometheusDatasource)
    .withTarget(
      new prometheus.DataqueryBuilder()
        .expr(spec.expression)
        .legendFormat("{{environment}}"),
    )
    .unit(spec.unit)
    .gridPos(spec.gridPos);
}

/**
 * Adds the "Scout Client" row: the evidence each production switch-on step
 * needs. Observation outcomes and quarantine reasons, post-game outcomes,
 * game-end to Discord latency, the duplicate-risk counter, alias lookups, and
 * the backlog gauges.
 *
 * Starts below the adoption funnel, which ends at y 193.
 */
export function addScoutClientRow(
  builder: dashboard.DashboardBuilder,
  prometheusDatasource: PrometheusDatasource,
): void {
  builder.withRow(
    new dashboard.RowBuilder("Scout Client").gridPos({
      x: 0,
      y: 194,
      w: 24,
      h: 1,
    }),
  );

  builder.withPanel(
    rateSeries(
      {
        title: "Observations by Outcome",
        description:
          "Scout Client observations first stored per minute, by kind and outcome (accepted or quarantined)",
        expression: `sum by (environment, kind, outcome) (rate(scout_client_observations_total{${CLIENT_FILTER}}[5m])) * 60`,
        legend: "{{environment}} - {{kind}} - {{outcome}}",
        unit: "short",
        gridPos: { x: 0, y: 195, w: 12, h: 8 },
      },
      prometheusDatasource,
    ),
  );

  builder.withPanel(
    rateSeries(
      {
        title: "Quarantine Reasons",
        description:
          "Quarantined observations per minute by reason. A single dominant reason names the fix.",
        expression: `sum by (environment, quarantine_reason) (rate(scout_client_observations_total{outcome="quarantined",${CLIENT_FILTER}}[5m])) * 60`,
        legend: "{{environment}} - {{quarantine_reason}}",
        unit: "short",
        gridPos: { x: 12, y: 195, w: 12, h: 8 },
      },
      prometheusDatasource,
    ),
  );

  builder.withPanel(
    rateSeries(
      {
        title: "Post-game Outcomes",
        description:
          "Post-game observations per hour by projected outcome (complete, end_of_game, unsupported_mode, waiting_identity, historical) and game kind",
        expression: `sum by (environment, outcome, game_kind) (increase(scout_client_post_game_outcome_total{${CLIENT_FILTER}}[1h]))`,
        legend: "{{environment}} - {{outcome}} - {{game_kind}}",
        unit: "short",
        gridPos: { x: 0, y: 203, w: 12, h: 8 },
      },
      prometheusDatasource,
    ),
  );

  builder.withPanel(
    rateSeries(
      {
        title: "Game End to Discord p50 / p95",
        description:
          "Seconds from a game ending to its post-match report being delivered to Discord",
        expression: `histogram_quantile(0.95, sum by (environment, le) (rate(scout_client_game_end_to_delivered_seconds_bucket{${CLIENT_FILTER}}[30m])))`,
        legend: "{{environment}} p95",
        unit: "s",
        gridPos: { x: 12, y: 203, w: 12, h: 8 },
      },
      prometheusDatasource,
    ).withTarget(
      new prometheus.DataqueryBuilder()
        .expr(
          `histogram_quantile(0.5, sum by (environment, le) (rate(scout_client_game_end_to_delivered_seconds_bucket{${CLIENT_FILTER}}[30m])))`,
        )
        .legendFormat("{{environment}} p50"),
    ),
  );

  builder.withPanel(
    rateSeries(
      {
        title: "Identity Alias Lookups",
        description:
          "League-client identity lookups per hour by outcome. Rising error or not_found means client data stops joining.",
        expression: `sum by (environment, outcome) (increase(scout_client_identity_aliases_total{${CLIENT_FILTER}}[1h]))`,
        legend: "{{environment}} - {{outcome}}",
        unit: "short",
        gridPos: { x: 0, y: 211, w: 12, h: 8 },
      },
      prometheusDatasource,
    ),
  );

  builder.withPanel(
    rateSeries(
      {
        title: "Games Without Prematch",
        description:
          "Client-observed games over the last day, against those Scout archived no prematch for, by game kind. Negative values mean the sweep failed.",
        expression: `sum by (environment, game_kind) (scout_client_games_without_prematch{${CLIENT_FILTER}})`,
        legend: "{{environment}} - {{game_kind}}",
        unit: "short",
        gridPos: { x: 12, y: 211, w: 12, h: 8 },
      },
      prometheusDatasource,
    ),
  );

  builder.withPanel(
    gaugeStat(
      {
        title: "Riot Listed After Client Selection (24h)",
        description:
          "Matches Riot's history listed after a client selection already covered them: the duplicate-risk signal.",
        expression: `sum by (environment) (increase(scout_client_riot_listed_after_selection_total{${CLIENT_FILTER}}[24h]))`,
        unit: "short",
        gridPos: { x: 0, y: 219, w: 6, h: 4 },
      },
      prometheusDatasource,
    ),
  );

  builder.withPanel(
    gaugeStat(
      {
        title: "Active Devices",
        description:
          "Scout Client devices that checked in over the last fifteen minutes",
        expression: `max by (environment) (scout_client_active_devices{${CLIENT_FILTER}})`,
        unit: "short",
        gridPos: { x: 6, y: 219, w: 6, h: 4 },
      },
      prometheusDatasource,
    ),
  );

  builder.withPanel(
    gaugeStat(
      {
        title: "Alias Lookup Backlog",
        description:
          "League-client UUIDs reported in the last day that still have no Riot alias",
        expression: `max by (environment) (scout_client_alias_lookup_backlog{${CLIENT_FILTER}})`,
        unit: "short",
        gridPos: { x: 12, y: 219, w: 6, h: 4 },
      },
      prometheusDatasource,
    ),
  );

  builder.withPanel(
    gaugeStat(
      {
        title: "Reconciliation Backlog Age",
        description:
          "Age of the oldest accepted observation still awaiting evidence reconciliation",
        expression: `max by (environment) (scout_client_reconciliation_oldest_age_seconds{${CLIENT_FILTER}})`,
        unit: "s",
        gridPos: { x: 18, y: 219, w: 6, h: 4 },
      },
      prometheusDatasource,
    ).thresholds(
      new dashboard.ThresholdsConfigBuilder()
        .mode(dashboard.ThresholdsMode.Absolute)
        .steps([
          { value: 0, color: "green" },
          { value: 3600, color: "red" },
        ]),
    ),
  );
}
