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
        "Logical requests across the direct OpenAI, Anthropic, and Google providers, the Claude Agent SDK, and the Codex SDK, using stable catalog model ids and bounded workload labels.",
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
        "Input, output, cached-input, cache-write, and reasoning token rates as the providers report them.",
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
      title: "Live Cost Rate by Provider",
      description:
        "Catalog price applied to provider-reported tokens, per request, by provider and model. Providers return tokens, never dollars, so this is an estimate that moves immediately. It cannot see OpenAI complimentary data-sharing tokens or uninstrumented traffic (Codex, voice); compare against the billed row below. The Claude Agent SDK and Codex SDK bill against subscriptions and contribute no cost series.",
      targets: [
        {
          query: `sum by (provider, model) (rate(llm_cost_usd_total{${llmFilter},type="catalog"}[5m])) or on() vector(0)`,
          legend: "{{provider}} {{model}}",
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
        "Rolling 24h live spend per workload. Sums across pod lifetimes first, so a deploy inside the window does not discard the shorter pod's spend.",
      targets: [
        {
          query: `topk(10, sum by (service, workload) (increase(llm_cost_usd_total{${llmFilter},type="catalog"}[24h]))) or on() vector(0)`,
          legend: "{{service}} {{workload}}",
        },
      ],
      gridPos: { x: 0, y: 57, w: 12, h: 8 },
      unit: "currencyUSD",
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
      gridPos: { x: 12, y: 57, w: 12, h: 8 },
      unit: "ops",
    }),
  );

  builder.withRow(
    new dashboard.RowBuilder("Provider-Billed Spend").gridPos({
      x: 0,
      y: 65,
      w: 24,
      h: 1,
    }),
  );

  // Billed series come from the hourly Temporal reconciliation of the OpenAI
  // Costs and Anthropic Cost Report APIs. They are gauges for a UTC-day window,
  // not counters, and carry per-account labels rather than workload labels.
  builder.withPanel(
    createTimeseriesPanel({
      title: "Live vs Billed Cost (7 days)",
      description:
        "Live catalog cost against what OpenAI and Anthropic report they will charge, both over roughly the last seven days. The billed window starts at UTC midnight six days ago, so live covers up to one extra day; read the gap as a trend, not to the cent. Billed below live is expected: OpenAI data-sharing complimentary tokens are free and appear only in the billed figure. Billed above live means uninstrumented traffic (Codex, voice) or a stale catalog price. Google is not billed here yet: its spend is visible only through the AI Studio cap and Cloud Billing budgets.",
      targets: [
        {
          query: `sum by (provider) (llm_billed_cost_usd{window="7d"}) or on() vector(0)`,
          legend: "billed {{provider}}",
        },
        {
          query: `sum by (provider) (increase(llm_cost_usd_total{type="catalog"}[7d])) or on() vector(0)`,
          legend: "live {{provider}}",
        },
      ],
      gridPos: { x: 0, y: 66, w: 12, h: 8 },
      unit: "currencyUSD",
    }),
  );

  builder.withPanel(
    createTimeseriesPanel({
      title: "Billed Cost by Account",
      description:
        "Current UTC-day and trailing 7-day cost per OpenAI project and Anthropic workspace, as the providers bill it. Each account has its own provider-side hard cap; this is how close it is.",
      targets: [
        {
          query: `sum by (provider, account, window) (llm_billed_cost_usd) or on() vector(0)`,
          legend: "{{provider}} {{account}} {{window}}",
        },
      ],
      gridPos: { x: 12, y: 66, w: 12, h: 8 },
      unit: "currencyUSD",
    }),
  );

  builder.withPanel(
    createTimeseriesPanel({
      title: "OpenAI Billed Tokens by Service Tier",
      description:
        "Current UTC-day tokens from OpenAI's organization Usage API, by project, model, and service tier. Complimentary data-sharing tokens appear here with no matching cost.",
      targets: [
        {
          query:
            'sum by (account, model, service_tier, type) (llm_billed_tokens{provider="openai"}) or on() vector(0)',
          legend: "{{account}} {{model}} {{service_tier}} {{type}}",
        },
      ],
      gridPos: { x: 0, y: 74, w: 12, h: 8 },
      unit: "short",
    }),
  );

  builder.withPanel(
    createTimeseriesPanel({
      title: "Billed Reconciliation Freshness",
      description:
        "Seconds since the last successful billed-cost reconciliation per provider. LlmBilledReconciliationStale fires past two hours.",
      targets: [
        {
          query:
            "time() - max by (provider) (llm_billed_reconciliation_last_success_timestamp_seconds)",
          legend: "{{provider}} last success age",
        },
      ],
      gridPos: { x: 12, y: 74, w: 12, h: 8 },
      unit: "s",
    }),
  );

  builder.withRow(
    new dashboard.RowBuilder("Attribution").gridPos({
      x: 0,
      y: 82,
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
 * window, query Loki for `llm.provider.response` records carrying
 * `catalogCostUsd` and join them to these spans on `traceId`.
 */
const ATTRIBUTION_NOTE =
  "Selects gen_ai.* spans, which carry both the subject and the usage: OpenTelemetry does not inherit attributes down a trace, so a query matching the attribution span above them would find no tokens to sum, and would count one span per interaction rather than one per model call. Subject ids are span attributes, never metric labels, so this panel reads Tempo and inherits Tempo's 30-day retention and 3h metrics-query cap. For spend over a longer window, join Loki's llm.provider.response cost records to these spans on traceId.";

function createSubjectTokenPanel() {
  return new timeseries.PanelBuilder()
    .title("Output Tokens by Subject")
    .description(
      `Output tokens per model call, grouped by who the call was made on behalf of. ${ATTRIBUTION_NOTE}`,
    )
    .datasource(TEMPO_DATASOURCE)
    .withTarget(
      new tempo.TempoQueryBuilder()
        .queryType("traceql")
        .metricsQueryType(tempo.MetricsQueryType.Range)
        .query(
          '{span.gen_ai.operation.name != "" && span.llm.subject.id != ""} | sum_over_time(span.gen_ai.usage.output_tokens) by (span.llm.subject.kind, span.llm.subject.id)',
        ),
    )
    .unit("short")
    .lineWidth(2)
    .fillOpacity(10)
    .gridPos({ x: 0, y: 83, w: 12, h: 8 });
}

function createSubjectCallPanel() {
  return new timeseries.PanelBuilder()
    .title("Attributed Calls by Subject Kind")
    .description(
      `Model calls by subject kind. A rising \`system\` share means spend is shifting to scheduled work with no requester, which is expected for match reviews and betting but not for interactive features. ${ATTRIBUTION_NOTE}`,
    )
    .datasource(TEMPO_DATASOURCE)
    .withTarget(
      new tempo.TempoQueryBuilder()
        .queryType("traceql")
        .metricsQueryType(tempo.MetricsQueryType.Range)
        .query(
          '{span.gen_ai.operation.name != "" && span.llm.subject.kind != ""} | count_over_time() by (span.llm.subject.kind)',
        ),
    )
    .unit("short")
    .lineWidth(2)
    .fillOpacity(10)
    .gridPos({ x: 12, y: 83, w: 12, h: 8 });
}
