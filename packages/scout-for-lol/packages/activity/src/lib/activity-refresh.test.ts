import { describe, expect, test } from "vitest";
import { customActivityRefreshDelay } from "./activity-refresh.ts";

describe("custom Activity auth refresh scheduling", () => {
  const now = Date.parse("2026-08-16T08:00:00.000Z");

  test("refreshes immediately when the token expired during suspension", () => {
    expect(customActivityRefreshDelay("2026-08-16T07:59:00.000Z", now)).toBe(0);
  });

  test("refreshes immediately inside the one-minute renewal window", () => {
    expect(customActivityRefreshDelay("2026-08-16T08:00:30.000Z", now)).toBe(0);
  });

  test("schedules valid sessions one minute before expiry", () => {
    expect(customActivityRefreshDelay("2026-08-16T08:10:00.000Z", now)).toBe(
      540_000,
    );
  });

  test("rejects an invalid expiry contract", () => {
    expect(() => customActivityRefreshDelay("invalid", now)).toThrow(
      "Activity auth expiry is invalid",
    );
  });
});
