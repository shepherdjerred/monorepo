import { expect, test } from "vitest";
import {
  getLlmRuleGroups,
  LLM_DAILY_SPEND_CRITICAL_USD,
  LLM_DAILY_SPEND_WARNING_USD,
  LLM_WORKLOAD_SPIKE_FLOOR_USD_PER_HOUR,
  LLM_WORKLOAD_SPIKE_RATIO,
} from "./llm.ts";

test("keeps LLM recording and Broadcast alert coverage together", () => {
  const groups = getLlmRuleGroups();
  const serialized = JSON.stringify(groups);
  expect(serialized).toContain("llm:requests:rate5m");
  expect(serialized).toContain("llm:request_duration:p95_5m");
  expect(serialized).toContain("LlmOpenRouterMetadataMissing");
  expect(serialized).toContain("ScoutOpenAiNotByok");
  expect(serialized).toContain("OpenAiComplimentaryMonitorStale");
  expect(serialized).toContain("llm_openrouter_byok_requests_total");
  expect(serialized).toContain(
    "openai_usage_reconciliation_last_success_timestamp_seconds",
  );
  expect(serialized).toContain("LlmStructuredOutputExhausted");
  expect(serialized).toContain("birmel_admission_classifier_total");
  expect(serialized).toContain("birmel_memory_extraction_total");
  expect(serialized).toContain("OpenRouterBroadcastPipelineFailure");
  expect(serialized).toContain("OpenRouterBroadcastTargetDown");

  const rules = groups.flatMap(({ rules: groupRules }) => groupRules);

  const targetDown = rules.find(
    (rule) => rule?.alert === "OpenRouterBroadcastTargetDown",
  );
  expect(targetDown?.expr?.value).toContain(
    'service="openrouter-broadca-openrouter-broadcast-ingest-service"',
  );
  expect(targetDown?.expr?.value).not.toContain(
    'service="openrouter-broadcast-ingest-service"',
  );

  for (const alertName of [
    "BirmelAdmissionClassifierErrors",
    "BirmelMemoryExtractionErrors",
  ]) {
    const alert = rules.find((rule) => rule?.alert === alertName);
    expect(alert?.labels).toEqual({ severity: "warning", category: "llm" });
  }
});

test("alerts on LLM spend and on a silent Broadcast webhook", () => {
  const rules = getLlmRuleGroups().flatMap(
    ({ rules: groupRules }) => groupRules,
  );
  const alertNamed = (name: string) =>
    rules.find((rule) => rule?.alert === name);

  for (const [name, severity] of [
    ["LlmDailySpendHigh", "warning"],
    ["LlmDailySpendCritical", "critical"],
    ["LlmWorkloadCostSpike", "warning"],
    ["OpenRouterBroadcastSilent", "warning"],
  ] as const) {
    expect(alertNamed(name)?.labels).toEqual({ severity, category: "llm" });
  }

  // The critical tier must sit above the warning tier, or the warning alert is
  // unreachable and the ceiling silently becomes a single threshold.
  expect(LLM_DAILY_SPEND_CRITICAL_USD).toBeGreaterThan(
    LLM_DAILY_SPEND_WARNING_USD,
  );
  expect(alertNamed("LlmDailySpendHigh")?.expr?.value).toContain(
    `> ${LLM_DAILY_SPEND_WARNING_USD.toString()}`,
  );
  expect(alertNamed("LlmDailySpendCritical")?.expr?.value).toContain(
    `> ${LLM_DAILY_SPEND_CRITICAL_USD.toString()}`,
  );

  // Every cost alert must use the same billed-cost convention. BYOK routes bill
  // nothing through OpenRouter and report `actual` of exactly zero, so an
  // actual-only expression misses the largest line item in the fleet -- and for
  // the spike alert would hold both the ratio and the floor at zero, making it
  // structurally incapable of firing for that class of workload.
  const costAlerts = [
    "LlmDailySpendHigh",
    "LlmDailySpendCritical",
    "LlmWorkloadCostSpike",
  ];
  for (const costAlert of costAlerts) {
    const expr = alertNamed(costAlert)?.expr?.value;
    expect(expr).toContain('type=~"actual|upstream"');
    expect(expr).not.toContain('type="actual"');

    // Ordering is the correctness property, not merely the presence of both
    // aggregations. These series carry `pod`, so a deploy inside the window
    // leaves two counter series per workload; selecting the maximum before
    // summing them keeps only the longer-lived pod and silently understates
    // spend. The per-type sum must therefore appear *inside* the max.
    // `expr.value` is typed `string | number`, so narrow before searching it
    // rather than letting an unexpected numeric expression silently skip the
    // ordering assertions below.
    expect(typeof expr).toBe("string");
    const rendered = typeof expr === "string" ? expr : "";
    const maxAt = rendered.indexOf("max by (service, workload, model)");
    const sumAt = rendered.indexOf("sum by (service, workload, model, type)");
    expect(maxAt).toBeGreaterThanOrEqual(0);
    expect(sumAt).toBeGreaterThan(maxAt);
  }

  // The spike alert needs both halves: a ratio alone fires on any burst from a
  // workload that costs fractions of a cent.
  const spike = alertNamed("LlmWorkloadCostSpike")?.expr?.value;
  expect(spike).toContain(`> ${LLM_WORKLOAD_SPIKE_RATIO.toString()} *`);
  expect(spike).toContain(
    `* 3600 > ${LLM_WORKLOAD_SPIKE_FLOOR_USD_PER_HOUR.toString()}`,
  );

  // Uptime gating is what keeps a pod restart, which zeroes the gauge, from
  // alerting before the service has had a day to receive a delivery.
  const silent = alertNamed("OpenRouterBroadcastSilent")?.expr?.value;
  expect(silent).toContain(
    "openrouter_broadcast_ingest_process_start_time_seconds",
  );
  expect(silent).toContain(
    "openrouter_broadcast_last_success_timestamp_seconds",
  );

  expect(JSON.stringify(getLlmRuleGroups())).toContain(
    "llm:cost_discrepancy:rate5m",
  );
});
