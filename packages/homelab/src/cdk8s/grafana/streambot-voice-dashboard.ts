import * as common from "@grafana/grafana-foundation-sdk/common";
import * as dashboard from "@grafana/grafana-foundation-sdk/dashboard";
import * as prometheus from "@grafana/grafana-foundation-sdk/prometheus";
import * as stat from "@grafana/grafana-foundation-sdk/stat";
import * as timeseries from "@grafana/grafana-foundation-sdk/timeseries";
import { exportDashboardWithHelmEscaping } from "./dashboard-export.ts";
import { createCorrelatedVoiceLogPanel } from "./streambot-voice-correlation-panel.ts";

const PROMETHEUS = { type: "prometheus", uid: "Prometheus" };

function panelLink(title: string, url: string) {
  return new dashboard.DashboardLinkBuilder(title)
    .url(url)
    .targetBlank(true)
    .keepTime(true);
}

function seriesPanel(input: {
  readonly title: string;
  readonly description: string;
  readonly targets: readonly {
    readonly expr: string;
    readonly legend: string;
  }[];
  readonly x: number;
  readonly y: number;
  readonly w?: number;
  readonly h?: number;
  readonly unit?: string;
}) {
  const builder = new timeseries.PanelBuilder()
    .title(input.title)
    .description(input.description)
    .datasource(PROMETHEUS)
    .unit(input.unit ?? "none")
    .lineWidth(2)
    .fillOpacity(10)
    .gridPos({ x: input.x, y: input.y, w: input.w ?? 8, h: input.h ?? 7 });
  for (const target of input.targets) {
    builder.withTarget(
      new prometheus.DataqueryBuilder()
        .expr(target.expr)
        .legendFormat(target.legend),
    );
  }
  return builder;
}

export function createStreambotVoiceDashboard() {
  const builder = new dashboard.DashboardBuilder("Streambot Voice")
    .uid("streambot-voice")
    .tags(["streambot", "voice", "discord", "openai", "observability"])
    .time({ from: "now-3h", to: "now" })
    .refresh("15s")
    .timezone("browser")
    .editable()
    .link(panelLink("Streambot summary", "/d/streambot/streambot"))
    .link(panelLink("Open streambot logs", "/explore"));

  builder.withRow(new dashboard.RowBuilder("Readiness and ingress"));
  builder.withPanel(
    new stat.PanelBuilder()
      .title("Active / receive-ready / DAVE-ready sessions")
      .description(
        "ID-bearing series exist only while a playback session is active and are removed at teardown.",
      )
      .datasource(PROMETHEUS)
      .withTarget(
        new prometheus.DataqueryBuilder()
          .expr("sum(streambot_voice_sessions_active) or on() vector(0)")
          .legendFormat("active"),
      )
      .withTarget(
        new prometheus.DataqueryBuilder()
          .expr("sum(streambot_voice_receive_ready) or on() vector(0)")
          .legendFormat("receive ready"),
      )
      .withTarget(
        new prometheus.DataqueryBuilder()
          .expr("sum(streambot_voice_dave_ready) or on() vector(0)")
          .legendFormat("DAVE ready"),
      )
      .colorMode(common.BigValueColorMode.Background)
      .gridPos({ x: 0, y: 1, w: 8, h: 7 }),
  );
  builder.withPanel(
    seriesPanel({
      title: "Ingress freshness",
      description:
        "Seconds since the most recent Discord packet and decoded 16 kHz sample. Quiet channels are diagnostic only and never notify by themselves.",
      targets: [
        {
          expr: "time() - (streambot_voice_last_packet_timestamp_seconds > 0)",
          legend: "packet {{guild_id}}/{{channel_id}}",
        },
        {
          expr: "time() - (streambot_voice_last_decoded_timestamp_seconds > 0)",
          legend: "decoded {{guild_id}}/{{channel_id}}",
        },
      ],
      x: 8,
      y: 1,
      unit: "s",
    }),
  );
  builder.withPanel(
    seriesPanel({
      title: "Receive packet outcomes and bytes",
      description:
        "Bounded RTP/DAVE outcomes. No packet contents, SSRCs, or user IDs enter these counters.",
      targets: [
        {
          expr: "sum by (outcome) (rate(streambot_voice_receive_packets_total[5m])) or on() vector(0)",
          legend: "{{outcome}} packets/s",
        },
        {
          expr: "sum by (outcome) (rate(streambot_voice_receive_bytes_total[5m])) or on() vector(0)",
          legend: "{{outcome}} bytes/s",
        },
      ],
      x: 16,
      y: 1,
    }),
  );

  builder.withRow(new dashboard.RowBuilder("Activation funnel"));
  builder.withPanel(
    seriesPanel({
      title: "Wake cascade",
      description:
        "Candidates, local phrase passes, cloud prefix passes, and terminal commands.",
      targets: [
        {
          expr: "sum(rate(streambot_voice_wake_candidates_total[5m])) or on() vector(0)",
          legend: "candidates/s",
        },
        {
          expr: 'sum(rate(streambot_voice_local_verifications_total{outcome="accepted"}[5m])) or on() vector(0)',
          legend: "local accepted/s",
        },
        {
          expr: 'sum(rate(streambot_voice_transcript_verifications_total{outcome="accepted"}[5m])) or on() vector(0)',
          legend: "cloud accepted/s",
        },
        {
          expr: 'sum(rate(streambot_voice_turns_total{outcome="command"}[5m])) or on() vector(0)',
          legend: "commands/s",
        },
      ],
      x: 0,
      y: 9,
    }),
  );
  builder.withPanel(
    seriesPanel({
      title: "Verifier and endpoint outcomes",
      description:
        "Local verifier, cloud prefix verifier, and endpoint terminal reasons.",
      targets: [
        {
          expr: "sum by (outcome) (rate(streambot_voice_local_verifications_total[5m])) or on() vector(0)",
          legend: "local {{outcome}}",
        },
        {
          expr: "sum by (outcome) (rate(streambot_voice_transcript_verifications_total[5m])) or on() vector(0)",
          legend: "cloud {{outcome}}",
        },
        {
          expr: "sum by (reason) (rate(streambot_voice_endpoint_outcomes_total[5m])) or on() vector(0)",
          legend: "endpoint {{reason}}",
        },
      ],
      x: 8,
      y: 9,
    }),
  );
  builder.withPanel(
    seriesPanel({
      title: "Wake scores by model fragment",
      description:
        "p50 and p95 permissive wake score for each finite fragment.",
      targets: [
        {
          expr: "histogram_quantile(0.50, sum by (fragment, le) (rate(streambot_voice_wake_score_bucket[10m])))",
          legend: "{{fragment}} p50",
        },
        {
          expr: "histogram_quantile(0.95, sum by (fragment, le) (rate(streambot_voice_wake_score_bucket[10m])))",
          legend: "{{fragment}} p95",
        },
      ],
      x: 16,
      y: 9,
    }),
  );

  builder.withRow(new dashboard.RowBuilder("Quality and latency"));
  builder.withPanel(
    seriesPanel({
      title: "Activation stage latency p95",
      description:
        "Controlled stage latency from local verification through OpenAI.",
      targets: [
        {
          expr: "histogram_quantile(0.95, sum by (stage, le) (rate(streambot_voice_activation_stage_latency_seconds_bucket[5m]))) or on() vector(0)",
          legend: "{{stage}}",
        },
      ],
      x: 0,
      y: 17,
      unit: "s",
    }),
  );
  builder.withPanel(
    seriesPanel({
      title: "Utterance and DTX duration p95",
      description:
        "Accepted/rejected audio length and inserted DTX silence at the detector's 16 kHz input boundary.",
      targets: [
        {
          expr: "histogram_quantile(0.95, sum by (outcome, le) (rate(streambot_voice_utterance_duration_seconds_bucket[5m]))) or on() vector(0)",
          legend: "utterance {{outcome}}",
        },
        {
          expr: "histogram_quantile(0.95, sum by (le) (rate(streambot_voice_dtx_duration_seconds_bucket[5m]))) or on() vector(0)",
          legend: "DTX",
        },
      ],
      x: 8,
      y: 17,
      unit: "s",
    }),
  );
  builder.withPanel(
    seriesPanel({
      title: "Decoded input and drops",
      description:
        "Decoded speech volume plus bounded reasons input did not reach wake processing.",
      targets: [
        {
          expr: "rate(streambot_voice_decoded_seconds_total[5m]) or on() vector(0)",
          legend: "decoded seconds/s",
        },
        {
          expr: "sum by (reason) (rate(streambot_voice_input_drops_total[5m])) or on() vector(0)",
          legend: "drop {{reason}}/s",
        },
        {
          expr: "rate(streambot_voice_decode_errors_total[5m]) or on() vector(0)",
          legend: "decode errors/s",
        },
      ],
      x: 16,
      y: 17,
    }),
  );

  builder.withRow(new dashboard.RowBuilder("Cloud, tools, and usage"));
  builder.withPanel(
    seriesPanel({
      title: "OpenAI requests and failures",
      description:
        "Controlled request stages and bounded failure classes; SDK tracing remains disabled.",
      targets: [
        {
          expr: "sum by (stage, outcome) (rate(streambot_voice_cloud_requests_total[5m])) or on() vector(0)",
          legend: "{{stage}} {{outcome}}",
        },
        {
          expr: "sum by (stage) (rate(streambot_voice_openai_failures_total[5m])) or on() vector(0)",
          legend: "failure {{stage}}",
        },
      ],
      x: 0,
      y: 25,
    }),
  );
  builder.withPanel(
    seriesPanel({
      title: "OpenAI usage",
      description:
        "Realtime audio tokens and transcription usage by bounded unit/direction.",
      targets: [
        {
          expr: "sum by (direction) (rate(streambot_voice_audio_tokens_total[5m])) or on() vector(0)",
          legend: "audio tokens {{direction}}/s",
        },
        {
          expr: "sum by (unit, direction) (rate(streambot_voice_transcription_usage_total[5m])) or on() vector(0)",
          legend: "transcription {{direction}} {{unit}}/s",
        },
      ],
      x: 8,
      y: 25,
    }),
  );
  builder.withPanel(
    seriesPanel({
      title: "Tool outcomes and p95 latency",
      description: "Validated tool executions by finite tool name and outcome.",
      targets: [
        {
          expr: "sum by (tool, outcome) (rate(streambot_voice_tool_calls_total[5m])) or on() vector(0)",
          legend: "{{tool}} {{outcome}}/s",
        },
        {
          expr: "histogram_quantile(0.95, sum by (tool, le) (rate(streambot_voice_tool_duration_seconds_bucket[5m]))) or on() vector(0)",
          legend: "{{tool}} p95 seconds",
        },
      ],
      x: 16,
      y: 25,
    }),
  );

  builder.withRow(new dashboard.RowBuilder("Output and ducking"));
  builder.withPanel(
    seriesPanel({
      title: "Reply delivery duration p95",
      description:
        "Drain duration by outcome and end-to-end wake-to-first-packet latency.",
      targets: [
        {
          expr: "histogram_quantile(0.95, sum by (outcome, le) (rate(streambot_voice_reply_duration_seconds_bucket[5m]))) or on() vector(0)",
          legend: "reply {{outcome}}",
        },
        {
          expr: "histogram_quantile(0.95, sum by (le) (rate(streambot_voice_wake_to_reply_seconds_bucket[5m]))) or on() vector(0)",
          legend: "wake to reply",
        },
      ],
      x: 0,
      y: 33,
      unit: "s",
    }),
  );
  builder.withPanel(
    seriesPanel({
      title: "Reply output and failures",
      description:
        "Assistant packets/bytes delivered and failed sends or turn drains.",
      targets: [
        {
          expr: "rate(streambot_voice_reply_packets_total[5m]) or on() vector(0)",
          legend: "packets/s",
        },
        {
          expr: "rate(streambot_voice_reply_bytes_total[5m]) or on() vector(0)",
          legend: "bytes/s",
        },
        {
          expr: "rate(streambot_voice_reply_send_failures_total[5m]) + rate(streambot_voice_turn_delivery_failures_total[5m])",
          legend: "failures/s",
        },
      ],
      x: 8,
      y: 33,
    }),
  );
  builder.withPanel(
    seriesPanel({
      title: "Active turn and duck state",
      description:
        "A turn over 35 seconds warns; ducked with no active turn for 60 seconds is critical.",
      targets: [
        {
          expr: "streambot_voice_turn_age_seconds",
          legend: "turn age {{guild_id}}/{{channel_id}}",
        },
        {
          expr: "streambot_voice_duck_state",
          legend: "ducked {{guild_id}}/{{channel_id}}",
        },
      ],
      x: 16,
      y: 33,
      unit: "s",
    }),
  );

  builder.withRow(new dashboard.RowBuilder("Capture health and correlation"));
  builder.withPanel(
    seriesPanel({
      title: "Capture queue",
      description: "Two-worker, 128 MiB in-memory upload queue pressure.",
      targets: [
        {
          expr: "streambot_voice_capture_queue_depth",
          legend: "jobs",
        },
        {
          expr: "streambot_voice_capture_queue_bytes",
          legend: "bytes",
        },
      ],
      x: 0,
      y: 41,
    }),
  );
  builder.withPanel(
    seriesPanel({
      title: "Capture and telemetry outcomes",
      description:
        "Capture commits/drops plus OTLP trace and log export results.",
      targets: [
        {
          expr: "sum by (outcome) (rate(streambot_voice_capture_uploads_total[5m])) or on() vector(0)",
          legend: "capture {{outcome}}/s",
        },
        {
          expr: "sum by (reason) (rate(streambot_voice_capture_drops_total[5m])) or on() vector(0)",
          legend: "drop {{reason}}/s",
        },
        {
          expr: "sum by (signal, outcome) (rate(streambot_telemetry_exports_total[5m])) or on() vector(0)",
          legend: "{{signal}} {{outcome}}/s",
        },
      ],
      x: 8,
      y: 41,
    }),
  );
  builder.withPanel(
    seriesPanel({
      title: "Capture upload latency p95",
      description:
        "Audio objects upload first; manifest.json is the final commit marker.",
      targets: [
        {
          expr: "histogram_quantile(0.95, sum by (outcome, le) (rate(streambot_voice_capture_upload_duration_seconds_bucket[5m]))) or on() vector(0)",
          legend: "{{outcome}}",
        },
      ],
      x: 16,
      y: 41,
      unit: "s",
    }),
  );
  builder.withPanel(createCorrelatedVoiceLogPanel());

  return builder.build();
}

export function exportStreambotVoiceDashboardJson(): string {
  return exportDashboardWithHelmEscaping(createStreambotVoiceDashboard());
}
