import { describe, expect, test } from "vitest";
import {
  BUCKS_RECONCILIATION_CRON,
  BUCKS_RECONCILIATION_TRANSACTION_TIMEOUT_MS,
} from "#src/betting/settlement/reconcile.ts";

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

  test("allows the full-history snapshot to outlive Prisma's default", () => {
    expect(BUCKS_RECONCILIATION_TRANSACTION_TIMEOUT_MS).toBe(300_000);
  });
});
