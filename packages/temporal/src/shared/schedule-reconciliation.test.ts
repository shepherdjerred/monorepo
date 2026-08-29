import { describe, expect, test } from "vitest";
import { parseScheduleReconciliationMode } from "./schedule-reconciliation.ts";

describe("schedule reconciliation mode", () => {
  test("defaults to enabled for local workers", () => {
    expect(parseScheduleReconciliationMode(undefined)).toBe("enabled");
  });

  test("accepts the migration-safe disabled mode", () => {
    expect(parseScheduleReconciliationMode("disabled")).toBe("disabled");
  });

  test("rejects unknown modes", () => {
    expect(() => parseScheduleReconciliationMode("paused")).toThrow();
  });
});
