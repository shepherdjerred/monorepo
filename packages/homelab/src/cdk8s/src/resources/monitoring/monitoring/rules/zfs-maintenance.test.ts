import { describe, expect, it } from "bun:test";
import { getZfsMaintenanceRuleGroups } from "./zfs-maintenance.ts";

describe("ZfsScrubOverdue", () => {
  it("fires for pools that have never recorded a completed scrub or are overdue", () => {
    const group = getZfsMaintenanceRuleGroups().find(
      (candidate) => candidate.name === "zfs-maintenance",
    );
    if (group?.rules === undefined) {
      throw new Error("expected zfs-maintenance rules");
    }

    const alert = group.rules.find((rule) => rule.alert === "ZfsScrubOverdue");
    if (alert === undefined) {
      throw new Error("expected ZfsScrubOverdue alert");
    }

    expect(alert.expr.value).toBe(
      "time() - zfs_zpool_last_scrub_completion_timestamp > 777600",
    );
  });
});
