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
    if (cpuGroup.rules === undefined) {
      throw new Error("expected resource-security-monitoring rules");
    }

    const alert = cpuGroup.rules.find(
      (rule) => rule.alert === "CriticalSystemLoad",
    );
    if (alert === undefined) {
      throw new Error("expected CriticalSystemLoad alert");
    }

    // expr is the generated IntOrString wrapper class; toJson unwraps .value.
    expect(alert.expr.value).toBe(
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
    if (cpuGroup.rules === undefined) {
      throw new Error("expected resource-security-monitoring rules");
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

function securityRules() {
  const groups = getResourceMonitoringRuleGroups();
  const group = groups.find(
    (candidate) => candidate.name === "resource-security-monitoring",
  );
  if (group?.rules === undefined) {
    throw new Error("expected resource-security-monitoring rules");
  }
  return group.rules;
}

describe("crypto-mining alerts", () => {
  it("keeps the CI node out of the generic PotentialCryptoMining rule", () => {
    const alert = securityRules().find(
      (rule) => rule.alert === "PotentialCryptoMining",
    );
    if (alert === undefined) {
      throw new Error("expected PotentialCryptoMining alert");
    }
    expect(alert.expr.value).toContain('node!="liskov"');
    expect(alert.expr.value).not.toContain('node="liskov"');
    expect(alert.expr.value).toContain("sum by (instance)");
  });

  it("keeps the dedicated CI-node signal active while Buildkite jobs run", () => {
    const alert = securityRules().find(
      (rule) => rule.alert === "PotentialCryptoMiningCiNode",
    );
    if (alert === undefined) {
      throw new Error("expected PotentialCryptoMiningCiNode alert");
    }
    expect(alert.expr.value).toContain('node="liskov"');
    expect(alert.expr.value).toContain("sum by (instance)");
    expect(alert.expr.value).not.toContain('namespace="buildkite"');
    expect(alert.expr.value).not.toContain('phase="Running"');
    expect(alert.expr.value).not.toContain("absent(");
    expect(alert.for).toBe("30m");
    expect(alert.labels?.["severity"]).toBe("critical");
  });
});

describe("memory leak alerts", () => {
  it("applies the 24-hour offset to every historical memory and ARC selector", () => {
    const groups = getResourceMonitoringRuleGroups();
    const memoryGroup = groups.find(
      (group) => group.name === "resource-memory-monitoring",
    );
    if (memoryGroup?.rules === undefined) {
      throw new Error("expected resource-memory-monitoring rules");
    }

    const alert = memoryGroup.rules.find(
      (rule) => rule.alert === "MemoryLeakSuspected",
    );
    if (alert === undefined) {
      throw new Error("expected MemoryLeakSuspected alert");
    }

    expect(alert.expr.value).toBe(
      [
        "((node_memory_MemTotal_bytes - node_memory_MemAvailable_bytes) - on(instance) ",
        "group_left node_zfs_arc_size) - ((node_memory_MemTotal_bytes offset 24h - ",
        "node_memory_MemAvailable_bytes offset 24h) - on(instance) group_left ",
        "node_zfs_arc_size offset 24h) > 8589934592",
      ].join(""),
    );
  });
});
