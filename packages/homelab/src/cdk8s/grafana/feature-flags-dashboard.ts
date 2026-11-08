import * as dashboard from "@grafana/grafana-foundation-sdk/dashboard";
import * as prometheus from "@grafana/grafana-foundation-sdk/prometheus";
import * as table from "@grafana/grafana-foundation-sdk/table";
import {
  createStatPanel as baseStatPanel,
  createTimeseriesPanel as baseTimeseriesPanel,
} from "./shared/dashboard-panels.ts";
import { exportDashboardWithHelmEscaping } from "./dashboard-export.ts";
import { managedFlagInventory } from "@shepherdjerred/feature-flags/managed-flag-inventory.ts";

const datasource = { type: "prometheus", uid: "prometheus" };
const createStatPanel = (options: Parameters<typeof baseStatPanel>[0]) =>
  baseStatPanel(options).datasource(datasource);
const createTimeseriesPanel = (
  options: Parameters<typeof baseTimeseriesPanel>[0],
) => baseTimeseriesPanel(options).datasource(datasource);

const pair = "flipt_environment, flipt_namespace";
// Choose the latest observer per pair before aggregating away worker identity.
// Otherwise an old worker's ON can outvote the replacement worker's OFF.
const observations = "feature_flag_inventory_observed_timestamp_seconds";
const latest = `(${observations} == on (${pair}) group_left() max by (${pair}) (${observations})) and (${observations} > time() - 600)`;
export const LIVE_FLAG_STATES_QUERY = `max by (${pair}, flag, state) (feature_flag_rollout_state and on (job, instance, ${pair}) (${latest})) == 1`;

export function createFeatureFlagsDashboard() {
  const builder = new dashboard.DashboardBuilder("Feature flags")
    .uid("feature-flags")
    .tags(["feature-flags", "flipt"])
    .time({ from: "now-6h", to: "now" })
    .refresh("30s")
    .timezone("browser");
  builder.withPanel(
    createStatPanel({
      title: "Fresh inventory pairs",
      description:
        "A configured flag state does not prove a running consumer or successful user flow.",
      query: `count(max by (${pair}) (${observations}) > time() - 600) or vector(0)`,
      legend: "fresh pairs",
      instant: true,
      thresholds: [
        { value: 0, color: "red" },
        {
          value:
            managedFlagInventory.environments.length *
            managedFlagInventory.namespaces.length,
          color: "green",
        },
      ],
      gridPos: { x: 0, y: 0, w: 8, h: 4 },
    }),
  );
  builder.withPanel(
    createStatPanel({
      title: "Expected inventory pairs",
      query: `count(max by (${pair}) (feature_flag_inventory_expected))`,
      legend: "expected pairs",
      instant: true,
      gridPos: { x: 8, y: 0, w: 8, h: 4 },
    }),
  );
  builder.withPanel(
    createStatPanel({
      title: "Overdue exception reviews",
      query: `count(max by (${pair}, flag, issue) (feature_flag_exception_review_timestamp_seconds) < time()) or vector(0)`,
      legend: "reviews",
      instant: true,
      thresholds: [
        { value: 0, color: "green" },
        { value: 1, color: "red" },
      ],
      gridPos: { x: 16, y: 0, w: 8, h: 4 },
    }),
  );
  const tables = [
    {
      title: "Live configured boolean state",
      description:
        "Latest successful snapshot per Flipt pair, at most ten minutes old. ON, OFF, targeted, partial, missing and invalid are configuration states. Missing rows require checking observation freshness.",
      query: LIVE_FLAG_STATES_QUERY,
    },
    {
      title: "Default-off exceptions and review deadlines",
      description:
        "Review dates are UTC. Each issue identifies the enablement criteria; beta copies do not imply deployed beta services.",
      query: `1000 * max by (${pair}, flag, issue) (feature_flag_exception_review_timestamp_seconds)`,
    },
    {
      title: "Running consumer provider identity",
      description:
        "Only instrumented consumers appear. This proves their configured Flipt pair, not feature acceptance.",
      query: "feature_flag_provider_info == 1",
    },
  ];
  for (const [index, panel] of tables.entries()) {
    builder.withPanel(
      new table.PanelBuilder()
        .title(panel.title)
        .description(panel.description)
        .datasource(datasource)
        .withTarget(
          new prometheus.DataqueryBuilder()
            .expr(panel.query)
            .format(prometheus.PromQueryFormat.Table)
            .instant(),
        )
        .withTransformation({
          id: "organize",
          options: {
            excludeByName: { Time: true, Value: index !== 1 },
            indexByName: {
              flipt_environment: 0,
              flipt_namespace: 1,
              flag: 2,
              state: 3,
              issue: 3,
              Value: 4,
            },
            renameByName: {
              flipt_environment: "Environment",
              flipt_namespace: "Namespace",
              flag: "Flag",
              state: "State",
              issue: "Issue",
              Value: "Review by (UTC)",
            },
          },
        })
        .overrideByName("Flag", [{ id: "custom.width", value: 450 }])
        .overrideByName("Environment", [{ id: "custom.width", value: 120 }])
        .overrideByName("Namespace", [{ id: "custom.width", value: 150 }])
        .overrideByName("Issue", [{ id: "custom.width", value: 80 }])
        .overrideByName("Review by (UTC)", [
          { id: "custom.width", value: 230 },
          { id: "unit", value: "dateTimeAsIso" },
        ])
        .filterable(true)
        .gridPos({ x: 0, y: 4 + index * 10, w: 24, h: 10 }),
    );
  }
  builder.withPanel(
    createTimeseriesPanel({
      title: "Actual evaluations by result",
      targets: [
        {
          query:
            "sum by (job, flag, reason, value) (rate(feature_flag_evaluations_total[5m]))",
          legend: "{{job}} / {{flag}} / {{reason}} / {{value}}",
        },
      ],
      unit: "ops",
      gridPos: { x: 0, y: 34, w: 24, h: 9 },
    }),
  );
  builder.withPanel(
    createTimeseriesPanel({
      title: "Provider readiness",
      targets: [
        {
          query: "feature_flag_provider_ready",
          legend: "{{job}} / {{instance}}",
        },
      ],
      gridPos: { x: 0, y: 43, w: 12, h: 8 },
    }),
  );
  builder.withPanel(
    createTimeseriesPanel({
      title: "Consumer snapshot age",
      targets: [
        {
          query: "feature_flag_snapshot_age_seconds",
          legend: "{{job}} / {{instance}}",
        },
      ],
      unit: "s",
      gridPos: { x: 12, y: 43, w: 12, h: 8 },
    }),
  );
  builder.withPanel(
    createTimeseriesPanel({
      title: "Inventory observation age",
      targets: [
        {
          query: `time() - max by (${pair}) (${observations})`,
          legend: "{{flipt_environment}} / {{flipt_namespace}}",
        },
      ],
      unit: "s",
      gridPos: { x: 0, y: 51, w: 24, h: 8 },
    }),
  );
  return builder;
}

export function exportFeatureFlagsDashboardJson(): string {
  return exportDashboardWithHelmEscaping(createFeatureFlagsDashboard().build());
}
