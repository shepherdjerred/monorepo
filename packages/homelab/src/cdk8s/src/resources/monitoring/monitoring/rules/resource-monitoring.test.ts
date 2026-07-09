import { describe, expect, it } from "bun:test";
import { getResourceMonitoringRuleGroups } from "./resource-monitoring.ts";

describe("CriticalSystemLoad alert", () => {
  it("fires on node_load1, not the slower node_load15 UnusualSystemLoad uses", () => {
    const groups = getResourceMonitoringRuleGroups();
    const cpuGroup = groups.find(
      (group) => group.name === "resource-security-monitoring",
    );
    if (cpuGroup === undefined) {
      throw new Error("expected resource-security-monitoring rule group");
    }

    const alert = cpuGroup.rules.find(
      (rule) => rule.alert === "CriticalSystemLoad",
    );
    if (alert === undefined) {
      throw new Error("expected CriticalSystemLoad alert");
    }

    expect(alert.expr).toBe(
      'node_load1 > 8 * count by (instance) (node_cpu_seconds_total{mode="idle"})',
    );
    expect(alert.for).toBe("2m");
    expect(alert.labels?.["severity"]).toBe("critical");
  });

  it("keeps the existing slower UnusualSystemLoad alert as a separate, lower-severity signal", () => {
    const groups = getResourceMonitoringRuleGroups();
    const cpuGroup = groups.find(
      (group) => group.name === "resource-security-monitoring",
    );
    if (cpuGroup === undefined) {
      throw new Error("expected resource-security-monitoring rule group");
    }

    const alert = cpuGroup.rules.find(
      (rule) => rule.alert === "UnusualSystemLoad",
    );
    if (alert === undefined) {
      throw new Error("expected UnusualSystemLoad alert to still exist");
    }
    expect(JSON.stringify(alert)).toContain("node_load15");
  });
});
