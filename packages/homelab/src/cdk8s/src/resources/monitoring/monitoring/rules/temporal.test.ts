import { describe, expect, test } from "bun:test";
import { getTemporalRuleGroups } from "./temporal.ts";

function findFailureRule(alertName: string): string {
  const failureGroup = getTemporalRuleGroups().find(
    (group) => group.name === "temporal-workflow-failures",
  );
  if (failureGroup?.rules === undefined) {
    throw new Error("Missing temporal-workflow-failures rule group");
  }
  const rule = failureGroup.rules.find((r) => r.alert === alertName);
  if (rule === undefined) {
    throw new Error(`Missing ${alertName} rule`);
  }
  const expression = rule.expr.value;
  if (typeof expression !== "string") {
    throw new TypeError(`Expected ${alertName} rule expression to be a string`);
  }
  return expression;
}

describe("Temporal workflow outcome rules", () => {
  test("excludes intentional warm-morning preheat skips", () => {
    const outcomeGroup = getTemporalRuleGroups().find(
      (group) => group.name === "temporal-workflow-outcomes",
    );
    if (outcomeGroup?.rules === undefined) {
      throw new Error("Missing temporal-workflow-outcomes rule group");
    }

    const preheatRule = outcomeGroup.rules.find((rule) => {
      const expression = rule.expr.value;
      return (
        typeof expression === "string" &&
        expression.includes('workflow="goodMorningPreheat"')
      );
    });
    if (preheatRule === undefined) {
      throw new Error("Missing goodMorningPreheat outcome rule");
    }

    const expression = preheatRule.expr.value;
    if (typeof expression !== "string") {
      throw new TypeError(
        "Expected goodMorningPreheat rule expression to be a string",
      );
    }

    expect(expression).toContain('reason!~"no-one-home|not-cold"');
  });

  test("alerts on agent-task timeouts and on a failed timeout scan", () => {
    const failuresGroup = getTemporalRuleGroups().find(
      (group) => group.name === "temporal-workflow-failures",
    );
    if (failuresGroup?.rules === undefined) {
      throw new Error("Missing temporal-workflow-failures rule group");
    }

    const timingOut = failuresGroup.rules.find(
      (rule) => rule.alert === "TemporalAgentTaskTimingOut",
    );
    if (timingOut === undefined) {
      throw new Error("Missing TemporalAgentTaskTimingOut alert");
    }
    expect(timingOut.expr.value).toBe(
      "max(temporal_agent_task_timeouts_24h) > 0",
    );

    const scanFailed = failuresGroup.rules.find(
      (rule) => rule.alert === "TemporalAgentTaskTimeoutScanFailed",
    );
    if (scanFailed === undefined) {
      throw new Error("Missing TemporalAgentTaskTimeoutScanFailed alert");
    }
    expect(scanFailed.expr.value).toBe(
      "min(temporal_agent_task_timeouts_24h) < 0",
    );
  });
});

describe("Scout Data Dragon failure rules", () => {
  test("ScoutDataDragonAutoMergeFailed alerts on the last-failure recency gauge", () => {
    const expression = findFailureRule("ScoutDataDragonAutoMergeFailed");
    // Recency gauge + age-out window, so the alert fires on the first failure
    // AND clears 24h later. A bare counter can't do both: increase() misses the
    // first born-at-1 failure, and max_over_time() never ages out.
    expect(expression).toContain(
      "scout_data_dragon_auto_merge_last_failure_timestamp",
    );
    expect(expression).toContain("time() -");
    expect(expression).toContain("60 * 60 * 24");
    expect(expression).not.toContain("increase(");
    expect(expression).not.toContain("max_over_time");
  });

  test("ScoutDataDragonPrAutomationFailed no longer references the unreachable pr-merge-failed reason", () => {
    const expression = findFailureRule("ScoutDataDragonPrAutomationFailed");
    expect(expression).not.toContain("pr-merge-failed");
    expect(expression).toContain("git-push-failed|pr-create-failed");
  });
});
