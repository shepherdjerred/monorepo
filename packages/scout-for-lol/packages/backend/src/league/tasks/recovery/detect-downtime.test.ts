import { describe, expect, test } from "bun:test";
import { detectDowntime } from "#src/league/tasks/recovery/detect-downtime.ts";

describe("detectDowntime", () => {
  const now = new Date("2026-02-22T12:00:00Z");

  test("returns no recovery needed on first startup (undefined lastPollAt)", () => {
    const result = detectDowntime(undefined, now);

    expect(result.downtimeDetected).toBe(false);
    expect(result.downtimeDurationMs).toBe(0);
    expect(result.lastPollAt).toBeUndefined();
    expect(result.startupAt).toBe(now);
    expect(result.shouldBackfill).toBe(false);
    expect(result.shouldNotifyOffline).toBe(false);
  });

  test("returns no downtime when last poll was recent (5 minutes ago)", () => {
    const fiveMinutesAgo = new Date(now.getTime() - 5 * 60 * 1000);
    const result = detectDowntime(fiveMinutesAgo, now);

    expect(result.downtimeDetected).toBe(false);
    expect(result.downtimeDurationMs).toBe(5 * 60 * 1000);
    expect(result.shouldBackfill).toBe(false);
    expect(result.shouldNotifyOffline).toBe(false);
  });

  test("returns no downtime when last poll was exactly 30 minutes ago", () => {
    const thirtyMinutesAgo = new Date(now.getTime() - 30 * 60 * 1000);
    const result = detectDowntime(thirtyMinutesAgo, now);

    expect(result.downtimeDetected).toBe(false);
    expect(result.shouldBackfill).toBe(false);
    expect(result.shouldNotifyOffline).toBe(false);
  });

  test("detects downtime and backfill when last poll was 31 minutes ago", () => {
    const thirtyOneMinutesAgo = new Date(now.getTime() - 31 * 60 * 1000);
    const result = detectDowntime(thirtyOneMinutesAgo, now);

    expect(result.downtimeDetected).toBe(true);
    expect(result.shouldBackfill).toBe(true);
    expect(result.shouldNotifyOffline).toBe(false);
    expect(result.lastPollAt).toBe(thirtyOneMinutesAgo);
  });

  test("detects downtime with backfill but no notification for 12 hours", () => {
    const twelveHoursAgo = new Date(now.getTime() - 12 * 60 * 60 * 1000);
    const result = detectDowntime(twelveHoursAgo, now);

    expect(result.downtimeDetected).toBe(true);
    expect(result.shouldBackfill).toBe(true);
    expect(result.shouldNotifyOffline).toBe(false);
    expect(result.downtimeDurationMs).toBe(12 * 60 * 60 * 1000);
  });

  test("does not notify for exactly 24 hours of downtime", () => {
    const exactlyOneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const result = detectDowntime(exactlyOneDayAgo, now);

    expect(result.downtimeDetected).toBe(true);
    expect(result.shouldBackfill).toBe(true);
    expect(result.shouldNotifyOffline).toBe(false);
  });

  test("detects downtime with notification for > 1 day", () => {
    const overOneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000 - 1);
    const result = detectDowntime(overOneDayAgo, now);

    expect(result.downtimeDetected).toBe(true);
    expect(result.shouldBackfill).toBe(true);
    expect(result.shouldNotifyOffline).toBe(true);
    expect(result.downtimeDurationMs).toBe(24 * 60 * 60 * 1000 + 1);
  });

  test("detects downtime with notification for 2 days", () => {
    const twoDaysAgo = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);
    const result = detectDowntime(twoDaysAgo, now);

    expect(result.downtimeDetected).toBe(true);
    expect(result.shouldBackfill).toBe(true);
    expect(result.shouldNotifyOffline).toBe(true);
    expect(result.downtimeDurationMs).toBe(2 * 24 * 60 * 60 * 1000);
  });

  test("preserves startupAt in result", () => {
    const customStartup = new Date("2026-03-01T00:00:00Z");
    const result = detectDowntime(undefined, customStartup);

    expect(result.startupAt).toBe(customStartup);
  });
});
