import * as dashboard from "@grafana/grafana-foundation-sdk/dashboard";
import { createTimeseriesPanel } from "./ai-provider-dashboard-panels.ts";

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
        "Actual OpenRouter or Claude SDK cost, canonical catalog cost, and upstream inference cost. The discrepancy series is actual minus catalog cost.",
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
        "Rolling 24h billed spend per workload. Takes the per-series maximum of OpenRouter's charged cost and upstream inference cost so BYOK routes, which bill nothing through OpenRouter and would read as $0 under an actual-only query, are still counted.",
      targets: [
        {
          query: `topk(10, sum by (service, workload) (max by (service, workload, model) (increase(llm_cost_usd_total{${llmFilter},type=~"actual|upstream"}[24h])))) or on() vector(0)`,
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
}
