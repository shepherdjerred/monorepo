import { describe, expect, it } from "vitest";
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

  it("keys NVMe wear-velocity ranges by serial, not device", () => {
    const rules = getNvmeRuleGroups().flatMap((group) => group.rules ?? []);
    const velocityAlerts = [
      "NvmeWriteRateAboveEndurance",
      "NvmeWearOutProjectedWithinYear",
      "NvmeWearOutProjectedWithinSixMonths",
    ];
    for (const alert of velocityAlerts) {
      const rule = rules.find((candidate) => candidate.alert === alert);
      expect(rule, alert).toBeDefined();
      const expression = String(rule?.expr.value);
      expect(expression).toContain("max by (instance, serial, model)");
      expect(expression).toMatch(/\)\[\d+d:1h\]/);
    }
  });

  it("normalizes NVMe write rate by drive capacity", () => {
    const rule = getNvmeRuleGroups()
      .flatMap((group) => group.rules ?? [])
      .find((candidate) => candidate.alert === "NvmeWriteRateAboveEndurance");
    const expression = String(rule?.expr.value);
    expect(expression).toContain("nvme_data_units_written_total");
    expect(expression).toContain("* 512000 / 7 /");
    expect(expression).toContain("nvme_physical_size_bytes");
    expect(expression).toMatch(/> 0\.5$/);
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
