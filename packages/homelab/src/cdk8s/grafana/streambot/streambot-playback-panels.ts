import * as dashboard from "@grafana/grafana-foundation-sdk/dashboard";
import * as timeseries from "@grafana/grafana-foundation-sdk/timeseries";
import * as prometheus from "@grafana/grafana-foundation-sdk/prometheus";

export function addPlaybackDiagnosticPanels(
  builder: dashboard.DashboardBuilder,
): void {
  const datasource = { type: "prometheus", uid: "Prometheus" };
  builder.withRow(new dashboard.RowBuilder("Playback timing diagnostics"));

  for (const [index, panel] of [
    {
      title: "Sender frame intervals (p99 / p99.9)",
      metric: "streambot_send_interval_seconds",
      description:
        "Time between actual submissions to the native transport, excluding startup bursts. Histogram tails retain short sender gaps between 30s scrapes. Native pacing, network delivery and viewer rendering happen later.",
    },
    {
      title: "Sender source idle (p99 / p99.9)",
      metric: "streambot_source_idle_seconds",
      description:
        "Time the paced sender was ready but had no next encoded packet, excluding startup bursts. Correlate with demux cadence, queues and ffmpeg progress to investigate upstream starvation.",
    },
    {
      title: "Sender lateness (p99 / p99.9)",
      metric: "streambot_send_lateness_seconds",
      description:
        "Per-frame sender schedule lag, excluding startup bursts. Cumulative histogram buckets preserve excursions after the instantaneous gauge recovers; these are sender measurements, not viewer buffering statistics.",
    },
  ].entries()) {
    const timeseriesPanel = new timeseries.PanelBuilder()
      .title(panel.title)
      .description(panel.description)
      .datasource(datasource)
      .unit("s")
      .decimals(3)
      .lineWidth(2)
      .fillOpacity(10)
      .gridPos({ x: index * 8, y: 67, w: 8, h: 8 });
    for (const quantile of [0.99, 0.999]) {
      timeseriesPanel.withTarget(
        new prometheus.DataqueryBuilder()
          .expr(
            `histogram_quantile(${String(quantile)}, sum by (kind, le) (rate(${panel.metric}_bucket[5m])))`,
          )
          .legendFormat(`{{kind}} p${String(quantile * 100)}`),
      );
    }
    builder.withPanel(timeseriesPanel);
  }

  for (const [index, panel] of [
    {
      title: "Sender gaps and starvation > 200 ms / 5m",
      description:
        "Counts of paced frame intervals and sender-ready source-idle periods exceeding 200ms. Counts preserve rare excursions that percentiles can hide. No initial-burst samples are counted.",
      unit: "short",
      targets: [
        {
          expr: "sum by (kind) (increase(streambot_send_gaps_total[5m]))",
          legend: "{{kind}} send gaps",
        },
        {
          expr: "sum by (kind) (increase(streambot_source_starvations_total[5m]))",
          legend: "{{kind}} source idle",
        },
      ],
    },
    {
      title: "Demux packet intervals (p99)",
      description:
        "Packet cadence at the NUT demux boundary. Includes downstream backpressure and startup; a large interval alone does not establish encoder starvation. Compare sender source-idle and queue depth.",
      unit: "s",
      targets: [
        {
          expr: "histogram_quantile(0.99, sum by (kind, le) (rate(streambot_demux_interval_seconds_bucket[5m])))",
          legend: "{{kind}} p99",
        },
      ],
    },
    {
      title: "Encoded packet size (p99)",
      description:
        "Encoded packet size before RTP fragmentation, split into audio, video keyframes and delta frames. Large keyframes can create transport bursts despite healthy average bitrate; these are not RTP packet sizes.",
      unit: "bytes",
      targets: [
        {
          expr: "histogram_quantile(0.99, sum by (kind, frame_type, le) (rate(streambot_encoded_packet_bytes_bucket[5m])))",
          legend: "{{kind}} {{frame_type}}",
        },
      ],
    },
  ].entries()) {
    const timeseriesPanel = new timeseries.PanelBuilder()
      .title(panel.title)
      .description(panel.description)
      .datasource(datasource)
      .unit(panel.unit)
      .lineWidth(2)
      .fillOpacity(10)
      .gridPos({ x: index * 8, y: 75, w: 8, h: 8 });
    for (const target of panel.targets) {
      timeseriesPanel.withTarget(
        new prometheus.DataqueryBuilder()
          .expr(target.expr)
          .legendFormat(target.legend),
      );
    }
    builder.withPanel(timeseriesPanel);
  }

  builder.withRow(new dashboard.RowBuilder("Discord peer feedback"));
  for (const [index, panel] of [
    {
      title: "Peer-reported video packet loss (p99)",
      description:
        "Fraction lost from video RTCP receiver reports sent by the Discord peer. Reports describe the sender-to-peer leg, not every viewer. Missing reports remain No data rather than a healthy zero.",
      unit: "percentunit",
      expr: "histogram_quantile(0.99, sum by (le) (rate(streambot_video_receiver_fraction_lost_bucket[5m])))",
      legend: "peer fraction lost",
    },
    {
      title: "Peer-reported video jitter (p99)",
      description:
        "Interarrival jitter from video RTCP receiver reports, converted from the RTP clock to seconds. This is peer feedback, not viewer jitter-buffer delay or rendering latency.",
      unit: "s",
      expr: "histogram_quantile(0.99, sum by (le) (rate(streambot_video_receiver_jitter_seconds_bucket[5m])))",
      legend: "peer jitter",
    },
    {
      title: "Latest peer receiver-report age",
      description:
        "Seconds since the latest valid video receiver report among active pipelines. A fresh report for one pipeline does not establish freshness for every pipeline. No report remains No data; inspect pipeline-correlated diagnostics when multiple videos are active.",
      unit: "s",
      expr: "time() - (streambot_video_receiver_last_report_timestamp_seconds > 0)",
      legend: "latest peer report age",
    },
  ].entries()) {
    builder.withPanel(
      new timeseries.PanelBuilder()
        .title(panel.title)
        .description(panel.description)
        .datasource(datasource)
        .withTarget(
          new prometheus.DataqueryBuilder()
            .expr(panel.expr)
            .legendFormat(panel.legend),
        )
        .unit(panel.unit)
        .lineWidth(2)
        .fillOpacity(10)
        .gridPos({ x: index * 8, y: 84, w: 8, h: 8 }),
    );
  }

  for (const [index, panel] of [
    {
      title: "Video RTCP feedback / s",
      description:
        "Feedback messages from the Discord peer: receiver reports, NACK, PLI and FIR, plus malformed messages. PLI/FIR request a new keyframe; message counts are not lost-packet counts or proof of viewer stalls.",
      expr: "sum by (type) (rate(streambot_video_feedback_total[5m]))",
      legend: "{{type}}",
    },
    {
      title: "Video packets requested by NACK / s",
      description:
        "Packet sequence numbers requested for retransmission by peer NACK messages, including repeated requests. This is requested retransmission volume, not measured unique loss or confirmed retransmission delivery.",
      expr: "sum(rate(streambot_video_nack_packets_total[5m]))",
      legend: "requested packets/s",
    },
    {
      title: "ffmpeg produced, duplicated and dropped frames / s",
      description:
        "ffmpeg progress counters by hardware path and action. Frame duplication can reveal frame-rate conversion cadence; it is separate from network loss. Counters retain deltas across seek epochs.",
      expr: "sum by (hardware, action) (rate(streambot_ffmpeg_frames_total[5m]))",
      legend: "{{hardware}} {{action}}",
    },
  ].entries()) {
    builder.withPanel(
      new timeseries.PanelBuilder()
        .title(panel.title)
        .description(panel.description)
        .datasource(datasource)
        .withTarget(
          new prometheus.DataqueryBuilder()
            .expr(panel.expr)
            .legendFormat(panel.legend),
        )
        .unit("short")
        .lineWidth(2)
        .fillOpacity(10)
        .gridPos({ x: index * 8, y: 92, w: 8, h: 8 }),
    );
  }

  builder.withPanel(
    new timeseries.PanelBuilder()
      .title("Video submissions to native transport / s")
      .description(
        "Video-frame handoff attempts by outcome. Submitted means the native send call was invoked; it does not prove acceptance, network delivery or viewer playback. Not-ready and missing-track/packetizer outcomes expose frames discarded before submission.",
      )
      .datasource(datasource)
      .withTarget(
        new prometheus.DataqueryBuilder()
          .expr(
            "sum by (outcome) (rate(streambot_video_submissions_total[5m]))",
          )
          .legendFormat("{{outcome}}"),
      )
      .unit("short")
      .lineWidth(2)
      .fillOpacity(10)
      .gridPos({ x: 0, y: 100, w: 24, h: 7 }),
  );
}
