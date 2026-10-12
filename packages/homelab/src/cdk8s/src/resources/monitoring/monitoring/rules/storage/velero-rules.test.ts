import { describe, expect, it } from "vitest";
import { getVeleroRuleGroups } from "./velero.ts";

function alertExpression(name: string): string {
  const rule = getVeleroRuleGroups()
    .flatMap((group) => group.rules ?? [])
    .find((candidate) => candidate.alert === name);
  if (rule === undefined) throw new Error(`missing alert ${name}`);
  return String(rule.expr.value);
}

describe("Velero backup duration alert", () => {
  it("counts each backup over 30 minutes instead of averaging durations", () => {
    const expression = alertExpression("VeleroBackupDurationExcessive");

    expect(expression).toContain(
      'velero_backup_duration_seconds_bucket{le="1800.0"}',
    );
    expect(expression).toContain("velero_backup_duration_seconds_count");
    expect(expression).not.toContain("velero_backup_duration_seconds_sum");
    expect(expression).not.toMatch(/velero_backup_duration_seconds\)/u);
  });
});
