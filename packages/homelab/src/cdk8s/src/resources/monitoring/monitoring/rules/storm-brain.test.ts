import { expect, test } from "vitest";
import type { PrometheusRuleSpecGroups } from "@shepherdjerred/homelab/cdk8s/generated/imports/monitoring.coreos.com";
import {
  getStormBrainRuleGroups,
  STORM_BRAIN_COST_FLOOR_MICROS_PER_HOUR,
  STORM_BRAIN_COST_SPIKE_RATIO,
  STORM_BRAIN_LATENCY_P95_SECONDS,
} from "./storm-brain.ts";

function alert(groups: PrometheusRuleSpecGroups[], name: string): string {
  const rules = groups.flatMap(({ rules: groupRules }) => groupRules);
  return String(rules.find((rule) => rule?.alert === name)?.expr?.value);
}

test("keeps all five StormBrain alerts together", () => {
  const serialized = JSON.stringify(getStormBrainRuleGroups());
  expect(serialized).toContain("StormBrainCostSpike");
  expect(serialized).toContain("StormBrainLatencyHigh");
  expect(serialized).toContain("StormBrainRequestErrors");
  expect(serialized).toContain("StormBrainRequestsRejected");
  expect(serialized).toContain("StormBrainTargetDown");
});

test("cost spike compares hourly burn against its own baseline", () => {
  const expr = alert(getStormBrainRuleGroups(), "StormBrainCostSpike");
  expect(expr).toContain("storm_brain_cost_micros_total[1h]");
  expect(expr).toContain("storm_brain_cost_micros_total[24h]");
  expect(expr).toContain(`${STORM_BRAIN_COST_SPIKE_RATIO.toString()} *`);
  expect(expr).toContain(STORM_BRAIN_COST_FLOOR_MICROS_PER_HOUR.toString());
});

test("latency watches p95 request duration", () => {
  const expr = alert(getStormBrainRuleGroups(), "StormBrainLatencyHigh");
  expect(expr).toContain("storm_brain_request_duration_seconds_bucket");
  expect(expr).toContain(STORM_BRAIN_LATENCY_P95_SECONDS.toString());
});

test("errors fire on failures but never on steady states", () => {
  const groups = getStormBrainRuleGroups();
  const errors = alert(groups, "StormBrainRequestErrors");
  expect(errors).toContain(
    'storm_brain_requests_total{outcome=~"error|upstream_error"}',
  );
  // Disabled is a Flipt-off flow, not a failure.
  expect(errors).not.toContain("disabled");

  const rejected = alert(groups, "StormBrainRequestsRejected");
  expect(rejected).toContain(
    'storm_brain_requests_total{outcome=~"invalid|unauthorized"}',
  );
});

test("target down watches the declared service metrics endpoint", () => {
  const expr = alert(getStormBrainRuleGroups(), "StormBrainTargetDown");
  expect(expr).toContain(
    'namespace="storm-brain",service="storm-brain-storm-brain-service",endpoint="metrics"',
  );
});
