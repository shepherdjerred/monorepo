import { describe, expect, test } from "vitest";
import {
  isAttention,
  severityFromCount,
  worstSeverity,
} from "@shepherdjerred/ops-model/severity.ts";

describe("worstSeverity", () => {
  test("an empty list is ok", () => {
    expect(worstSeverity([])).toBe("ok");
  });

  test("unknown outranks info but not warning", () => {
    expect(worstSeverity(["ok", "info", "unknown"])).toBe("unknown");
    expect(worstSeverity(["unknown", "warning"])).toBe("warning");
    expect(worstSeverity(["warning", "error", "unknown"])).toBe("error");
  });
});

describe("severityFromCount", () => {
  test("uses inclusive thresholds", () => {
    const thresholds = { warning: 1, error: 5 };
    expect(severityFromCount(0, thresholds)).toBe("ok");
    expect(severityFromCount(1, thresholds)).toBe("warning");
    expect(severityFromCount(5, thresholds)).toBe("error");
  });
});

describe("isAttention", () => {
  test("ok and info need no attention; unknown does", () => {
    expect(isAttention("ok")).toBe(false);
    expect(isAttention("info")).toBe(false);
    expect(isAttention("unknown")).toBe(true);
    expect(isAttention("error")).toBe(true);
  });
});
