import { cocoaToMs } from "#lib/brim/cache.ts";
import type { UsageWindow } from "#lib/brim/cache.ts";

/**
 * Quota pacing, ported from Brim's `WindowPacing` (Pacing.swift): how a
 * window's remaining share compares with an even burn over its duration.
 */
export type PaceStatus = "ahead" | "on-pace" | "behind";

const FIVE_HOUR_SECONDS = 5 * 3600;
const WEEK_SECONDS = 7 * 86_400;
const ON_PACE_TOLERANCE = 0.15;

/** The Swift `WindowKind` case a cached window was encoded with. */
export function windowKind(window: UsageWindow): string {
  const keys = Object.keys(window.kind);
  const first = keys[0];
  return first ?? "";
}

export function windowUsedPercent(window: UsageWindow): number | null {
  const used = window.usedPercent;
  if (used === null || used === undefined) return null;
  return Number.isFinite(used) ? used : null;
}

function rollingDurationSeconds(window: UsageWindow): number | null {
  const rolling: unknown = window.kind["rolling"];
  if (typeof rolling !== "object" || rolling === null) return null;
  const duration: unknown = Reflect.get(rolling, "durationSeconds");
  return typeof duration === "number" && duration > 0 ? duration : null;
}

/** The UTC calendar month ending at `resetMs`, clamped like Foundation's. */
function monthBeforeMs(resetMs: number): number {
  const reset = new Date(resetMs);
  const year = reset.getUTCFullYear();
  const month = reset.getUTCMonth() - 1;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return Date.UTC(
    year,
    month,
    Math.min(reset.getUTCDate(), lastDay),
    reset.getUTCHours(),
    reset.getUTCMinutes(),
    reset.getUTCSeconds(),
    reset.getUTCMilliseconds(),
  );
}

/**
 * Port of Brim's `WindowPacing.duration(of:)`: a rolling window's own
 * duration, a week, the calendar month before the reset, or the duration a
 * label names (`5-hour`, `weekly`, `monthly`) for windows typed per model,
 * such as Antigravity's buckets. Null when the window has no period.
 */
export function windowDurationSeconds(window: UsageWindow): number | null {
  const kind = windowKind(window);
  const label = window.label.toLowerCase();
  const rolling = rollingDurationSeconds(window);
  if (rolling !== null) return rolling;
  if (kind === "entitlement") return null;
  if (kind === "weekly" || (kind !== "monthly" && label.includes("weekly"))) {
    return WEEK_SECONDS;
  }
  if (kind === "monthly" || label.includes("monthly")) {
    const resetAt = window.resetAt;
    if (resetAt === null || resetAt === undefined) return null;
    const resetMs = cocoaToMs(resetAt);
    return (resetMs - monthBeforeMs(resetMs)) / 1000;
  }
  return label.includes("5-hour") ? FIVE_HOUR_SECONDS : null;
}

/**
 * Port of Brim's `WindowPacing.compute`: compares the remaining share per
 * unit of time left against an even burn over the window's duration. Returns
 * null for windows without a duration, missing data, or a reset outside
 * (0, duration]. Times are Cocoa seconds; only their difference matters.
 */
export function computePace(
  window: UsageWindow,
  nowCocoaSeconds: number,
): PaceStatus | null {
  const used = windowUsedPercent(window);
  const resetAt = window.resetAt;
  const totalSeconds = windowDurationSeconds(window);
  if (
    used === null ||
    resetAt === null ||
    resetAt === undefined ||
    totalSeconds === null
  ) {
    return null;
  }
  const secondsRemaining = resetAt - nowCocoaSeconds;
  if (
    !Number.isFinite(secondsRemaining) ||
    secondsRemaining <= 0 ||
    secondsRemaining > totalSeconds
  ) {
    return null;
  }
  const evenPace = 100 / totalSeconds;
  const actualPace = (100 - used) / secondsRemaining;
  if (actualPace >= evenPace * (1 + ON_PACE_TOLERANCE)) return "ahead";
  return actualPace <= evenPace * (1 - ON_PACE_TOLERANCE)
    ? "behind"
    : "on-pace";
}
