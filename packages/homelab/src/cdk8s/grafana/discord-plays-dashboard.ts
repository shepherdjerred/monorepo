import * as dashboard from "@grafana/grafana-foundation-sdk/dashboard";
import * as timeseries from "@grafana/grafana-foundation-sdk/timeseries";
import * as prometheus from "@grafana/grafana-foundation-sdk/prometheus";
import { exportDashboardWithHelmEscaping } from "./dashboard-export.ts";

/**
 * Stream-health dashboard for the discord-plays bots (pokemon + mario-kart).
 * Both expose the same `emulator_*` / `stream_*` instruments (see each backend's
 * observability/metrics.ts), distinguished by the `namespace` label. The panels
 * are built to tell apart the candidate causes of choppy video:
 *   - achieved fps below target / high emulate_ms ⇒ emulation-bound
 *   - rising sink-buffer bytes ⇒ encode/send-bound
 *   - event-loop lag ⇒ the single JS thread is saturated
 */
export function createDiscordPlaysDashboard() {
  const prometheusDatasource = {
    type: "prometheus",
    uid: "Prometheus",
  };

  // All series are scoped to the two bot namespaces.
  const SCOPE = `namespace=~"pokemon|mario-kart"`;

  const timeSeriesPanel = (options: {
    title: string;
    description?: string;
    targets: { expr: string; legend: string }[];
    gridPos: { x: number; y: number; w: number; h: number };
    unit?: string;
  }) => {
    let panel = new timeseries.PanelBuilder()
      .title(options.title)
      .datasource(prometheusDatasource)
      .unit(options.unit ?? "short")
      .gridPos(options.gridPos);
    if (options.description !== undefined) {
      panel = panel.description(options.description);
    }
    for (const t of options.targets) {
      panel = panel.withTarget(
        new prometheus.DataqueryBuilder().expr(t.expr).legendFormat(t.legend),
      );
    }
    return panel;
  };

  const builder = new dashboard.DashboardBuilder(
    "Discord Plays — Stream Health",
  )
    .uid("discord-plays-stream-health")
    .tags(["discord-plays", "pokemon", "mario-kart", "stream"])
    .time({ from: "now-3h", to: "now" })
    .refresh("30s")
    .timezone("browser")
    .editable();

  builder.withRow(new dashboard.RowBuilder("Frame pacing"));

  builder.withPanel(
    timeSeriesPanel({
      title: "Achieved frame rate (ticks/s)",
      description:
        "rate of emulator ticks. Compare to the target (pokemon ~59.7, mario-kart 30). Dropping below target ⇒ the emulate+copy loop can't keep up.",
      targets: [
        {
          expr: `sum(rate(emulator_ticks_total{${SCOPE}}[1m])) by (namespace)`,
          legend: "{{namespace}}",
        },
      ],
      gridPos: { x: 0, y: 1, w: 12, h: 8 },
      unit: "hertz",
    }),
  );

  builder.withPanel(
    timeSeriesPanel({
      title: "Loop resyncs (drops/s)",
      description:
        "Rate of paced-loop resyncs — the loop fell far enough behind that frames were dropped.",
      targets: [
        {
          expr: `sum(rate(emulator_loop_resync_total{${SCOPE}}[5m])) by (namespace)`,
          legend: "{{namespace}}",
        },
      ],
      gridPos: { x: 12, y: 1, w: 12, h: 8 },
      unit: "short",
    }),
  );

  builder.withPanel(
    timeSeriesPanel({
      title: "Loop lateness p95 (ms behind schedule)",
      targets: [
        {
          expr: `histogram_quantile(0.95, sum(rate(emulator_frame_late_ms_bucket{${SCOPE}}[5m])) by (le, namespace))`,
          legend: "{{namespace}}",
        },
      ],
      gridPos: { x: 0, y: 9, w: 24, h: 7 },
      unit: "ms",
    }),
  );

  builder.withRow(new dashboard.RowBuilder("Per-frame cost"));

  builder.withPanel(
    timeSeriesPanel({
      title: "Emulate time p95 (ms/frame)",
      description:
        "Time to step the wasm core per frame. High values (vs the frame budget: ~16ms@60, 33ms@30) ⇒ emulation-bound; GPU encoding won't help this.",
      targets: [
        {
          expr: `histogram_quantile(0.95, sum(rate(emulator_frame_emulate_ms_bucket{${SCOPE}}[5m])) by (le, namespace))`,
          legend: "{{namespace}}",
        },
      ],
      gridPos: { x: 0, y: 17, w: 12, h: 8 },
      unit: "ms",
    }),
  );

  builder.withPanel(
    timeSeriesPanel({
      title: "Frame copy time p95 (ms/frame)",
      targets: [
        {
          expr: `histogram_quantile(0.95, sum(rate(emulator_frame_copy_ms_bucket{${SCOPE}}[5m])) by (le, namespace))`,
          legend: "{{namespace}}",
        },
      ],
      gridPos: { x: 12, y: 17, w: 12, h: 8 },
      unit: "ms",
    }),
  );

  builder.withRow(new dashboard.RowBuilder("Encode / send + saturation"));

  builder.withPanel(
    timeSeriesPanel({
      title: "Stream sink buffer (bytes)",
      description:
        "Bytes buffered in the PassThrough feeding ffmpeg. A sustained rise ⇒ the encoder/send path can't keep up (where VAAPI / lower bitrate helps).",
      targets: [
        {
          expr: `max(stream_sink_buffer_bytes{${SCOPE}}) by (namespace)`,
          legend: "{{namespace}}",
        },
      ],
      gridPos: { x: 0, y: 26, w: 12, h: 8 },
      unit: "bytes",
    }),
  );

  builder.withPanel(
    timeSeriesPanel({
      title: "Event-loop lag (s) & process CPU",
      description:
        "nodejs_eventloop_lag_seconds shows when the single JS thread saturates; process CPU is the bot's own usage.",
      targets: [
        {
          expr: `max(nodejs_eventloop_lag_seconds{${SCOPE}}) by (namespace)`,
          legend: "loop lag {{namespace}}",
        },
        {
          expr: `sum(rate(process_cpu_seconds_total{${SCOPE}}[5m])) by (namespace)`,
          legend: "cpu cores {{namespace}}",
        },
      ],
      gridPos: { x: 12, y: 26, w: 12, h: 8 },
      unit: "short",
    }),
  );

  builder.withPanel(
    timeSeriesPanel({
      title: "Broadcast active",
      targets: [
        {
          expr: `max(stream_active{${SCOPE}}) by (namespace)`,
          legend: "{{namespace}}",
        },
      ],
      gridPos: { x: 0, y: 34, w: 24, h: 5 },
      unit: "short",
    }),
  );

  return builder.build();
}

/** Exports the dashboard as JSON for the Grafana sidecar ConfigMap. */
export function exportDiscordPlaysDashboardJson(): string {
  return exportDashboardWithHelmEscaping(createDiscordPlaysDashboard());
}
