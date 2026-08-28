import * as dashboard from "@grafana/grafana-foundation-sdk/dashboard";
import * as tempo from "@grafana/grafana-foundation-sdk/tempo";
import * as timeseries from "@grafana/grafana-foundation-sdk/timeseries";
import { createTimeseriesPanel } from "./ai-provider-dashboard-panels.ts";

const TEMPO_DATASOURCE = { type: "tempo", uid: "tempo" };

export function addLlmPanels(
  builder: dashboard.DashboardBuilder,
  llmFilter: string,
): void {
  builder.withRow(
    new dashboard.RowBuilder("LLM Runtime").gridPos({
      x: 0,
      y: 39,
      w: 24,
      h: 1,
    }),
  );

  builder.withPanel(
    createTimeseriesPanel({
      title: "LLM Requests",
      description:
        "Logical requests across OpenRouter, Claude Agent SDK, and Codex SDK using stable catalog model ids and bounded workload labels.",
      targets: [
        {
          query: `sum by (service, workload, provider, model, outcome) (rate(llm_requests_total{${llmFilter}}[5m])) or on() vector(0)`,
          legend: "{{service}} {{workload}} {{provider}} {{model}} {{outcome}}",
        },
      ],
      gridPos: { x: 0, y: 40, w: 12, h: 8 },
      unit: "reqps",
    }),
  );

  builder.withPanel(
    createTimeseriesPanel({
      title: "LLM p95 Latency",
      description:
        "End-to-end model-call latency by service and stable catalog model id.",
      targets: [
        {
          query: `histogram_quantile(0.95, sum by (le, service, model) (rate(llm_request_duration_seconds_bucket{${llmFilter}}[5m])))`,
          legend: "{{service}} {{model}}",
        },
      ],
      gridPos: { x: 12, y: 40, w: 12, h: 8 },
      unit: "s",
    }),
  );

  builder.withRow(
    new dashboard.RowBuilder("Usage and Cost").gridPos({
      x: 0,
      y: 48,
      w: 24,
      h: 1,
    }),
  );

  builder.withPanel(
    createTimeseriesPanel({
      title: "Token Rate",
      description:
        "Input, output, cached-input, cache-write, and reasoning token rates across gateway and native SDK accounting.",
      targets: [
        {
          query: `sum by (service, model, type) (rate(llm_tokens_total{${llmFilter}}[5m])) or on() vector(0)`,
          legend: "{{service}} {{model}} {{type}}",
        },
      ],
      gridPos: { x: 0, y: 49, w: 12, h: 8 },
      unit: "ops",
    }),
  );

  builder.withPanel(
    createTimeseriesPanel({
      title: "Cost Rate and Discrepancy",
      description:
        "OpenRouter cost only, by accounting type: actual charged cost, canonical catalog cost, and upstream inference cost. The discrepancy series is actual minus catalog. The Claude Agent SDK and Codex SDK bill against subscriptions and deliberately contribute no cost series, so their spend is not represented here -- see their token panels instead.",
      targets: [
        {
          query: `sum by (service, workload, model, type) (rate(llm_cost_usd_total{${llmFilter}}[5m])) or on() vector(0)`,
          legend: "{{service}} {{workload}} {{model}} {{type}}",
        },
        {
          query: `sum by (service, workload, model) (rate(llm_cost_usd_total{${llmFilter},type="actual"}[5m])) - sum by (service, workload, model) (rate(llm_cost_usd_total{${llmFilter},type="catalog"}[5m]))`,
          legend: "{{service}} {{workload}} {{model}} actual-catalog",
        },
      ],
      gridPos: { x: 12, y: 49, w: 12, h: 8 },
      unit: "currencyUSD",
    }),
  );

  builder.withPanel(
    createTimeseriesPanel({
      title: "Top Cost by Feature (24h)",
      description:
        "Rolling 24h billed spend per workload. Sums each accounting type across pod lifetimes first, then takes the larger of OpenRouter's charged cost and upstream inference cost, so BYOK routes -- which bill nothing through OpenRouter and read as $0 under an actual-only query -- are counted, and a deploy inside the window does not discard the shorter pod's spend.",
      targets: [
        {
          query: `topk(10, sum by (service, workload) (max by (service, workload, model) (sum by (service, workload, model, type) (increase(llm_cost_usd_total{${llmFilter},type=~"actual|upstream"}[24h]))))) or on() vector(0)`,
          legend: "{{service}} {{workload}}",
        },
      ],
      gridPos: { x: 0, y: 57, w: 24, h: 8 },
      unit: "currencyUSD",
    }),
  );

  builder.withRow(
    new dashboard.RowBuilder("Routing and Structured Output").gridPos({
      x: 0,
      y: 65,
      w: 24,
      h: 1,
    }),
  );

  builder.withPanel(
    createTimeseriesPanel({
      title: "Resolved Upstream Providers",
      description:
        "OpenRouter route attempts by resolved upstream provider and result. Error attempts followed by success are provider fallbacks.",
      targets: [
        {
          query: `sum by (service, model, upstream_provider, outcome) (rate(llm_router_attempts_total{${llmFilter}}[5m])) or on() vector(0)`,
          legend: "{{service}} {{model}} {{upstream_provider}} {{outcome}}",
        },
      ],
      gridPos: { x: 0, y: 66, w: 12, h: 8 },
      unit: "ops",
    }),
  );

  builder.withPanel(
    createTimeseriesPanel({
      title: "Fallback Attempts",
      description:
        "Failed upstream route attempts that OpenRouter had to route around before a successful response.",
      targets: [
        {
          query: `sum by (service, model, upstream_provider) (rate(llm_router_attempts_total{${llmFilter},outcome="error"}[5m])) or on() vector(0)`,
          legend: "{{service}} {{model}} {{upstream_provider}}",
        },
      ],
      gridPos: { x: 12, y: 66, w: 12, h: 8 },
      unit: "ops",
    }),
  );

  builder.withPanel(
    createTimeseriesPanel({
      title: "Structured Output Attempts",
      description:
        "Success, semantic repair, transport retry, and terminal exhaustion outcomes from generateValidatedObject.",
      targets: [
        {
          query: `sum by (service, workload, model, outcome) (rate(llm_structured_output_attempts_total{${llmFilter}}[5m])) or on() vector(0)`,
          legend: "{{service}} {{workload}} {{model}} {{outcome}}",
        },
      ],
      gridPos: { x: 0, y: 74, w: 12, h: 8 },
      unit: "ops",
    }),
  );

  builder.withPanel(
    createTimeseriesPanel({
      title: "Missing Router Metadata",
      description:
        "Successful gateway responses where the JSON or final SSE chunk did not carry OpenRouter router metadata.",
      targets: [
        {
          query: `sum by (service, workload, model) (rate(llm_openrouter_metadata_missing_total{${llmFilter}}[5m])) or on() vector(0)`,
          legend: "{{service}} {{workload}} {{model}}",
        },
      ],
      gridPos: { x: 12, y: 74, w: 12, h: 8 },
      unit: "ops",
    }),
  );

  builder.withRow(
    new dashboard.RowBuilder("Broadcast Archive and Tempo").gridPos({
      x: 0,
      y: 82,
      w: 24,
      h: 1,
    }),
  );

  builder.withPanel(
    createTimeseriesPanel({
      title: "Broadcast Deliveries",
      description:
        "Authenticated OpenRouter Broadcast deliveries by success, duplicate, validation, archive, and forwarding outcome.",
      targets: [
        {
          query:
            "sum by (outcome) (rate(openrouter_broadcast_requests_total[5m])) or on() vector(0)",
          legend: "{{outcome}}",
        },
      ],
      gridPos: { x: 0, y: 83, w: 8, h: 8 },
      unit: "reqps",
    }),
  );

  builder.withPanel(
    createTimeseriesPanel({
      title: "Broadcast Archive and Forward Operations",
      description:
        "S3 archival, Tempo forwarding, and duplicate detection operations. Any error outcome blocks webhook success.",
      targets: [
        {
          query:
            "sum by (operation, outcome) (rate(openrouter_broadcast_operations_total[5m])) or on() vector(0)",
          legend: "{{operation}} {{outcome}}",
        },
      ],
      gridPos: { x: 8, y: 83, w: 8, h: 8 },
      unit: "ops",
    }),
  );

  builder.withPanel(
    createTimeseriesPanel({
      title: "Broadcast Latency and Last Success Age",
      description:
        "p95 complete archive-plus-forward latency and seconds since the last successful end-to-end delivery.",
      targets: [
        {
          query:
            "histogram_quantile(0.95, sum by (le) (rate(openrouter_broadcast_request_duration_seconds_bucket[5m])))",
          legend: "p95 latency",
        },
        {
          query:
            "time() - max(openrouter_broadcast_last_success_timestamp_seconds)",
          legend: "last success age",
        },
      ],
      gridPos: { x: 16, y: 83, w: 8, h: 8 },
      unit: "s",
    }),
  );

  builder.withRow(
    new dashboard.RowBuilder("Attribution").gridPos({
      x: 0,
      y: 91,
      w: 24,
      h: 1,
    }),
  );

  builder.withPanel(createSubjectTokenPanel());
  builder.withPanel(createSubjectCallPanel());
}

/**
 * Attribution reads from Tempo, not Prometheus, and that is deliberate.
 *
 * Subject ids are unbounded -- Discord snowflakes, PUUIDs -- so they are span
 * attributes and never metric labels. That puts a hard 30-day horizon on every
 * per-subject question, because Tempo's retention is 30 days while Loki keeps
 * per-call cost for 90 days and Prometheus keeps per-feature cost for 365.
 *
 * Tempo also caps a metrics query at a 3h range server-side, so these panels
 * answer "who is spending right now", not "who spent this month". For a longer
 * window, query Loki for `llm.openrouter.response` records carrying
 * `actualCostUsd` and join them to these spans on `traceId`.
 */
const ATTRIBUTION_NOTE =
  "Subject ids are span attributes, never metric labels, so this panel reads Tempo and inherits Tempo's 30-day retention and 3h metrics-query cap. For spend over a longer window, join Loki's llm.openrouter.response cost records to these spans on traceId.";

function createSubjectTokenPanel() {
  return new timeseries.PanelBuilder()
    .title("Output Tokens by Subject")
    .description(
      `Output tokens grouped by who the call was made on behalf of. ${ATTRIBUTION_NOTE}`,
    )
    .datasource(TEMPO_DATASOURCE)
    .withTarget(
      new tempo.TempoQueryBuilder()
        .queryType("traceql")
        .metricsQueryType(tempo.MetricsQueryType.Range)
        .query(
          '{span.llm.subject.id != ""} | sum_over_time(span.gen_ai.usage.output_tokens) by (span.llm.subject.kind, span.llm.subject.id)',
        ),
    )
    .unit("short")
    .lineWidth(2)
    .fillOpacity(10)
    .gridPos({ x: 0, y: 92, w: 12, h: 8 });
}

function createSubjectCallPanel() {
  return new timeseries.PanelBuilder()
    .title("Attributed Calls by Subject Kind")
    .description(
      `Span counts by subject kind. A rising \`system\` share means spend is shifting to scheduled work with no requester, which is expected for match reviews and betting but not for interactive features. ${ATTRIBUTION_NOTE}`,
    )
    .datasource(TEMPO_DATASOURCE)
    .withTarget(
      new tempo.TempoQueryBuilder()
        .queryType("traceql")
        .metricsQueryType(tempo.MetricsQueryType.Range)
        .query(
          '{span.llm.subject.kind != ""} | count_over_time() by (span.llm.subject.kind)',
        ),
    )
    .unit("short")
    .lineWidth(2)
    .fillOpacity(10)
    .gridPos({ x: 12, y: 92, w: 12, h: 8 });
}
