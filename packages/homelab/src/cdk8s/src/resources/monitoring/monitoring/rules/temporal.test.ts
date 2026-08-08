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

  test("alerts on agent-task poller and schedule-to-start health", () => {
    const failuresGroup = getTemporalRuleGroups().find(
      (group) => group.name === "temporal-workflow-failures",
    );
    if (failuresGroup?.rules === undefined) {
      throw new Error("Missing temporal-workflow-failures rule group");
    }

    const pollerUnavailable = failuresGroup.rules.find(
      (rule) => rule.alert === "TemporalAgentTaskWorkflowPollerUnavailable",
    );
    if (pollerUnavailable === undefined) {
      throw new Error(
        "Missing TemporalAgentTaskWorkflowPollerUnavailable alert",
      );
    }
    expect(pollerUnavailable.expr.value).toContain(
      "temporal_worker_num_pollers",
    );
    expect(pollerUnavailable.for).toBe("5m");

    const scheduleToStartHigh = failuresGroup.rules.find(
      (rule) =>
        rule.alert === "TemporalAgentTaskWorkflowTaskScheduleToStartHigh",
    );
    if (scheduleToStartHigh === undefined) {
      throw new Error(
        "Missing TemporalAgentTaskWorkflowTaskScheduleToStartHigh alert",
      );
    }
    expect(scheduleToStartHigh.expr.value).toContain(
      "temporal_worker_workflow_task_schedule_to_start_latency_seconds_bucket",
    );
    expect(scheduleToStartHigh.for).toBe("5m");

    const workerMetricsDown = failuresGroup.rules.find(
      (rule) => rule.alert === "TemporalWorkerMetricsDown",
    );
    if (workerMetricsDown === undefined) {
      throw new Error("Missing TemporalWorkerMetricsDown alert");
    }
    expect(workerMetricsDown.for).toBe("5m");
  });

  test("does not emit the removed aggregate agent-task timeout alerts", () => {
    const alerts = getTemporalRuleGroups()
      .flatMap((group) => group.rules ?? [])
      .map((rule) => rule.alert);
    expect(alerts).not.toContain("TemporalAgentTaskTimingOut");
    expect(alerts).not.toContain("TemporalAgentTaskTimeoutScanFailed");
  });
});

describe("Scout Data Dragon failure rules", () => {
  test("ScoutDataDragonAutoMergeFailed alerts on the last-failure recency gauge", () => {
    const expression = findFailureRule("ScoutDataDragonAutoMergeFailed");
    // Recency gauge + age-out window, so the alert fires on the first failure
    // AND clears 24h later — a bare counter can't do both (increase() misses the
    // first born-at-1 failure; max_over_time(counter) never ages out).
    //
    // The `_s` suffix is required: the gauge has unit "s" and the worker's
    // exporter runs with unitSuffix:true, so the exported series is
    // `..._timestamp_s`. Querying the bare name matched nothing and the alert
    // never fired — this asserts the suffixed name so the regression can't recur.
    expect(expression).toContain(
      "scout_data_dragon_auto_merge_last_failure_timestamp_s",
    );
    expect(expression).not.toContain(
      "scout_data_dragon_auto_merge_last_failure_timestamp[",
    );
    expect(expression).toContain("time() -");
    expect(expression).toContain("60 * 60 * 24");
    // Read through a 24h max_over_time range, not a bare instant vector, so a
    // single-replica worker restart doesn't stale the series and wrongly clear
    // the alert.
    expect(expression).toContain(
      "max_over_time(scout_data_dragon_auto_merge_last_failure_timestamp_s[24h])",
    );
    expect(expression).not.toContain("increase(");
  });

  test("ScoutDataDragonPrAutomationFailed no longer references the unreachable pr-merge-failed reason", () => {
    const expression = findFailureRule("ScoutDataDragonPrAutomationFailed");
    expect(expression).not.toContain("pr-merge-failed");
    expect(expression).toContain("git-push-failed|pr-create-failed");
  });
});
