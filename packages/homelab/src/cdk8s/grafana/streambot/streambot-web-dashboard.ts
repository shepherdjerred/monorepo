import * as dashboard from "@grafana/grafana-foundation-sdk/dashboard";
import { exportDashboardWithHelmEscaping } from "@shepherdjerred/homelab/cdk8s/grafana/dashboard-export.ts";
import { createTimeseriesPanel } from "@shepherdjerred/homelab/cdk8s/grafana/shared/dashboard-panels.ts";

type Target = { readonly query: string; readonly legend: string };
type PanelSpec = {
  readonly title: string;
  readonly targets: readonly Target[];
  readonly unit?: string;
};
type RowSpec = {
  readonly title: string;
  readonly panels: readonly PanelSpec[];
};

const QUANTILES = [0.5, 0.95] as const;

function percentLabel(quantile: number): string {
  return `p${(quantile * 100).toString()}`;
}

/** p50 and p95 of a histogram, grouped by closed labels (empty for none). */
function quantiles(
  metric: string,
  by: readonly string[],
  window = "5m",
): readonly Target[] {
  const groups = [...by, "le"].join(", ");
  const legend = by.map((label) => `{{${label}}}`).join(" ");
  return QUANTILES.map((quantile) => ({
    query: `histogram_quantile(${quantile.toString()}, sum by (${groups}) (rate(${metric}_bucket[${window}])))`,
    legend: `${legend} ${percentLabel(quantile)}`.trim(),
  }));
}

/** Per-second rate of a counter, summed by closed labels, legended by the same labels. */
function rate(metric: string, by: readonly string[], prefix = ""): Target {
  return {
    query: `sum by (${by.join(", ")}) (rate(${metric}[5m]))`,
    legend: `${prefix}${by.map((label) => `{{${label}}}`).join(" ")}`,
  };
}

// Every label below is a closed set from packages/streambot/src/observability/web-metrics.ts.
// Nothing here groups by a Discord id, name, search text, title or URL.
const ROWS: readonly RowSpec[] = [
  {
    title: "Web API requests",
    panels: [
      {
        title: "Request rate by code",
        unit: "reqps",
        targets: [rate("streambot_web_requests_total", ["code"])],
      },
      {
        title: "Error rate by code",
        unit: "reqps",
        targets: [
          {
            query:
              'sum by (code) (rate(streambot_web_requests_total{status_class="5xx"}[5m]))',
            legend: "5xx {{code}}",
          },
          {
            query:
              'sum(rate(streambot_web_requests_total{code="unavailable",status_class!="5xx"}[5m]))',
            legend: "unavailable (not 5xx)",
          },
        ],
      },
      {
        title: "Request duration p50 / p95 by route",
        unit: "s",
        targets: quantiles("streambot_web_request_duration_seconds", ["route"]),
      },
    ],
  },
  {
    title: "Remote commands",
    panels: [
      {
        title: "Command outcomes by action",
        unit: "reqps",
        targets: [rate("streambot_web_commands_total", ["action", "outcome"])],
      },
      {
        title: "Command outcomes by transport",
        unit: "reqps",
        targets: [
          rate("streambot_web_commands_total", ["transport", "outcome"]),
        ],
      },
      {
        title: "Command duration p50 / p95 by action",
        unit: "s",
        targets: quantiles("streambot_web_command_duration_seconds", [
          "action",
        ]),
      },
    ],
  },
  {
    title: "Playback and sign-in",
    panels: [
      {
        title: "Time to playback p50 / p95 by transport",
        unit: "s",
        targets: quantiles(
          "streambot_web_time_to_playback_seconds",
          ["transport"],
          "15m",
        ),
      },
      {
        title: "Play success ratio by surface",
        unit: "percentunit",
        targets: [
          {
            query:
              'sum by (surface) (rate(streambot_play_requests_total{outcome="ok"}[15m])) / sum by (surface) (rate(streambot_play_requests_total[15m]))',
            legend: "{{surface}}",
          },
        ],
      },
      {
        title: "Sign-ins by outcome",
        unit: "ops",
        targets: [rate("streambot_web_logins_total", ["outcome"])],
      },
    ],
  },
  {
    title: "Room event streams (SSE)",
    panels: [
      {
        title: "Open SSE connections",
        targets: [
          { query: "sum(streambot_web_sse_connections)", legend: "open" },
        ],
      },
      {
        title: "SSE events by name",
        unit: "ops",
        targets: [rate("streambot_web_sse_events_total", ["event"])],
      },
      {
        title: "SSE drops and closes by reason",
        unit: "ops",
        targets: [
          {
            query: "sum(rate(streambot_web_sse_dropped_total[5m]))",
            legend: "snapshots dropped",
          },
          rate("streambot_web_sse_closed_total", ["reason"], "closed "),
        ],
      },
      {
        title: "SSE connection lifetime p50 / p95",
        unit: "s",
        targets: quantiles("streambot_web_sse_connection_seconds", [], "1h"),
      },
    ],
  },
  {
    title: "Search",
    panels: [
      {
        title: "Search rate by kind and provider",
        unit: "reqps",
        targets: [rate("streambot_web_search_total", ["kind", "provider"])],
      },
      {
        title: "Search outcomes",
        unit: "reqps",
        targets: [rate("streambot_web_search_total", ["kind", "outcome"])],
      },
      {
        title: "Search latency p50 / p95 by kind and provider",
        unit: "s",
        targets: quantiles("streambot_web_search_duration_seconds", [
          "kind",
          "provider",
        ]),
      },
    ],
  },
  {
    title: "Music providers and analytics",
    panels: [
      {
        title: "Music provider requests by outcome",
        unit: "reqps",
        targets: [
          rate("streambot_music_provider_requests_total", [
            "provider",
            "operation",
            "outcome",
          ]),
        ],
      },
      {
        title: "Provider items and artwork dropped",
        unit: "ops",
        targets: [
          rate(
            "streambot_music_provider_dropped_items_total",
            ["provider", "operation"],
            "items ",
          ),
          rate(
            "streambot_music_provider_dropped_artwork_total",
            ["provider"],
            "artwork ",
          ),
        ],
      },
      {
        title: "Analytics capture outcomes",
        unit: "ops",
        targets: [
          rate("streambot_analytics_events_total", ["event", "outcome"]),
        ],
      },
    ],
  },
];

const PANEL_HEIGHT = 8;
const GRID_WIDTH = 24;

export function createStreambotWebDashboard() {
  const builder = new dashboard.DashboardBuilder("Streambot Web Remote")
    .uid("streambot-web")
    .tags(["streambot", "web", "observability"])
    .time({ from: "now-6h", to: "now" })
    .refresh("30s")
    .timezone("browser")
    .editable()
    .link(
      new dashboard.DashboardLinkBuilder("Streambot summary")
        .url("/d/streambot/streambot")
        .keepTime(true),
    )
    .link(
      new dashboard.DashboardLinkBuilder("Open streambot logs")
        .url("/explore")
        .targetBlank(true)
        .keepTime(true),
    );

  let y = 0;
  for (const row of ROWS) {
    builder.withRow(new dashboard.RowBuilder(row.title));
    y += 1;
    const width = GRID_WIDTH / row.panels.length;
    for (const [index, panel] of row.panels.entries()) {
      builder.withPanel(
        createTimeseriesPanel({
          title: panel.title,
          targets: [...panel.targets],
          unit: panel.unit,
          gridPos: { x: index * width, y, w: width, h: PANEL_HEIGHT },
        }),
      );
    }
    y += PANEL_HEIGHT;
  }

  return builder.build();
}

export function exportStreambotWebDashboardJson(): string {
  return exportDashboardWithHelmEscaping(createStreambotWebDashboard());
}
