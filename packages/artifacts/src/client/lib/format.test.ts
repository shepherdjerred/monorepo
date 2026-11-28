import { describe, expect, test } from "vitest";
import { formatAge, formatBytes, formatClock } from "./format.ts";

describe("format", () => {
  test("bytes", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(300 * 1024 * 1024)).toBe("300 MB");
  });

  test("age", () => {
    const now = Date.parse("2026-11-26T12:00:00Z");
    expect(formatAge("2026-11-26T11:59:40Z", now)).toBe("just now");
    expect(formatAge("2026-11-26T09:00:00Z", now)).toBe("3 hours ago");
    expect(formatAge("2026-11-25T12:00:00Z", now)).toBe("yesterday");
  });

  test("clock", () => {
    expect(formatClock(75.9)).toBe("1:15");
    expect(formatClock(-3)).toBe("0:00");
  });
});
