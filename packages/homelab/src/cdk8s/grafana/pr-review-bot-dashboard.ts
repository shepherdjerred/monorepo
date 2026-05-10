import * as dashboard from "@grafana/grafana-foundation-sdk/dashboard";
import * as common from "@grafana/grafana-foundation-sdk/common";
import * as timeseries from "@grafana/grafana-foundation-sdk/timeseries";
import * as stat from "@grafana/grafana-foundation-sdk/stat";
import * as prometheus from "@grafana/grafana-foundation-sdk/prometheus";
import { exportDashboardWithHelmEscaping } from "./dashboard-export.ts";

/**
 * Grafana dashboard for the SOTA pr-review bot.
 *
 * Source plan: `packages/docs/plans/2026-05-10_sota-pr-review-bot.md` (Phase 8).
 *
 * Panels:
 *   1. Throughput — runs/hour by status (posted, skipped, failed)
 *   2. Latency — p50 / p95 / max trailing 1h
 *   3. Cost — daily $ per PR (p50/p95) + per-model breakdown
 *   4. Quality — FPR trend (7d) and recent failures
 *   5. Drop rates — consensus / verification / dedupe (most-recent-run gauges)
 *   6. Comments per PR — histogram heatmap-friendly view
 */
export function createPrReviewBotDashboard() {
  const prometheusDatasource = {
    type: "prometheus",
    uid: "Prometheus",
  };

  const repoVariable = new dashboard.QueryVariableBuilder("repo")
    .label("Repo")
    .query("label_values(pr_review_count_total, repo)")
    .datasource(prometheusDatasource)
    .multi(true)
    .includeAll(true)
    .allValue(".*");

  const builder = new dashboard.DashboardBuilder("PR Review Bot — Pipeline")
    .uid("pr-review-bot")
    .tags(["pr-review-bot", "temporal", "ai", "code-review"])
    .time({ from: "now-24h", to: "now" })
    .refresh("30s")
    .timezone("browser")
    .editable()
    .withVariable(repoVariable);

  // -------------------------------------------------------------------------
  // Row 1 — Overview Stats
  // -------------------------------------------------------------------------
  builder.withRow(new dashboard.RowBuilder("Overview"));

  const repoFilter = 'repo=~"$repo"';

  builder.withPanel(
    new stat.PanelBuilder()
      .title("Runs (24h)")
      .description(
        "Total pipeline runs in the trailing 24h, by terminal status.",
      )
      .datasource(prometheusDatasource)
      .withTarget(
        new prometheus.DataqueryBuilder()
          .expr(
            `sum without(pod, instance, container, endpoint) (increase(pr_review_count_total{${repoFilter}}[24h]))`,
          )
          .legendFormat("{{status}}"),
      )
      .unit("short")
      .colorMode(common.BigValueColorMode.Value)
      .graphMode(common.BigValueGraphMode.Area)
      .gridPos({ x: 0, y: 1, w: 6, h: 4 }),
  );

  builder.withPanel(
    new stat.PanelBuilder()
      .title("Posted (24h)")
      .description("Comments successfully posted in the trailing 24h.")
      .datasource(prometheusDatasource)
      .withTarget(
        new prometheus.DataqueryBuilder()
          .expr(
            `sum without(pod, instance, container, endpoint, repo, status) (increase(pr_review_count_total{${repoFilter}, status="posted"}[24h]))`,
          )
          .legendFormat("posted"),
      )
      .unit("short")
      .colorMode(common.BigValueColorMode.Value)
      .gridPos({ x: 6, y: 1, w: 6, h: 4 }),
  );

  builder.withPanel(
    new stat.PanelBuilder()
      .title("Estimated FPR (current)")
      .description(
        "Estimated false-positive rate from author thumbs-down reactions over the trailing 24h. Alerts page at >15% sustained 1h.",
      )
      .datasource(prometheusDatasource)
      .withTarget(
        new prometheus.DataqueryBuilder()
          .expr(
            "max without(pod, instance, container, endpoint) (pr_review_fpr_estimated)",
          )
          .legendFormat("FPR"),
      )
      .unit("percentunit")
      .decimals(1)
      .gridPos({ x: 12, y: 1, w: 6, h: 4 })
      .thresholds(
        new dashboard.ThresholdsConfigBuilder()
          .mode(dashboard.ThresholdsMode.Absolute)
          .steps([
            { value: 0, color: "green" },
            { value: 0.1, color: "yellow" },
            { value: 0.15, color: "red" },
          ]),
      ),
  );

  builder.withPanel(
    new stat.PanelBuilder()
      .title("p95 Latency (1h)")
      .description(
        "End-to-end p95 latency over the trailing 1h. Alert pages at >480s sustained 15m.",
      )
      .datasource(prometheusDatasource)
      .withTarget(
        new prometheus.DataqueryBuilder()
          .expr(
            "histogram_quantile(0.95, sum without(pod, instance, container, endpoint) (rate(pr_review_latency_seconds_bucket[1h])))",
          )
          .legendFormat("p95"),
      )
      .unit("s")
      .decimals(1)
      .gridPos({ x: 18, y: 1, w: 6, h: 4 })
      .thresholds(
        new dashboard.ThresholdsConfigBuilder()
          .mode(dashboard.ThresholdsMode.Absolute)
          .steps([
            { value: 0, color: "green" },
            { value: 240, color: "yellow" },
            { value: 480, color: "red" },
          ]),
      ),
  );

  // -------------------------------------------------------------------------
  // Row 2 — Throughput
  // -------------------------------------------------------------------------
  builder.withRow(new dashboard.RowBuilder("Throughput"));

  builder.withPanel(
    new timeseries.PanelBuilder()
      .title("Runs by status")
      .description("Pipeline runs/hour, grouped by terminal status.")
      .datasource(prometheusDatasource)
      .withTarget(
        new prometheus.DataqueryBuilder()
          .expr(
            `sum without(pod, instance, container, endpoint, repo) (rate(pr_review_count_total{${repoFilter}}[1h])) * 3600`,
          )
          .legendFormat("{{status}}"),
      )
      .unit("short")
      .lineWidth(2)
      .fillOpacity(20)
      .gridPos({ x: 0, y: 9, w: 24, h: 8 }),
  );

  // -------------------------------------------------------------------------
  // Row 3 — Latency
  // -------------------------------------------------------------------------
  builder.withRow(new dashboard.RowBuilder("Latency"));

  builder.withPanel(
    new timeseries.PanelBuilder()
      .title("p50 / p95 / p99 latency")
      .description(
        "Pipeline latency percentiles over a 1h rolling window. Target: p95 ≤ 480s (8 min).",
      )
      .datasource(prometheusDatasource)
      .withTarget(
        new prometheus.DataqueryBuilder()
          .expr(
            "histogram_quantile(0.5, sum without(pod, instance, container, endpoint) (rate(pr_review_latency_seconds_bucket[1h])))",
          )
          .legendFormat("p50"),
      )
      .withTarget(
        new prometheus.DataqueryBuilder()
          .expr(
            "histogram_quantile(0.95, sum without(pod, instance, container, endpoint) (rate(pr_review_latency_seconds_bucket[1h])))",
          )
          .legendFormat("p95"),
      )
      .withTarget(
        new prometheus.DataqueryBuilder()
          .expr(
            "histogram_quantile(0.99, sum without(pod, instance, container, endpoint) (rate(pr_review_latency_seconds_bucket[1h])))",
          )
          .legendFormat("p99"),
      )
      .unit("s")
      .lineWidth(2)
      .fillOpacity(0)
      .gridPos({ x: 0, y: 17, w: 24, h: 8 }),
  );

  // -------------------------------------------------------------------------
  // Row 4 — Cost
  // -------------------------------------------------------------------------
  builder.withRow(new dashboard.RowBuilder("Cost"));

  builder.withPanel(
    new timeseries.PanelBuilder()
      .title("Cost per PR by model (p50/24h)")
      .description(
        "Median cost per PR over the trailing 24h, broken out by model. Alert fires if total p50 exceeds $5 sustained 24h.",
      )
      .datasource(prometheusDatasource)
      .withTarget(
        new prometheus.DataqueryBuilder()
          .expr(
            "histogram_quantile(0.5, sum without(pod, instance, container, endpoint) by (model, le) (rate(pr_review_cost_usd_bucket[24h])))",
          )
          .legendFormat("{{model}}"),
      )
      .unit("currencyUSD")
      .decimals(2)
      .lineWidth(2)
      .fillOpacity(20)
      .gridPos({ x: 0, y: 25, w: 12, h: 8 }),
  );

  builder.withPanel(
    new timeseries.PanelBuilder()
      .title("Total cost p50 / p95 (24h)")
      .description("Aggregate cost per PR across all models.")
      .datasource(prometheusDatasource)
      .withTarget(
        new prometheus.DataqueryBuilder()
          .expr(
            "histogram_quantile(0.5, sum without(pod, instance, container, endpoint, model) (rate(pr_review_cost_usd_bucket[24h])))",
          )
          .legendFormat("p50"),
      )
      .withTarget(
        new prometheus.DataqueryBuilder()
          .expr(
            "histogram_quantile(0.95, sum without(pod, instance, container, endpoint, model) (rate(pr_review_cost_usd_bucket[24h])))",
          )
          .legendFormat("p95"),
      )
      .unit("currencyUSD")
      .decimals(2)
      .lineWidth(2)
      .fillOpacity(0)
      .thresholds(
        new dashboard.ThresholdsConfigBuilder()
          .mode(dashboard.ThresholdsMode.Absolute)
          .steps([
            { value: 0, color: "green" },
            { value: 3, color: "yellow" },
            { value: 5, color: "red" },
          ]),
      )
      .gridPos({ x: 12, y: 25, w: 12, h: 8 }),
  );

  // -------------------------------------------------------------------------
  // Row 5 — Quality
  // -------------------------------------------------------------------------
  builder.withRow(new dashboard.RowBuilder("Quality"));

  builder.withPanel(
    new timeseries.PanelBuilder()
      .title("FPR trend (7d)")
      .description(
        "Estimated false-positive rate (thumbs-down / posted) over a 7-day rolling view.",
      )
      .datasource(prometheusDatasource)
      .withTarget(
        new prometheus.DataqueryBuilder()
          .expr(
            "max without(pod, instance, container, endpoint) (pr_review_fpr_estimated)",
          )
          .legendFormat("FPR"),
      )
      .unit("percentunit")
      .decimals(2)
      .lineWidth(2)
      .fillOpacity(20)
      .thresholds(
        new dashboard.ThresholdsConfigBuilder()
          .mode(dashboard.ThresholdsMode.Absolute)
          .steps([
            { value: 0, color: "green" },
            { value: 0.1, color: "yellow" },
            { value: 0.15, color: "red" },
          ]),
      )
      .gridPos({ x: 0, y: 33, w: 12, h: 8 }),
  );

  builder.withPanel(
    new timeseries.PanelBuilder()
      .title("Failure rate (1h)")
      .description(
        "Fraction of pipeline runs ending in failure over a 1h window.",
      )
      .datasource(prometheusDatasource)
      .withTarget(
        new prometheus.DataqueryBuilder()
          .expr(
            `(
              sum without(pod, instance, container, endpoint, repo) (rate(pr_review_count_total{${repoFilter}, status="failed"}[1h]))
              /
              sum without(pod, instance, container, endpoint, repo, status) (rate(pr_review_count_total{${repoFilter}}[1h]))
            )`,
          )
          .legendFormat("failure rate"),
      )
      .unit("percentunit")
      .decimals(2)
      .lineWidth(2)
      .fillOpacity(20)
      .thresholds(
        new dashboard.ThresholdsConfigBuilder()
          .mode(dashboard.ThresholdsMode.Absolute)
          .steps([
            { value: 0, color: "green" },
            { value: 0.1, color: "yellow" },
            { value: 0.25, color: "red" },
          ]),
      )
      .gridPos({ x: 12, y: 33, w: 12, h: 8 }),
  );

  // -------------------------------------------------------------------------
  // Row 6 — Drop rates (per-stage filtering)
  // -------------------------------------------------------------------------
  builder.withRow(new dashboard.RowBuilder("Drop rates"));

  builder.withPanel(
    new timeseries.PanelBuilder()
      .title("Drop rate by stage (most recent run)")
      .description(
        "Fraction of findings dropped at each pipeline stage on the most recent run. High consensus drop = noisy specialists; high verification drop = many fabricated claims; high dedupe drop = author has dismissed many similar comments.",
      )
      .datasource(prometheusDatasource)
      .withTarget(
        new prometheus.DataqueryBuilder()
          .expr(
            "max without(pod, instance, container, endpoint) (pr_review_consensus_drop_rate)",
          )
          .legendFormat("consensus"),
      )
      .withTarget(
        new prometheus.DataqueryBuilder()
          .expr(
            "max without(pod, instance, container, endpoint) (pr_review_verification_drop_rate)",
          )
          .legendFormat("verification"),
      )
      .withTarget(
        new prometheus.DataqueryBuilder()
          .expr(
            "max without(pod, instance, container, endpoint) (pr_review_dedupe_drop_rate)",
          )
          .legendFormat("dedupe"),
      )
      .unit("percentunit")
      .decimals(2)
      .lineWidth(2)
      .fillOpacity(0)
      .gridPos({ x: 0, y: 41, w: 24, h: 8 }),
  );

  // -------------------------------------------------------------------------
  // Row 7 — Comments per PR
  // -------------------------------------------------------------------------
  builder.withRow(new dashboard.RowBuilder("Comments per PR"));

  builder.withPanel(
    new timeseries.PanelBuilder()
      .title("Comments per PR (p50/p95)")
      .description(
        "Distribution of comment count per posted review. Spikes suggest either a regression in dedupe or a particularly bug-dense PR.",
      )
      .datasource(prometheusDatasource)
      .withTarget(
        new prometheus.DataqueryBuilder()
          .expr(
            "histogram_quantile(0.5, sum without(pod, instance, container, endpoint) (rate(pr_review_comments_per_pr_bucket[6h])))",
          )
          .legendFormat("p50"),
      )
      .withTarget(
        new prometheus.DataqueryBuilder()
          .expr(
            "histogram_quantile(0.95, sum without(pod, instance, container, endpoint) (rate(pr_review_comments_per_pr_bucket[6h])))",
          )
          .legendFormat("p95"),
      )
      .unit("short")
      .decimals(0)
      .lineWidth(2)
      .fillOpacity(0)
      .gridPos({ x: 0, y: 49, w: 24, h: 8 }),
  );

  return builder.build();
}

export function exportPrReviewBotDashboardJson(): string {
  return exportDashboardWithHelmEscaping(createPrReviewBotDashboard());
}
