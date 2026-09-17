import * as dashboard from "@grafana/grafana-foundation-sdk/dashboard";
import * as common from "@grafana/grafana-foundation-sdk/common";
import * as timeseries from "@grafana/grafana-foundation-sdk/timeseries";
import * as stat from "@grafana/grafana-foundation-sdk/stat";
import * as prometheus from "@grafana/grafana-foundation-sdk/prometheus";
import { exportDashboardWithHelmEscaping } from "@shepherdjerred/homelab/cdk8s/grafana/dashboard-export.ts";
import {
  buildScoutFilter,
  SCOUT_PROMETHEUS_DATASOURCE,
  scoutDashboardVariables,
} from "./scout-dashboard-filter.ts";

/**
 * The durable V2 pipeline, as the beta acceptance checklist asks about it.
 *
 * The checklist is five questions — no unexplained duplicates, no missing
 * receipts, no unknown deliveries, nothing stranded at a workflow start, and a
 * lake that is not falling behind — and this dashboard is laid out as those
 * questions rather than by which subsystem happens to emit each series. A
 * reviewer signing off on a rollout should be able to answer all five from one
 * screen without knowing which role wrote which metric.
 *
 * It is a separate dashboard from "Usage & Performance" because it answers a
 * question with an end. Usage is watched forever; this is watched closely
 * during a migration, and mixing the two would bury the rollout signal under
 * panels nobody is looking at this week.
 *
 * ## Aggregation
 *
 * The backlog gauges are swept by exactly one role (`sweep-policy.ts`), so they
 * are aggregated with `max` rather than `sum`. During a rollout two pods can
 * briefly both believe they own the sweep, and summing would double every
 * backlog at precisely the moment someone is reading it to decide whether the
 * rollout is safe. `max` of two agreeing sweeps is the same number either of
 * them reported.
 *
 * ## Zero-fill, and where it must not be used
 *
 * Counters that are normally zero carry `or on() vector(0)`, so a healthy
 * pipeline draws a zero line rather than "No data" — the repo learned that
 * distinction the hard way and `dashboard-query-health.test.ts` pins it. An
 * `increase()` over a counter really is 0 when nothing happened, so the
 * substitution states a fact.
 *
 * The gauge-backed panels deliberately do NOT carry it, and that difference is
 * the point of this dashboard. Those gauges come from one sweeping role, so
 * they are absent when that role is down, when the sweep has not run yet, or
 * when the operator has narrowed `$role` to a pod that does not sweep. In every
 * one of those cases the honest answer is "not measured", and
 * `or on() vector(0)` would replace it with a green zero — an acceptance
 * dashboard certifying a clean pipeline at the exact moment it can see nothing.
 * Absence renders as No Data, which is the state it is actually in.
 *
 * For the same reason the age panels put their lowest threshold band in red at
 * negative values: the sweep writes -1 when it ran and could not read, and -1
 * sits below every "too old" bound, so a plain green-below-threshold scale
 * would paint a failed measurement as the healthiest possible result.
 * `ScoutDurableSweepFailing` alerts on that same sentinel.
 */

const DURABLE_FILTER = buildScoutFilter();

function statPanel(options: {
  title: string;
  description: string;
  query: string;
  legend: string;
  gridPos: { x: number; y: number; w: number; h: number };
  unit?: string;
  steps?: { value: number | null; color: string }[];
}): stat.PanelBuilder {
  const panel = new stat.PanelBuilder()
    .title(options.title)
    .description(options.description)
    .datasource(SCOUT_PROMETHEUS_DATASOURCE)
    .withTarget(
      new prometheus.DataqueryBuilder()
        .expr(options.query)
        .legendFormat(options.legend),
    )
    .unit(options.unit ?? "short")
    .colorMode(common.BigValueColorMode.Value)
    .graphMode(common.BigValueGraphMode.None)
    .gridPos(options.gridPos);
  const steps = options.steps;
  if (steps !== undefined) {
    panel.thresholds(
      new dashboard.ThresholdsConfigBuilder()
        .mode(dashboard.ThresholdsMode.Absolute)
        .steps(steps),
    );
  }
  return panel;
}

function seriesPanel(options: {
  title: string;
  description: string;
  query: string;
  legend: string;
  gridPos: { x: number; y: number; w: number; h: number };
  unit?: string;
}): timeseries.PanelBuilder {
  return new timeseries.PanelBuilder()
    .title(options.title)
    .description(options.description)
    .datasource(SCOUT_PROMETHEUS_DATASOURCE)
    .withTarget(
      new prometheus.DataqueryBuilder()
        .expr(options.query)
        .legendFormat(options.legend),
    )
    .unit(options.unit ?? "short")
    .lineWidth(2)
    .fillOpacity(10)
    .gridPos(options.gridPos);
}

function addDuplicateRows(builder: dashboard.DashboardBuilder): void {
  builder.withRow(
    new dashboard.RowBuilder("Duplicates and parity").gridPos({
      x: 0,
      y: 0,
      w: 24,
      h: 1,
    }),
  );

  builder.withPanel(
    statPanel({
      title: "Dual-write conflicts (30m)",
      description:
        "Durable writes answered `conflict`: the same fact recorded twice with two different claims about it. Expected to be zero; anything else is the duplicate signal the rollout checklist asks about.",
      query: `sum(increase(scout_durable_dualwrite_records_total{outcome="conflict",${DURABLE_FILTER}}[30m])) or on() vector(0)`,
      legend: "conflicts",
      gridPos: { x: 0, y: 1, w: 6, h: 4 },
      steps: [
        { value: null, color: "green" },
        { value: 1, color: "red" },
      ],
    }),
  );

  builder.withPanel(
    statPanel({
      title: "Receipt conflicts (30m)",
      description:
        "Receipt writes whose evidence disagreed with the receipt already stored. A retry of a committed write answers `already-applied` and is not counted here.",
      query: `sum(increase(scout_durable_receipts_recorded_total{outcome="conflict",${DURABLE_FILTER}}[30m])) or on() vector(0)`,
      legend: "conflicts",
      gridPos: { x: 6, y: 1, w: 6, h: 4 },
      steps: [
        { value: null, color: "green" },
        { value: 1, color: "red" },
      ],
    }),
  );

  builder.withPanel(
    statPanel({
      title: "Dual-write failures (30m)",
      description:
        "Durable side-effects that failed without failing the v1 path. Non-zero means the v1 pipeline is carrying the product while the durable record is incomplete.",
      query: `sum(increase(scout_durable_dualwrite_failures_total{${DURABLE_FILTER}}[30m])) or on() vector(0)`,
      legend: "failures",
      gridPos: { x: 12, y: 1, w: 6, h: 4 },
      steps: [
        { value: null, color: "green" },
        { value: 1, color: "orange" },
      ],
    }),
  );

  builder.withPanel(
    statPanel({
      title: "Unknown deliveries",
      description:
        "Notification intents whose send left but whose response never arrived. The domain's operator dead end: nothing may retry one automatically, because a retry is exactly how a user gets told the same thing twice.",
      query: `max(scout_durable_notification_intents{state="unknown-delivery",${DURABLE_FILTER}})`,
      legend: "intents",
      gridPos: { x: 18, y: 1, w: 6, h: 4 },
      steps: [
        { value: null, color: "green" },
        { value: 1, color: "red" },
      ],
    }),
  );

  builder.withPanel(
    seriesPanel({
      title: "Durable writes by outcome",
      description:
        "Every durable fact recorded alongside the v1 pipeline. `adopted` and `already-applied` are healthy replay; a rising `conflict` line is not.",
      query: `sum by (outcome) (rate(scout_durable_dualwrite_records_total{${DURABLE_FILTER}}[5m])) or on() vector(0)`,
      legend: "{{outcome}}",
      gridPos: { x: 0, y: 5, w: 12, h: 8 },
      unit: "reqps",
    }),
  );

  builder.withPanel(
    seriesPanel({
      title: "Receipts recorded by kind",
      description:
        "Receipt writes per second by receipt kind. A stage that stops producing receipts entirely is a missing-receipt failure that no error counter reports, because nothing failed — the work simply stopped arriving.",
      query: `sum by (receipt_kind) (rate(scout_durable_receipts_recorded_total{outcome!="conflict",${DURABLE_FILTER}}[5m])) or on() vector(0)`,
      legend: "{{receipt_kind}}",
      gridPos: { x: 12, y: 5, w: 12, h: 8 },
      unit: "reqps",
    }),
  );
}

function addBacklogRows(builder: dashboard.DashboardBuilder): void {
  builder.withRow(
    new dashboard.RowBuilder("Backlogs and stranded work").gridPos({
      x: 0,
      y: 13,
      w: 24,
      h: 1,
    }),
  );

  builder.withPanel(
    statPanel({
      title: "Oldest unaccepted workflow start",
      description:
        "How long the longest-unacknowledged V2 start request has waited. A start is written before Temporal is called, so a climbing value means requests are being recorded and never accepted.",
      query: `max(scout_durable_backlog_oldest_age_seconds{family="unaccepted-workflow-starts",${DURABLE_FILTER}})`,
      legend: "age",
      gridPos: { x: 0, y: 14, w: 8, h: 4 },
      unit: "s",
      steps: [
        { value: null, color: "red" },
        { value: 0, color: "green" },
        { value: 900, color: "red" },
      ],
    }),
  );

  builder.withPanel(
    statPanel({
      title: "Oldest stranded match",
      description:
        "Age of the oldest V2-owned match whose pipeline never reached both of its finishing facts — the observation receipt and the cursor advance.",
      query: `max(scout_durable_backlog_oldest_age_seconds{family="stalled-match-processing",${DURABLE_FILTER}})`,
      legend: "age",
      gridPos: { x: 8, y: 14, w: 8, h: 4 },
      unit: "s",
      steps: [
        { value: null, color: "red" },
        { value: 0, color: "green" },
        { value: 3600, color: "orange" },
      ],
    }),
  );

  builder.withPanel(
    statPanel({
      title: "Oldest live recovery batch",
      description:
        "Age of the oldest recovery batch that has not reached `complete` or `abandoned`. A batch sitting in `scanning` since yesterday is the one an operator is waiting on.",
      query: `max(scout_durable_backlog_oldest_age_seconds{family="live-recovery-batches",${DURABLE_FILTER}})`,
      legend: "age",
      gridPos: { x: 16, y: 14, w: 8, h: 4 },
      unit: "s",
      steps: [
        { value: null, color: "red" },
        { value: 0, color: "green" },
        { value: 21_600, color: "orange" },
      ],
    }),
  );

  builder.withPanel(
    seriesPanel({
      title: "Notification intents by state",
      description:
        "One series per state of the intent machine. Drivable states (`pending`, `ready`, `sending`) growing while settled states do not is a stalled sender; everything arriving at `unknown-delivery` is a different failure entirely.",
      query: `max by (state) (scout_durable_notification_intents{${DURABLE_FILTER}})`,
      legend: "{{state}}",
      gridPos: { x: 0, y: 18, w: 12, h: 8 },
    }),
  );

  builder.withPanel(
    seriesPanel({
      title: "Recovery batches by state",
      description:
        "One series per state of the batch machine. `complete` and `abandoned` are terminal; the rest are batches whose driver may have died mid-flight.",
      query: `max by (state) (scout_durable_recovery_batches{${DURABLE_FILTER}})`,
      legend: "{{state}}",
      gridPos: { x: 12, y: 18, w: 12, h: 8 },
    }),
  );
}

function addLakeRows(builder: dashboard.DashboardBuilder): void {
  builder.withRow(
    new dashboard.RowBuilder("Report lake").gridPos({
      x: 0,
      y: 26,
      w: 24,
      h: 1,
    }),
  );

  builder.withPanel(
    seriesPanel({
      title: "Lake staging lag by artifact kind",
      description:
        "How long the longest-unprojected archived artifact has waited for its lake staging receipt. Measured per kind because the three fail independently — a match can be staged while its timeline is days behind, and one folded number would report that lake as healthy.",
      query: `max by (artifact_kind) (scout_durable_lake_staging_lag_seconds{${DURABLE_FILTER}})`,
      legend: "{{artifact_kind}}",
      gridPos: { x: 0, y: 27, w: 16, h: 8 },
      unit: "s",
    }),
  );

  builder.withPanel(
    statPanel({
      title: "Last lake publish",
      description:
        "When the lake's CURRENT pointer last moved. Staging lag answers what the lake owes; this answers whether it is publishing at all.",
      query: `time() - max(report_lake_last_publish_timestamp_seconds{${DURABLE_FILTER}})`,
      legend: "age",
      gridPos: { x: 16, y: 27, w: 8, h: 8 },
      unit: "s",
      steps: [
        { value: null, color: "green" },
        { value: 86_400, color: "orange" },
      ],
    }),
  );
}

export function createScoutDurableDashboard(): dashboard.Dashboard {
  const builder = new dashboard.DashboardBuilder(
    "Scout for LoL - Durable Pipeline",
  )
    .uid("scout-for-lol-durable")
    .tags(["scout", "durable", "temporal"])
    .time({ from: "now-6h", to: "now" })
    .refresh("1m")
    .timezone("browser")
    .editable();

  for (const variable of scoutDashboardVariables()) {
    builder.withVariable(variable);
  }

  addDuplicateRows(builder);
  addBacklogRows(builder);
  addLakeRows(builder);

  return builder.build();
}

export function exportScoutDurableDashboardJson(): string {
  return exportDashboardWithHelmEscaping(createScoutDurableDashboard());
}
