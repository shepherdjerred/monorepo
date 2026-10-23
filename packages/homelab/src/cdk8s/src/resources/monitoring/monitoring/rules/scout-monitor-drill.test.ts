import { describe, expect, test } from "vitest";
import { ENVIRONMENT_MONITORS } from "@shepherdjerred/homelab/cdk8s/src/catalog/catalog-targets.ts";
import { getScoutRuleGroups } from "./scout.ts";
import {
  SCOUT_MONITOR_DRILL_ALERT,
  getScoutMonitorDrillRuleGroups,
  scoutMonitorDrill,
} from "./scout-monitor-drill.ts";

/** Whether an alert's labels satisfy a monitor's matchers (`~` prefixes a regex). */
function matches(
  matchers: Readonly<Record<string, string>>,
  labels: Readonly<Record<string, string>>,
): boolean {
  return Object.entries(matchers).every(([name, matcher]) => {
    const value = labels[name];
    if (value === undefined) return false;
    return matcher.startsWith("~")
      ? new RegExp(`^(?:${matcher.slice(1)})$`, "u").test(value)
      : value === matcher;
  });
}

describe("ScoutMonitorDrill", () => {
  test("is off in committed source and renders no rule", () => {
    expect(scoutMonitorDrill()).toBeNull();
    expect(
      getScoutRuleGroups().flatMap((group) =>
        (group.rules ?? []).map((rule) => rule.alert),
      ),
    ).not.toContain(SCOUT_MONITOR_DRILL_ALERT);
  });

  test.each(["beta", "prod"] as const)(
    "drilling %s fires an alarm only that environment's Scout monitor matches",
    (environment) => {
      const rules = getScoutMonitorDrillRuleGroups(environment).flatMap(
        (group) => group.rules ?? [],
      );
      expect(rules.map((rule) => rule.alert)).toEqual([
        SCOUT_MONITOR_DRILL_ALERT,
      ]);
      const [rule] = rules;
      expect(rule?.expr.value).toBe("vector(1)");
      expect(rule?.for).toBeUndefined();
      const labels: Record<string, string> = {
        alertname: rule?.alert ?? "",
        ...rule?.labels,
      };
      const { severity } = labels;
      for (const [environmentId, monitor] of Object.entries(
        ENVIRONMENT_MONITORS,
      )) {
        const own = environmentId === `scout-for-lol/${environment}`;
        expect(matches(monitor.alarms.matchers, labels), environmentId).toBe(
          own,
        );
        if (own) expect(monitor.alarms.severities).toContain(severity);
      }
    },
  );
});
