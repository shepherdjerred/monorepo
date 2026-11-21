import { describe, expect, test } from "vitest";
import { OPS_POLICY } from "@shepherdjerred/ops-model/policy.ts";
import { quotaWindowSeverity } from "@shepherdjerred/ops-model/quota.ts";

const nowMs = Date.parse("2026-09-24T12:00:00.000Z");
const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;
const selfHealingMs = OPS_POLICY.quotaSelfHealingMinutes * MINUTE_MS;

const THRESHOLD_CASES = [
  [0, "ok"],
  [0.79, "ok"],
  [0.8, "warning"],
  [0.94, "warning"],
  [0.95, "error"],
  [1, "error"],
] as const;

describe("quotaWindowSeverity", () => {
  test("the policy values these cases pin", () => {
    expect(OPS_POLICY.quotaWarningRatio).toBe(0.8);
    expect(OPS_POLICY.quotaErrorRatio).toBe(0.95);
    expect(OPS_POLICY.quotaSelfHealingMinutes).toBe(360);
  });

  test.each(THRESHOLD_CASES)(
    "an unknown reset rates %d used by threshold alone: %s",
    (usedRatio, expected) => {
      expect(quotaWindowSeverity({ usedRatio, nowMs })).toBe(expected);
    },
  );

  test.each(THRESHOLD_CASES)(
    "a reset days away rates %d used by threshold alone: %s",
    (usedRatio, expected) => {
      expect(
        quotaWindowSeverity({
          usedRatio,
          resetsAtMs: nowMs + 3 * DAY_MS,
          nowMs,
        }),
      ).toBe(expected);
    },
  );

  test.each([
    ["long ago", nowMs - 3 * DAY_MS],
    ["a millisecond ago", nowMs - 1],
    ["exactly now", nowMs],
  ])(
    "a reset that passed %s caps a full window at info",
    (_name, resetsAtMs) => {
      expect(quotaWindowSeverity({ usedRatio: 0.8, resetsAtMs, nowMs })).toBe(
        "info",
      );
      expect(quotaWindowSeverity({ usedRatio: 1, resetsAtMs, nowMs })).toBe(
        "info",
      );
    },
  );

  test.each([
    ["in a millisecond", nowMs + 1],
    ["in three hours", nowMs + 180 * MINUTE_MS],
    ["in exactly 360 minutes", nowMs + selfHealingMs],
  ])("a reset %s caps a full window at info", (_name, resetsAtMs) => {
    expect(quotaWindowSeverity({ usedRatio: 0.8, resetsAtMs, nowMs })).toBe(
      "info",
    );
    expect(quotaWindowSeverity({ usedRatio: 0.95, resetsAtMs, nowMs })).toBe(
      "info",
    );
  });

  test("a reset just over 360 minutes away is not capped", () => {
    const resetsAtMs = nowMs + selfHealingMs + 1;
    expect(quotaWindowSeverity({ usedRatio: 0.8, resetsAtMs, nowMs })).toBe(
      "warning",
    );
    expect(quotaWindowSeverity({ usedRatio: 0.95, resetsAtMs, nowMs })).toBe(
      "error",
    );
  });

  test.each([
    ["already passed", nowMs - 1],
    ["exactly now", nowMs],
    ["in exactly 360 minutes", nowMs + selfHealingMs],
  ])("capping never raises a healthy window: reset %s", (_name, resetsAtMs) => {
    expect(quotaWindowSeverity({ usedRatio: 0.79, resetsAtMs, nowMs })).toBe(
      "ok",
    );
  });
});
