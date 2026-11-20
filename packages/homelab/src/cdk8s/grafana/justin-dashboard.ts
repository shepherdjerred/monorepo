import * as dashboard from "@grafana/grafana-foundation-sdk/dashboard";
import { exportDashboardWithHelmEscaping } from "./dashboard-export.ts";
import { createTimeseriesPanel } from "./shared/dashboard-panels.ts";

export function exportJustinDashboardJson(): string {
  const builder = new dashboard.DashboardBuilder("Justin")
    .uid("justin")
    .tags(["justin", "codex", "tracker"])
    .time({ from: "now-24h", to: "now" })
    .refresh("1m");
  const instance = 'instance="karpathy"';
  const panels = [
    {
      title: "Queue capacity",
      targets: [
        { query: `justin_queue_eligible{${instance}}`, legend: "eligible" },
        { query: `justin_open_pull_requests{${instance}}`, legend: "open PRs" },
      ],
    },
    {
      title: "Tasks by phase",
      targets: [
        {
          query: `justin_tasks{${instance},phase!="done"}`,
          legend: "{{phase}}",
        },
      ],
    },
    {
      title: "Oldest wait by phase",
      unit: "s",
      targets: [
        {
          query: `justin_oldest_wait_seconds{${instance},phase!="done"}`,
          legend: "{{phase}}",
        },
      ],
    },
    {
      title: "Task outcomes",
      targets: [
        {
          query: `increase(justin_task_transitions_total{${instance},phase="done"}[1h])`,
          legend: "completed",
        },
        {
          query: `increase(justin_passes_total{${instance}}[1h])`,
          legend: "pass · {{reason}}",
        },
      ],
    },
    {
      title: "Average stage duration",
      unit: "s",
      targets: [
        {
          query: `sum by (phase) (rate(justin_stage_elapsed_seconds_total{${instance}}[1h])) / sum by (phase) (rate(justin_stages_total{${instance}}[1h]))`,
          legend: "{{phase}}",
        },
      ],
    },
    {
      title: "Stage failures",
      targets: [
        {
          query: `increase(justin_stages_total{${instance},outcome="failure"}[1h])`,
          legend: "{{phase}}",
        },
      ],
    },
    {
      title: "Reconcile freshness",
      unit: "s",
      targets: [
        {
          query: `time() - last_over_time(justin_reconcile_last_started_timestamp_seconds{${instance}}[4h])`,
          legend: "since last start",
        },
        {
          query: `time() - last_over_time(justin_reconcile_last_success_timestamp_seconds{${instance}}[4h]) > 0 and last_over_time(justin_reconcile_last_success_timestamp_seconds{${instance}}[4h]) > 0`,
          legend: "since last success",
        },
      ],
    },
    {
      title: "Codex tokens",
      targets: [
        {
          query: `increase(justin_codex_tokens_total{${instance}}[1h])`,
          legend: "{{kind}}",
        },
      ],
    },
  ];
  for (const [index, panel] of panels.entries()) {
    builder.withPanel(
      createTimeseriesPanel({
        ...panel,
        gridPos: {
          x: (index % 2) * 12,
          y: Math.floor(index / 2) * 8,
          w: 12,
          h: 8,
        },
      }),
    );
  }
  return exportDashboardWithHelmEscaping(builder.build());
}
