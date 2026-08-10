import { describe, expect, it } from "bun:test";
import { getNvmeRuleGroups } from "./nvme.ts";
import { getSmartctlRuleGroups } from "./smartctl.ts";

function alertExpressions(
  groups: ReturnType<typeof getNvmeRuleGroups>,
): string[] {
  return groups.flatMap(
    (group) =>
      group.rules
        ?.filter((rule) => rule.alert !== undefined)
        .map((rule) => String(rule.expr.value)) ?? [],
  );
}

describe("stable storage-device identity joins", () => {
  it("keys NVMe identity by device and scrape instance", () => {
    const rules = alertExpressions(getNvmeRuleGroups());
    expect(rules.length).toBeGreaterThan(0);
    for (const expression of rules) {
      expect(expression).toContain("on(device, instance)");
      expect(expression).toContain(
        "group_left(serial, model) nvme_device_info",
      );
      expect(expression).not.toMatch(/on\(device\)(?!,)/);
    }
  });

  it("keys SMART identity by disk and scrape instance", () => {
    const rules = alertExpressions(getSmartctlRuleGroups());
    expect(rules.length).toBeGreaterThan(0);
    for (const expression of rules) {
      expect(expression).toContain("on(disk, instance)");
      expect(expression).toContain(
        "group_left(serial_number, device_model) smartmon_device_info",
      );
      expect(expression).not.toMatch(/on\(disk\)(?!,)/);
    }
  });
});
