import * as dashboard from "@grafana/grafana-foundation-sdk/dashboard";
import * as logs from "@grafana/grafana-foundation-sdk/logs";
import * as loki from "@grafana/grafana-foundation-sdk/loki";

const LOKI = { type: "loki", uid: "loki" };

const traceExploreUrl = `/explore?schemaVersion=1&panes=${encodeURIComponent(
  JSON.stringify({
    trace: {
      datasource: "tempo",
      queries: [
        {
          refId: "A",
          query: "${__data.fields.trace_id}",
          queryType: "traceql",
        },
      ],
      range: { from: "now-1h", to: "now" },
    },
  }),
)}`;

const captureExploreUrl = `/explore?schemaVersion=1&panes=${encodeURIComponent(
  JSON.stringify({
    capture: {
      datasource: "loki",
      queries: [
        {
          refId: "A",
          expr: '{service_name="streambot"} | captureId = "${__data.fields.captureId}"',
        },
      ],
      range: { from: "now-1h", to: "now" },
    },
  }),
)}`;

function panelLink(title: string, url: string) {
  return new dashboard.DashboardLinkBuilder(title)
    .url(url)
    .targetBlank(true)
    .keepTime(true);
}

export function createCorrelatedVoiceLogPanel() {
  return new logs.PanelBuilder()
    .title("Correlated voice logs")
    .description(
      "Expand an OTLP log record, then use its trace_id or captureId structured-metadata field to drill into Tempo or the complete capture log sequence in Loki. Raw audio is never logged.",
    )
    .datasource(LOKI)
    .withTarget(
      new loki.DataqueryBuilder()
        .expr('{service_name="streambot"}')
        .maxLines(200),
    )
    .dataLinks([
      panelLink("Trace in Tempo", traceExploreUrl),
      panelLink("Capture in Loki", captureExploreUrl),
    ])
    .showTime(true)
    .showLabels(false)
    .enableLogDetails(true)
    .wrapLogMessage(true)
    .gridPos({ x: 0, y: 49, w: 24, h: 10 });
}
