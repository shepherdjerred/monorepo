import { describe, expect, test } from "bun:test";
import { BUCKS_RECONCILIATION_CRON } from "#src/betting/reconcile.ts";

describe("Bryan Bucks reconciliation schedule", () => {
  test("runs at startup and every day at 05:00 UTC", () => {
    expect(BUCKS_RECONCILIATION_CRON).toEqual({
      schedule: "0 0 5 * * *",
      jobName: "bryan_bucks_reconciliation",
      logMessage: "🧾 Reconciling Bryan Bucks accounting",
      timezone: "UTC",
      runOnInit: true,
    });
  });
});
