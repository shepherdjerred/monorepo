import * as dashboard from "@grafana/grafana-foundation-sdk/dashboard";
import * as timeseries from "@grafana/grafana-foundation-sdk/timeseries";
import * as stat from "@grafana/grafana-foundation-sdk/stat";
import * as common from "@grafana/grafana-foundation-sdk/common";
import * as prometheus from "@grafana/grafana-foundation-sdk/prometheus";
import { exportDashboardWithHelmEscaping } from "./dashboard-export.ts";

/**
 * Grafana dashboard for streambot (the Discord media streamer).
 *
 * Built after the 2026-06-07 stutter incident, which was undiagnosable because the realtime health
 * of the ffmpeg pipeline and the source's media properties were invisible. The headline panel is
 * `streambot_ffmpeg_speed_ratio`: a sustained value below 1.0 means the transcode cannot keep up
 * with realtime and playback will stutter once the startup buffer drains.
 *
 * Rows:
 *   1. Realtime health — ffmpeg speed ratio, fps, bitrate, event-loop lag
 *   2. Send path — frametime ratio p95, late-frame rate
 *   3. Pipeline — hw-decode engaged, stream active, hw->sw fallbacks, segment duration
 *   4. Source — current media properties (codec/resolution/HDR/audio)
 *   5. Process — CPU, memory, restarts
 */

// Strip per-pod labels so a single logical series survives pod restarts.
const STRIP = "without(pod, instance, container, endpoint)";

export function createStreambotDashboard() {
  const prometheusDatasource = { type: "prometheus", uid: "Prometheus" };

  const builder = new dashboard.DashboardBuilder("Streambot")
    .uid("streambot")
    .tags(["streambot", "media", "discord", "ffmpeg"])
    .time({ from: "now-3h", to: "now" })
    .refresh("30s")
    .timezone("browser")
    .editable();

  // -------------------------------------------------------------------------
  // Row 1 — Realtime health
  // -------------------------------------------------------------------------
  builder.withRow(new dashboard.RowBuilder("Realtime health"));

  builder.withPanel(
    new timeseries.PanelBuilder()
      .title("ffmpeg speed ratio (realtime)")
      .description(
        "Media seconds produced per wall-clock second. Sustained < 1.0 = the transcode is slower than realtime and playback will stutter once the buffer drains. The single most important panel.",
      )
      .datasource(prometheusDatasource)
      .withTarget(
        new prometheus.DataqueryBuilder()
          .expr(`max ${STRIP} (streambot_ffmpeg_speed_ratio)`)
          .legendFormat("{{hardware}}"),
      )
      .unit("none")
      .decimals(2)
      .lineWidth(2)
      .fillOpacity(10)
      .thresholds(
        new dashboard.ThresholdsConfigBuilder()
          .mode(dashboard.ThresholdsMode.Absolute)
          .steps([
            { value: 0, color: "red" },
            { value: 1, color: "green" },
          ]),
      )
      .gridPos({ x: 0, y: 1, w: 12, h: 8 }),
  );

  builder.withPanel(
    new timeseries.PanelBuilder()
      .title("ffmpeg output fps")
      .description(
        "ffmpeg current output frames per second. Should track the target stream fps (30). Dipping below = the pipeline is behind.",
      )
      .datasource(prometheusDatasource)
      .withTarget(
        new prometheus.DataqueryBuilder()
          .expr(`max ${STRIP} (streambot_ffmpeg_fps)`)
          .legendFormat("{{hardware}}"),
      )
      .unit("none")
      .lineWidth(2)
      .fillOpacity(10)
      .gridPos({ x: 12, y: 1, w: 6, h: 8 }),
  );

  builder.withPanel(
    new timeseries.PanelBuilder()
      .title("Event loop lag (p99)")
      .description(
        "p99 Node/Bun event-loop lag. Spikes here stall the realtime send path and cause stutter independent of ffmpeg throughput.",
      )
      .datasource(prometheusDatasource)
      .withTarget(
        new prometheus.DataqueryBuilder()
          .expr(`max ${STRIP} (streambot_nodejs_eventloop_lag_p99_seconds)`)
          .legendFormat("p99 lag"),
      )
      .unit("s")
      .decimals(3)
      .lineWidth(2)
      .fillOpacity(10)
      .gridPos({ x: 18, y: 1, w: 6, h: 8 }),
  );

  // -------------------------------------------------------------------------
  // Row 2 — Send path
  // -------------------------------------------------------------------------
  builder.withRow(new dashboard.RowBuilder("Send path"));

  builder.withPanel(
    new timeseries.PanelBuilder()
      .title("Send frametime ratio (p95)")
      .description(
        "p95 fraction of a frame's wall-clock budget consumed by the Discord send path, by kind. > 1.0 means the send path (not ffmpeg) is the bottleneck.",
      )
      .datasource(prometheusDatasource)
      .withTarget(
        new prometheus.DataqueryBuilder()
          .expr(
            "histogram_quantile(0.95, sum by (kind, le) (rate(streambot_send_frametime_ratio_bucket[5m]))) or on() vector(0)",
          )
          .legendFormat("{{kind}}"),
      )
      .unit("none")
      .decimals(2)
      .lineWidth(2)
      .fillOpacity(10)
      .thresholds(
        new dashboard.ThresholdsConfigBuilder()
          .mode(dashboard.ThresholdsMode.Absolute)
          .steps([
            { value: 0, color: "green" },
            { value: 1, color: "red" },
          ]),
      )
      .gridPos({ x: 0, y: 10, w: 12, h: 8 }),
  );

  builder.withPanel(
    new timeseries.PanelBuilder()
      .title("Late frames / sec")
      .description(
        "Rate of frames whose send exceeded their frametime budget (ratio > 1), by kind.",
      )
      .datasource(prometheusDatasource)
      .withTarget(
        new prometheus.DataqueryBuilder()
          .expr(
            `sum ${STRIP} (rate(streambot_send_late_frames_total[5m])) or on() vector(0)`,
          )
          .legendFormat("{{kind}}"),
      )
      .unit("none")
      .lineWidth(2)
      .fillOpacity(10)
      .gridPos({ x: 12, y: 10, w: 12, h: 8 }),
  );

  // -------------------------------------------------------------------------
  // Row 3 — Pipeline
  // -------------------------------------------------------------------------
  builder.withRow(new dashboard.RowBuilder("Pipeline"));

  builder.withPanel(
    new stat.PanelBuilder()
      .title("Hardware decode engaged")
      .description(
        "Whether the active ffmpeg command applied the VAAPI hardware-decode pipeline (1) or fell back to software (0).",
      )
      .datasource(prometheusDatasource)
      .withTarget(
        new prometheus.DataqueryBuilder()
          .expr(`max ${STRIP} (streambot_hw_decode_engaged)`)
          .legendFormat("hw decode"),
      )
      .unit("bool")
      .colorMode(common.BigValueColorMode.Background)
      .gridPos({ x: 0, y: 19, w: 6, h: 4 }),
  );

  builder.withPanel(
    new stat.PanelBuilder()
      .title("Stream active")
      .description("Whether a segment is currently playing (1) or idle (0).")
      .datasource(prometheusDatasource)
      .withTarget(
        new prometheus.DataqueryBuilder()
          .expr(`max ${STRIP} (streambot_stream_active)`)
          .legendFormat("active"),
      )
      .unit("bool")
      .colorMode(common.BigValueColorMode.Background)
      .gridPos({ x: 6, y: 19, w: 6, h: 4 }),
  );

  builder.withPanel(
    new timeseries.PanelBuilder()
      .title("HW->SW fallbacks / hour")
      .description(
        "Rate of hardware->software encode fallbacks. Any sustained non-zero value means the GPU path is failing and the bot is burning CPU on software encode.",
      )
      .datasource(prometheusDatasource)
      .withTarget(
        new prometheus.DataqueryBuilder()
          .expr(
            `sum ${STRIP} (rate(streambot_hw_fallback_total[1h])) * 3600 or on() vector(0)`,
          )
          .legendFormat("fallbacks/h"),
      )
      .unit("none")
      .lineWidth(2)
      .fillOpacity(10)
      .gridPos({ x: 12, y: 19, w: 12, h: 4 }),
  );

  builder.withPanel(
    new timeseries.PanelBuilder()
      .title("Segment duration (p50 / p95)")
      .description("Wall-clock duration of stream segments over a 6h window.")
      .datasource(prometheusDatasource)
      .withTarget(
        new prometheus.DataqueryBuilder()
          .expr(
            "histogram_quantile(0.5, sum by (le) (rate(streambot_stream_segment_duration_seconds_bucket[6h]))) or on() vector(0)",
          )
          .legendFormat("p50"),
      )
      .withTarget(
        new prometheus.DataqueryBuilder()
          .expr(
            "histogram_quantile(0.95, sum by (le) (rate(streambot_stream_segment_duration_seconds_bucket[6h]))) or on() vector(0)",
          )
          .legendFormat("p95"),
      )
      .unit("s")
      .lineWidth(2)
      .fillOpacity(0)
      .gridPos({ x: 0, y: 23, w: 24, h: 7 }),
  );

  // -------------------------------------------------------------------------
  // Row 4 — Source
  // -------------------------------------------------------------------------
  builder.withRow(new dashboard.RowBuilder("Source"));

  builder.withPanel(
    new stat.PanelBuilder()
      .title("Current source")
      .description(
        "Media properties of the currently-playing source (from ffprobe). A 2160p HEVC source with a lossless audio codec is the expensive-to-transcode case.",
      )
      .datasource(prometheusDatasource)
      .withTarget(
        new prometheus.DataqueryBuilder()
          .expr(
            "max by (resolution, video_codec, audio_codec, hdr) (streambot_source_info)",
          )
          .legendFormat(
            "{{resolution}} · {{video_codec}} · {{audio_codec}} · hdr={{hdr}}",
          ),
      )
      .unit("none")
      .colorMode(common.BigValueColorMode.Value)
      .textMode(common.BigValueTextMode.Name)
      .gridPos({ x: 0, y: 31, w: 24, h: 4 }),
  );

  // -------------------------------------------------------------------------
  // Row 5 — Process
  // -------------------------------------------------------------------------
  builder.withRow(new dashboard.RowBuilder("Process"));

  builder.withPanel(
    new timeseries.PanelBuilder()
      .title("CPU cores")
      .description("Process CPU usage in cores (rate of cpu seconds).")
      .datasource(prometheusDatasource)
      .withTarget(
        new prometheus.DataqueryBuilder()
          .expr(`sum ${STRIP} (rate(streambot_process_cpu_seconds_total[5m]))`)
          .legendFormat("cpu cores"),
      )
      .unit("none")
      .decimals(2)
      .lineWidth(2)
      .fillOpacity(10)
      .gridPos({ x: 0, y: 36, w: 8, h: 7 }),
  );

  builder.withPanel(
    new timeseries.PanelBuilder()
      .title("Resident memory")
      .description("Process resident set size.")
      .datasource(prometheusDatasource)
      .withTarget(
        new prometheus.DataqueryBuilder()
          .expr(`max ${STRIP} (streambot_process_resident_memory_bytes)`)
          .legendFormat("rss"),
      )
      .unit("bytes")
      .lineWidth(2)
      .fillOpacity(10)
      .gridPos({ x: 8, y: 36, w: 8, h: 7 }),
  );

  builder.withPanel(
    new timeseries.PanelBuilder()
      .title("Container restarts")
      .description(
        "Restart count for the streambot container (from kube-state-metrics). A climbing value means a crash loop (e.g. the OOMKills that started this whole investigation).",
      )
      .datasource(prometheusDatasource)
      .withTarget(
        new prometheus.DataqueryBuilder()
          .expr(
            'max by (pod) (kube_pod_container_status_restarts_total{namespace="media", container="streambot"})',
          )
          .legendFormat("{{pod}}"),
      )
      .unit("none")
      .lineWidth(2)
      .fillOpacity(10)
      .gridPos({ x: 16, y: 36, w: 8, h: 7 }),
  );

  return builder.build();
}

export function exportStreambotDashboardJson(): string {
  return exportDashboardWithHelmEscaping(createStreambotDashboard());
}
