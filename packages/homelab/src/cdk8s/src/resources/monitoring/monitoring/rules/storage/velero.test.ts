import { describe, expect, it } from "vitest";
import { getVeleroRuleGroups } from "./velero.ts";

describe("Velero large PVC backup policy alerts", () => {
  it("does not emit the obsolete size-based manual-review alert", () => {
    const groups = getVeleroRuleGroups();
    const alerts = groups.flatMap((group) => group.rules ?? []);
    expect(
      alerts.some((rule) => rule.alert === "VeleroLargePVCMayImpactBackups"),
    ).toBe(false);
  });
});

describe("Velero R2 orphan alerts", () => {
  it("emits prefix, bytes, and freshness alerts for the R2 audit", () => {
    const groups = getVeleroRuleGroups();
    const alerts = groups.flatMap((group) => group.rules ?? []);
    const names = new Set(alerts.map((rule) => rule.alert));
    expect(names.has("VeleroR2OrphanPrefixes")).toBe(true);
    expect(names.has("VeleroR2OrphanBytesExcessive")).toBe(true);
    expect(names.has("VeleroR2OrphanAuditNotRunning")).toBe(true);
  });
});
