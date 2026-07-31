import { describe, expect, test } from "bun:test";
import { getTemporalRuleGroups } from "./temporal.ts";

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
