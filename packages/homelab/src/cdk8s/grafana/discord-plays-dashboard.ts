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

  // Latency attribution rows (mario-kart emits these as of PR #1128; pokemon
  // panels stay empty until it grows the same instruments).
  builder.withRow(new dashboard.RowBuilder("Input path latency"));

  builder.withPanel(
    timeSeriesPanel({
      title: "Input apply delay p95 (ms)",
      description:
        "Controller input arriving at the backend → latched into the emulator tick that applies it. Expected ≲ one frame budget (33ms@30fps); sustained higher ⇒ the tick loop is starved.",
      targets: [
        {
          expr: `histogram_quantile(0.95, sum(rate(emulator_input_apply_delay_ms_bucket{${SCOPE}}[5m])) by (le, namespace))`,
          legend: "{{namespace}}",
        },
      ],
      gridPos: { x: 0, y: 40, w: 12, h: 8 },
      unit: "ms",
    }),
  );

  builder.withPanel(
    timeSeriesPanel({
      title: "Controller RTT (ms)",
      description:
        "Socket round trip measured by the web controller itself (reported every 2s per connected client). One-way controller→backend ≈ RTT/2.",
      targets: [
        {
          expr: `histogram_quantile(0.5, sum(rate(controller_rtt_ms_bucket{${SCOPE}}[5m])) by (le, namespace))`,
          legend: "p50 {{namespace}}",
        },
        {
          expr: `histogram_quantile(0.95, sum(rate(controller_rtt_ms_bucket{${SCOPE}}[5m])) by (le, namespace))`,
          legend: "p95 {{namespace}}",
        },
      ],
      gridPos: { x: 12, y: 40, w: 12, h: 8 },
      unit: "ms",
    }),
  );

  builder.withRow(new dashboard.RowBuilder("Encoder / RTP send health"));

  builder.withPanel(
    timeSeriesPanel({
      title: "ffmpeg speed ratio",
      description:
        "Media seconds encoded per wall-clock second (from timemark advance). Sustained <1 ⇒ the encoder can't keep realtime and latency builds.",
      targets: [
        {
          expr: `max(stream_ffmpeg_speed_ratio{${SCOPE}}) by (namespace)`,
          legend: "{{namespace}}",
        },
      ],
      gridPos: { x: 0, y: 49, w: 8, h: 8 },
      unit: "short",
    }),
  );

  builder.withPanel(
    timeSeriesPanel({
      title: "ffmpeg output fps / bitrate",
      targets: [
        {
          expr: `max(stream_ffmpeg_fps{${SCOPE}}) by (namespace)`,
          legend: "fps {{namespace}}",
        },
        {
          expr: `max(stream_ffmpeg_bitrate_kbps{${SCOPE}}) by (namespace)`,
          legend: "kbps {{namespace}}",
        },
      ],
      gridPos: { x: 8, y: 49, w: 8, h: 8 },
      unit: "short",
    }),
  );

  builder.withPanel(
    timeSeriesPanel({
      title: "RTP send frametime ratio p95",
      description:
        "Fraction of each frame's wall-clock budget spent sending it to Discord; >1 means the frame was sent late.",
      targets: [
        {
          expr: `histogram_quantile(0.95, sum(rate(stream_send_frametime_ratio_bucket{${SCOPE}}[5m])) by (le, namespace))`,
          legend: "{{namespace}}",
        },
      ],
      gridPos: { x: 16, y: 49, w: 8, h: 8 },
      unit: "short",
    }),
  );

  builder.withPanel(
    timeSeriesPanel({
      title: "Late RTP sends (frames/s)",
      targets: [
        {
          expr: `sum(rate(stream_send_late_frames_total{${SCOPE}}[5m])) by (namespace)`,
          legend: "{{namespace}}",
        },
      ],
      gridPos: { x: 0, y: 57, w: 12, h: 7 },
      unit: "short",
    }),
  );

  builder.withPanel(
    timeSeriesPanel({
      title: "Frame push interval & write p95 (ms)",
      description:
        "Cadence of frames handed to ffmpeg (should sit at the frame budget) and the pipe-write duration (rises with encoder backpressure).",
      targets: [
        {
          expr: `histogram_quantile(0.95, sum(rate(stream_frame_interval_ms_bucket{${SCOPE}}[5m])) by (le, namespace))`,
          legend: "interval {{namespace}}",
        },
        {
          expr: `histogram_quantile(0.95, sum(rate(stream_frame_write_ms_bucket{${SCOPE}}[5m])) by (le, namespace))`,
          legend: "write {{namespace}}",
        },
      ],
      gridPos: { x: 12, y: 57, w: 12, h: 7 },
      unit: "ms",
    }),
  );

  return builder.build();
}

/** Exports the dashboard as JSON for the Grafana sidecar ConfigMap. */
export function exportDiscordPlaysDashboardJson(): string {
  return exportDashboardWithHelmEscaping(createDiscordPlaysDashboard());
}
