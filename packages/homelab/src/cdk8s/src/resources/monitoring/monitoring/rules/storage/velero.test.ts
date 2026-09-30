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
