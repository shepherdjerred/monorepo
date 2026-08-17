import * as dashboard from "@grafana/grafana-foundation-sdk/dashboard";
import * as prometheus from "@grafana/grafana-foundation-sdk/prometheus";
import * as timeseries from "@grafana/grafana-foundation-sdk/timeseries";

export function addVoiceAssistantPanels(
  builder: dashboard.DashboardBuilder,
): void {
  const prometheusDatasource = { type: "prometheus", uid: "Prometheus" };
  builder.withRow(new dashboard.RowBuilder("Voice assistant"));
  builder.withPanel(
    new timeseries.PanelBuilder()
      .title("Voice activation funnel")
      .description(
        "Privacy-safe cascade throughput: permissive local candidates, phrase-verifier passes, cloud transcript passes, commands, and retry responses.",
      )
      .datasource(prometheusDatasource)
      .withTarget(
        new prometheus.DataqueryBuilder()
          .expr(
            "sum(rate(streambot_voice_wake_candidates_total[5m])) or on() vector(0)",
          )
          .legendFormat("sherpa candidates/s"),
      )
      .withTarget(
        new prometheus.DataqueryBuilder()
          .expr(
            'sum(rate(streambot_voice_local_verifications_total{outcome="accepted"}[5m])) or on() vector(0)',
          )
          .legendFormat("local passes/s"),
      )
      .withTarget(
        new prometheus.DataqueryBuilder()
          .expr(
            'sum(rate(streambot_voice_transcript_verifications_total{outcome="accepted"}[5m])) or on() vector(0)',
          )
          .legendFormat("cloud passes/s"),
      )
      .withTarget(
        new prometheus.DataqueryBuilder()
          .expr(
            'sum(rate(streambot_voice_turns_total{outcome="command"}[5m])) or on() vector(0)',
          )
          .legendFormat("commands/s"),
      )
      .withTarget(
        new prometheus.DataqueryBuilder()
          .expr(
            'sum(rate(streambot_voice_turns_total{outcome="no-command"}[5m])) or on() vector(0)',
          )
          .legendFormat("retries/s"),
      )
      .unit("none")
      .lineWidth(2)
      .fillOpacity(10)
      .gridPos({ x: 0, y: 58, w: 8, h: 7 }),
  );
  builder.withPanel(
    new timeseries.PanelBuilder()
      .title("Wake-to-reply latency p95")
      .description(
        "Time from local wake detection to the first assistant audio packet.",
      )
      .datasource(prometheusDatasource)
      .withTarget(
        new prometheus.DataqueryBuilder()
          .expr(
            "histogram_quantile(0.95, sum by (le) (rate(streambot_voice_wake_to_reply_seconds_bucket[5m]))) or on() vector(0)",
          )
          .legendFormat("p95"),
      )
      .withTarget(
        new prometheus.DataqueryBuilder()
          .expr(
            "histogram_quantile(0.95, sum by (stage, le) (rate(streambot_voice_activation_stage_latency_seconds_bucket[5m]))) or on() vector(0)",
          )
          .legendFormat("{{stage}} p95"),
      )
      .unit("s")
      .lineWidth(2)
      .fillOpacity(10)
      .gridPos({ x: 8, y: 58, w: 8, h: 7 }),
  );
  builder.withPanel(
    new timeseries.PanelBuilder()
      .title("Voice tool and OpenAI outcomes")
      .description(
        "Bounded tool/outcome counters plus Realtime failures; labels never contain request content.",
      )
      .datasource(prometheusDatasource)
      .withTarget(
        new prometheus.DataqueryBuilder()
          .expr(
            "sum by (tool, outcome) (rate(streambot_voice_tool_calls_total[5m])) or on() vector(0)",
          )
          .legendFormat("{{tool}} {{outcome}}"),
      )
      .withTarget(
        new prometheus.DataqueryBuilder()
          .expr(
            "sum by (stage) (rate(streambot_voice_openai_failures_total[5m])) or on() vector(0)",
          )
          .legendFormat("OpenAI {{stage}}"),
      )
      .withTarget(
        new prometheus.DataqueryBuilder()
          .expr(
            "sum by (reason) (rate(streambot_voice_cloud_verification_rate_limits_total[5m])) or on() vector(0)",
          )
          .legendFormat("rate limit {{reason}}"),
      )
      .withTarget(
        new prometheus.DataqueryBuilder()
          .expr(
            "sum by (outcome) (rate(streambot_voice_transcript_verifications_total[5m])) or on() vector(0)",
          )
          .legendFormat("transcript {{outcome}}"),
      )
      .withTarget(
        new prometheus.DataqueryBuilder()
          .expr(
            "sum by (outcome) (rate(streambot_voice_local_verifications_total[5m])) or on() vector(0)",
          )
          .legendFormat("local {{outcome}}"),
      )
      .withTarget(
        new prometheus.DataqueryBuilder()
          .expr(
            "sum by (unit, direction) (rate(streambot_voice_transcription_usage_total[5m])) or on() vector(0)",
          )
          .legendFormat("transcription {{direction}} {{unit}}/s"),
      )
      .unit("none")
      .lineWidth(2)
      .fillOpacity(10)
      .gridPos({ x: 16, y: 58, w: 8, h: 7 }),
  );
}
