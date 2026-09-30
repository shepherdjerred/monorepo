import * as common from "@grafana/grafana-foundation-sdk/common";
import * as dashboard from "@grafana/grafana-foundation-sdk/dashboard";
import * as prometheus from "@grafana/grafana-foundation-sdk/prometheus";
import * as stat from "@grafana/grafana-foundation-sdk/stat";
import * as timeseries from "@grafana/grafana-foundation-sdk/timeseries";

const VOICE_DASHBOARD_LINK = new dashboard.DashboardLinkBuilder(
  "Open Streambot Voice dashboard",
)
  .url("/d/streambot-voice/streambot-voice")
  .keepTime(true);

export function addVoiceAssistantPanels(
  builder: dashboard.DashboardBuilder,
): void {
  const prometheusDatasource = { type: "prometheus", uid: "Prometheus" };
  builder.withRow(new dashboard.RowBuilder("Voice assistant summary"));
  builder.withPanel(
    new stat.PanelBuilder()
      .title("Active / ready voice sessions")
      .description(
        "Active playback sessions and sessions whose Discord receive/DAVE path is ready.",
      )
      .datasource(prometheusDatasource)
      .withTarget(
        new prometheus.DataqueryBuilder()
          .expr("sum(streambot_voice_sessions_active) or on() vector(0)")
          .legendFormat("active"),
      )
      .withTarget(
        new prometheus.DataqueryBuilder()
          .expr(
            "sum(streambot_voice_receive_ready * on(guild_id, channel_id) streambot_voice_dave_ready) or on() vector(0)",
          )
          .legendFormat("ready"),
      )
      .links([VOICE_DASHBOARD_LINK])
      .colorMode(common.BigValueColorMode.Background)
      .gridPos({ x: 0, y: 58, w: 6, h: 7 }),
  );
  builder.withPanel(
    new timeseries.PanelBuilder()
      .title("Voice ingress age")
      .description(
        "Seconds since the most recent Discord voice packet. Inactivity is diagnostic only and does not notify.",
      )
      .datasource(prometheusDatasource)
      .withTarget(
        new prometheus.DataqueryBuilder()
          .expr("time() - (streambot_voice_last_packet_timestamp_seconds > 0)")
          .legendFormat("{{guild_id}}/{{channel_id}}"),
      )
      .links([VOICE_DASHBOARD_LINK])
      .unit("s")
      .lineWidth(2)
      .fillOpacity(10)
      .gridPos({ x: 6, y: 58, w: 6, h: 7 }),
  );
  builder.withPanel(
    new timeseries.PanelBuilder()
      .title("Voice activation funnel")
      .description(
        "Permissive candidates, local verifier passes, cloud prefix passes, and commands.",
      )
      .datasource(prometheusDatasource)
      .withTarget(
        new prometheus.DataqueryBuilder()
          .expr(
            "sum(rate(streambot_voice_wake_candidates_total[5m])) or on() vector(0)",
          )
          .legendFormat("candidates/s"),
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
      .links([VOICE_DASHBOARD_LINK])
      .unit("none")
      .lineWidth(2)
      .fillOpacity(10)
      .gridPos({ x: 12, y: 58, w: 6, h: 7 }),
  );
  builder.withPanel(
    new timeseries.PanelBuilder()
      .title("Voice failure rate")
      .description(
        "OpenAI, reply-send, and turn-delivery failures divided by wake candidates.",
      )
      .datasource(prometheusDatasource)
      .withTarget(
        new prometheus.DataqueryBuilder()
          .expr(
            "(sum(rate(streambot_voice_openai_failures_total[5m])) + sum(rate(streambot_voice_reply_send_failures_total[5m])) + sum(rate(streambot_voice_turn_delivery_failures_total[5m]))) / clamp_min(sum(rate(streambot_voice_wake_candidates_total[5m])), 0.001)",
          )
          .legendFormat("failures/candidate"),
      )
      .links([VOICE_DASHBOARD_LINK])
      .unit("percentunit")
      .lineWidth(2)
      .fillOpacity(10)
      .gridPos({ x: 18, y: 58, w: 6, h: 7 }),
  );
}
