import { expect, test } from "vitest";
import {
  getLlmRuleGroups,
  LLM_DAILY_SPEND_CRITICAL_USD,
  LLM_DAILY_SPEND_WARNING_USD,
  LLM_WORKLOAD_SPIKE_FLOOR_USD_PER_HOUR,
  LLM_WORKLOAD_SPIKE_RATIO,
} from "./llm.ts";

function allRules() {
  return getLlmRuleGroups().flatMap(({ rules: groupRules }) => groupRules);
}

function alertNamed(name: string) {
  return allRules().find((rule) => rule?.alert === name);
}

test("keeps LLM recording and runtime alert coverage together", () => {
  const serialized = JSON.stringify(getLlmRuleGroups());
  expect(serialized).toContain("llm:requests:rate5m");
  expect(serialized).toContain("llm:cost_usd:rate5m");
  expect(serialized).toContain("llm:request_duration:p95_5m");
  expect(serialized).toContain("LlmStructuredOutputExhausted");
  expect(serialized).toContain("birmel_admission_classifier_total");
  expect(serialized).toContain("birmel_memory_extraction_total");

  // Every OpenRouter-era signal is gone with the router: its metrics are no
  // longer emitted, so a surviving rule would sit silently at zero.
  for (const retired of [
    "openrouter",
    "byok",
    'type="actual"',
    "upstream",
    "llm:cost_discrepancy:rate5m",
    "openai_usage_reconciliation_last_success_timestamp_seconds",
  ]) {
    expect(serialized.toLowerCase()).not.toContain(retired.toLowerCase());
  }

  for (const alertName of [
    "BirmelAdmissionClassifierErrors",
    "BirmelMemoryExtractionErrors",
  ]) {
    expect(alertNamed(alertName)?.labels).toEqual({
      severity: "warning",
      category: "llm",
    });
  }
});

test("alerts on live and provider-billed LLM spend", () => {
  for (const [name, severity] of [
    ["LlmDailySpendHigh", "warning"],
    ["LlmDailySpendCritical", "critical"],
    ["LlmBilledSpendHigh", "warning"],
    ["LlmBilledSpendCritical", "critical"],
    ["LlmWorkloadCostSpike", "warning"],
    ["LlmBilledReconciliationStale", "warning"],
  ] as const) {
    expect(alertNamed(name)?.labels).toEqual({ severity, category: "llm" });
  }

  // The critical tier must sit above the warning tier, or the warning alert is
  // unreachable and the ceiling silently becomes a single threshold.
  expect(LLM_DAILY_SPEND_CRITICAL_USD).toBeGreaterThan(
    LLM_DAILY_SPEND_WARNING_USD,
  );
  for (const [name, ceiling] of [
    ["LlmDailySpendHigh", LLM_DAILY_SPEND_WARNING_USD],
    ["LlmBilledSpendHigh", LLM_DAILY_SPEND_WARNING_USD],
    ["LlmDailySpendCritical", LLM_DAILY_SPEND_CRITICAL_USD],
    ["LlmBilledSpendCritical", LLM_DAILY_SPEND_CRITICAL_USD],
  ] as const) {
    expect(alertNamed(name)?.expr?.value).toContain(`> ${ceiling.toString()}`);
  }

  // Live alerts price provider-reported tokens from the catalog; billed alerts
  // read what the providers report they will charge. Mixing the two in one
  // expression would double count.
  for (const liveAlert of [
    "LlmDailySpendHigh",
    "LlmDailySpendCritical",
    "LlmWorkloadCostSpike",
  ]) {
    const expr = alertNamed(liveAlert)?.expr?.value;
    expect(expr).toContain('llm_cost_usd_total{type="catalog"}');
    expect(expr).not.toContain("llm_billed_cost_usd");
    // These series carry `pod`, so the per-workload sum must collapse pod
    // lifetimes across a deploy rather than keep only one of them.
    expect(expr).toContain("sum by (service, workload, model)");
  }
  for (const billedAlert of ["LlmBilledSpendHigh", "LlmBilledSpendCritical"]) {
    const expr = alertNamed(billedAlert)?.expr?.value;
    expect(expr).toContain('llm_billed_cost_usd{window="today"}');
    expect(expr).not.toContain("llm_cost_usd_total");
  }

  // The spike alert needs both halves: a ratio alone fires on any burst from a
  // workload that costs fractions of a cent.
  const spike = alertNamed("LlmWorkloadCostSpike")?.expr?.value;
  expect(spike).toContain(`> ${LLM_WORKLOAD_SPIKE_RATIO.toString()} *`);
  expect(spike).toContain(
    `* 3600 > ${LLM_WORKLOAD_SPIKE_FLOOR_USD_PER_HOUR.toString()}`,
  );
});

test("detects a billed reconciliation that stopped succeeding", () => {
  const stale = alertNamed("LlmBilledReconciliationStale")?.expr?.value;
  // The worker scrape is identified by container, not by a pod-name regex
  // that breaks on the next ReplicaSet hash format.
  expect(stale).toContain(
    'namespace="temporal",container="temporal-billing-worker"',
  );
  expect(stale).not.toContain("pod=~");
  expect(stale).toContain(
    "llm_billed_reconciliation_last_success_timestamp_seconds",
  );
  // Without `absent`, a worker that never once succeeded has no series and the
  // staleness comparison can never fire.
  expect(stale).toContain("absent(");
  // The uptime side has no provider label; a plain `and` would never match.
  expect(stale).toContain("and on()");
});
