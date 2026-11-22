import { describe, expect, test } from "vitest";
import {
  activityGroupLabel,
  buildAvatarDescriptor,
  formatActiveRatio,
  formatBounceCategory,
  formatCombatKind,
  formatDateTime,
  formatDurationMs,
  formatHours,
  formatInt,
  formatKdr,
  formatMinutes,
  formatModeLabel,
  formatPercent,
  formatPing,
  formatPlatform,
  formatRelativeTime,
  formatWorldLabel,
} from "./format.ts";

describe("duration and numeric formatters", () => {
  test("formats millisecond durations across seconds, minutes, hours, and days", () => {
    expect(formatDurationMs(0)).toBe("0m");
    expect(formatDurationMs(45_000)).toBe("45s");
    expect(formatDurationMs(5 * 60_000)).toBe("5m");
    expect(formatDurationMs(5 * 60_000 + 12_000)).toBe("5m 12s");
    expect(formatDurationMs(3 * 3_600_000 + 25 * 60_000)).toBe("3h 25m");
    expect(formatDurationMs(72 * 3_600_000)).toBe("3d");
    expect(formatDurationMs(50 * 3_600_000)).toBe("2d 2h");
  });

  test("formats hours, minutes, percentages, ping, and K/D ratios", () => {
    expect(formatHours(0)).toBe("0.0h");
    expect(formatHours(0.05)).toBe("3m");
    expect(formatHours(14.26)).toBe("14.3h");
    expect(formatHours(245.4)).toBe("245h");

    expect(formatMinutes(0.5)).toBe("30s");
    expect(formatMinutes(42)).toBe("42m");
    expect(formatMinutes(125)).toBe("2h 5m");

    expect(formatInt(12_450)).toBe("12,450");
    expect(formatPercent(66.66, 1)).toBe("66.7%");
    expect(formatActiveRatio(30, 60)).toBe(50);
    expect(formatActiveRatio(10, 0)).toBe(0);

    expect(formatPing(null)).toBe("—");
    expect(formatPing(38)).toBe("38 ms");

    expect(formatKdr(12, 0)).toBe("12.00");
    expect(formatKdr(9, 4)).toBe("2.25");
  });

  test("formats timestamps in Pacific Time and relative elapsed labels", () => {
    expect(formatDateTime(null)).toBe("—");
    expect(formatDateTime("2026-07-04T19:30:00Z")).toContain("Jul 4, 2026");
    expect(formatDateTime("2026-07-04T19:30:00Z")).toContain("PT");

    const refNow = Date.parse("2026-07-04T20:00:00Z");
    expect(formatRelativeTime("2026-07-04T19:59:30Z", refNow)).toBe("just now");
    expect(formatRelativeTime("2026-07-04T19:30:00Z", refNow)).toBe("30m ago");
    expect(formatRelativeTime("2026-07-04T15:00:00Z", refNow)).toBe("5h ago");
    expect(formatRelativeTime("2026-07-01T20:00:00Z", refNow)).toBe("3d ago");
  });

  test("maps domain enums and deterministic symmetric Minecraft avatars", () => {
    expect(formatPlatform("java", "1.21.4")).toBe("Java 1.21.4");
    expect(formatPlatform("bedrock")).toBe("Bedrock");
    expect(formatWorldLabel("skylands")).toBe("Skylands");
    expect(formatModeLabel("rwf")).toBe("Search & Destroy");
    expect(formatCombatKind("pve_death")).toBe("Killed by Mob");
    expect(formatBounceCategory("allowlist")).toBe("Allowlist");
    expect(activityGroupLabel("regular")).toBe("Regular");

    const first = buildAvatarDescriptor("069a79f4-44e9-4726-a5be-fca90e38aaf5");
    const second = buildAvatarDescriptor(
      "069a79f4-44e9-4726-a5be-fca90e38aaf5",
    );
    expect(first).toEqual(second);

    const coords = new Set(
      first.activePixels.map(([x, y]) => `${String(x)},${String(y)}`),
    );
    for (const [x, y] of first.activePixels) {
      expect(coords.has(`${String(7 - x)},${String(y)}`)).toBe(true);
    }
  });
});
