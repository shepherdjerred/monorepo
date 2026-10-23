import { describe, expect, it } from "vitest";
import {
  getNvmeRuleGroups,
  NVME_DRIVE_WRITE_BUDGET_BYTES_PER_DAY,
  NVME_DRIVE_WRITTEN_BYTES_24H,
  NVME_DRIVE_WRITTEN_BYTES_PER_DAY_7D,
} from "./nvme.ts";
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

// A raw node-exporter nvme_* family, not a recorded `nvme_drive:` series.
const RAW_NVME_METRIC = /(?<![\w:])nvme_[a-z_]+(?![\w:])/g;

function readsRawNvmeMetric(expression: string): boolean {
  return [...expression.matchAll(RAW_NVME_METRIC)].some(
    ([metric]) => metric !== "nvme_device_info",
  );
}

describe("stable storage-device identity joins", () => {
  it("keys NVMe identity by device and scrape instance", () => {
    const rules = getNvmeRuleGroups()
      .flatMap((group) => group.rules ?? [])
      .map((rule) => String(rule.expr.value))
      .filter((expression) => readsRawNvmeMetric(expression));
    expect(rules.length).toBeGreaterThan(0);
    for (const expression of rules) {
      expect(expression).toContain("on(device, instance)");
      expect(expression).toContain(
        "group_left(serial, model) nvme_device_info",
      );
      expect(expression).not.toMatch(/on\(device\)(?!,)/);
    }
  });

  it("keeps every NVMe alert on a serial-identified series", () => {
    const alerts = alertExpressions(getNvmeRuleGroups());
    expect(alerts.length).toBeGreaterThan(0);
    for (const expression of alerts) {
      // Either joins identity itself or reads only recorded drive series,
      // whose recording rules carry the join (checked above).
      expect(
        expression.includes("group_left(serial, model) nvme_device_info") ||
          !readsRawNvmeMetric(expression),
        expression,
      ).toBe(true);
    }
  });

  it("keys NVMe wear-velocity ranges by serial, not device", () => {
    const rules = getNvmeRuleGroups().flatMap((group) => group.rules ?? []);
    const velocityRules = [
      NVME_DRIVE_WRITTEN_BYTES_24H,
      NVME_DRIVE_WRITTEN_BYTES_PER_DAY_7D,
      "NvmeWearOutProjectedWithinYear",
      "NvmeWearOutProjectedWithinSixMonths",
    ];
    for (const name of velocityRules) {
      const rule = rules.find(
        (candidate) => candidate.alert === name || candidate.record === name,
      );
      expect(rule, name).toBeDefined();
      const expression = String(rule?.expr.value);
      expect(expression).toContain("max by (node, instance, serial, model)");
      expect(expression).toMatch(/\)\[\d+[dh]:\d+[mh]\]/);
    }
  });

  it("replaces the flat drive-writes-per-day limit with a per-drive budget", () => {
    const rules = getNvmeRuleGroups().flatMap((group) => group.rules ?? []);
    expect(
      rules.find((rule) => rule.alert === "NvmeWriteRateAboveEndurance"),
    ).toBeUndefined();
    const budget = rules.find(
      (rule) => rule.alert === "NvmeWriteBudgetExceeded",
    );
    expect(String(budget?.expr.value)).toBe(
      `${NVME_DRIVE_WRITTEN_BYTES_24H} > on(node, instance, serial, model) ${NVME_DRIVE_WRITE_BUDGET_BYTES_PER_DAY}`,
    );
    // No drive filter: OS disks are budgeted like pool disks.
    expect(String(budget?.expr.value)).not.toContain("serial=");
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
