import type { PrometheusRuleSpecGroups } from "@shepherdjerred/homelab/cdk8s/generated/imports/monitoring.coreos.com";
import { PrometheusRuleSpecGroupsRulesExpr } from "@shepherdjerred/homelab/cdk8s/generated/imports/monitoring.coreos.com";
import { escapePrometheusTemplate } from "./shared.ts";

export function getLlmRuleGroups(): PrometheusRuleSpecGroups[] {
  return [
    {
      name: "llm.recording",
      interval: "30s",
      rules: [
        {
          record: "llm:requests:rate5m",
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            "sum by (service, workload, provider, model, outcome) (rate(llm_requests_total[5m]))",
          ),
        },
        {
          record: "llm:cost_usd:rate5m",
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            "sum by (service, workload, provider, model, type) (rate(llm_cost_usd_total[5m]))",
          ),
        },
        {
          record: "llm:request_duration:p95_5m",
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            "histogram_quantile(0.95, sum by (le, service, workload, provider, model) (rate(llm_request_duration_seconds_bucket[5m])))",
          ),
        },
      ],
    },
    {
      name: "llm.alerts",
      interval: "30s",
      rules: [
        {
          alert: "LlmOpenRouterMetadataMissing",
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            "sum(increase(llm_openrouter_metadata_missing_total[15m])) > 0",
          ),
          for: "5m",
          labels: { severity: "warning", category: "llm" },
          annotations: {
            summary: "OpenRouter responses are missing router metadata",
            description: escapePrometheusTemplate(
              "At least one successful OpenRouter JSON response or final SSE chunk lacked router metadata for 5 minutes. Generation cost may still be available, but upstream provider, region, and fallback evidence are incomplete. Check OpenRouter Broadcast and application logs before treating provider attribution as authoritative.",
            ),
          },
        },
        {
          alert: "LlmStructuredOutputExhausted",
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            'sum(increase(llm_structured_output_attempts_total{outcome="exhausted"}[15m])) > 0',
          ),
          labels: { severity: "warning", category: "llm" },
          annotations: {
            summary: "Structured LLM output exhausted all semantic attempts",
            description: escapePrometheusTemplate(
              "generateValidatedObject exhausted its bounded semantic repair attempts. Every attempt was traced and charged; inspect the correlated workload span and archived redacted output instead of replaying an effectful workflow.",
            ),
          },
        },
        {
          alert: "BirmelAdmissionClassifierErrors",
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            'sum(increase(birmel_admission_classifier_total{outcome="error"}[15m])) > 0',
          ),
          labels: { severity: "warning", category: "llm" },
          annotations: {
            summary: "Birmel admission classification is failing closed",
            description: escapePrometheusTemplate(
              "At least one ambiguous Birmel follow-up could not be classified in the last 15 minutes. Direct mentions, replies, sessions, and learned aliases remain deterministic; inspect the admission span and schema or provider error before widening admission.",
            ),
          },
        },
        {
          alert: "BirmelMemoryExtractionErrors",
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            'sum(increase(birmel_memory_extraction_total{outcome="error"}[15m])) > 0',
          ),
          labels: { severity: "warning", category: "llm" },
          annotations: {
            summary: "Birmel post-response memory extraction is failing",
            description: escapePrometheusTemplate(
              "At least one delivered Birmel turn failed post-response memory extraction in the last 15 minutes. The Discord response was already delivered; inspect the correlated memory extraction span and structured-output error before treating continuity as healthy.",
            ),
          },
        },
        {
          alert: "OpenRouterBroadcastPipelineFailure",
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            'sum(increase(openrouter_broadcast_requests_total{outcome=~"archive_error|forward_error"}[10m])) > 0',
          ),
          labels: { severity: "critical", category: "llm" },
          annotations: {
            summary: "OpenRouter Broadcast archival or Tempo forwarding failed",
            description: escapePrometheusTemplate(
              "The Broadcast endpoint returned failure because the full redacted OTLP payload was not durably archived or the body-free trace was not forwarded to Tempo. OpenRouter will redeliver; inspect openrouter_broadcast_operations_total and service logs before rotating credentials.",
            ),
          },
        },
        {
          alert: "OpenRouterBroadcastTargetDown",
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            'absent(up{namespace="openrouter-broadcast-ingest",service="openrouter-broadca-openrouter-broadcast-ingest-service"}) or max(up{namespace="openrouter-broadcast-ingest",service="openrouter-broadca-openrouter-broadcast-ingest-service"}) == 0',
          ),
          for: "5m",
          labels: { severity: "critical", category: "llm" },
          annotations: {
            summary: "OpenRouter Broadcast ingest is not scrapeable",
            description: escapePrometheusTemplate(
              "Prometheus has been unable to scrape the dedicated Broadcast metrics endpoint for 5 minutes. The public webhook may also be unavailable; check the deployment, ServiceMonitor, NetworkPolicy, and Cloudflare tunnel probe.",
            ),
          },
        },
      ],
    },
  ];
}
