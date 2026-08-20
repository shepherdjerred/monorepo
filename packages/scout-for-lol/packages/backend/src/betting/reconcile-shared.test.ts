import { describe, expect, test } from "bun:test";
import {
  BUCKS_RECONCILIATION_FINDING_LIMIT,
  BucksAuditCollector,
  auditFinding,
} from "#src/betting/reconcile-shared.ts";

describe("BucksAuditCollector", () => {
  test("counts every finding while retaining a bounded diagnostic sample", () => {
    const collector = new BucksAuditCollector();
    for (
      let index = 0;
      index < BUCKS_RECONCILIATION_FINDING_LIMIT + 2;
      index += 1
    ) {
      collector.push(
        auditFinding(
          index % 2 === 0 ? "balance_sum" : "running_balance",
          `finding ${index.toString()}`,
        ),
      );
    }

    expect(collector.totalCount).toBe(BUCKS_RECONCILIATION_FINDING_LIMIT + 2);
    expect(collector.retained).toHaveLength(BUCKS_RECONCILIATION_FINDING_LIMIT);
    expect(collector.findingKinds).toEqual(["balance_sum", "running_balance"]);
  });
});
