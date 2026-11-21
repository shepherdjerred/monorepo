import { OPS_POLICY } from "./policy.ts";
import type { Severity } from "./severity.ts";

const MINUTE_MS = 60_000;

function thresholdSeverity(usedRatio: number): Severity {
  if (usedRatio >= OPS_POLICY.quotaErrorRatio) {
    return "error";
  }
  return usedRatio >= OPS_POLICY.quotaWarningRatio ? "warning" : "ok";
}

/**
 * Severity of one subscription quota window.
 *
 * Usage thresholds alone would raise the homelab banner every time a short
 * rolling window fills, although it refills by itself within hours. A window
 * is therefore capped at `info` when nothing needs doing about it:
 *
 * - its reset has already passed, so the reading describes a window that no
 *   longer exists;
 * - it resets within `quotaSelfHealingMinutes`.
 *
 * A weekly or monthly window exhausted days before its reset still warns or
 * errors, as does a window whose reset time is unknown.
 */
export function quotaWindowSeverity({
  usedRatio,
  resetsAtMs,
  nowMs,
}: {
  usedRatio: number;
  resetsAtMs?: number;
  nowMs: number;
}): Severity {
  const base = thresholdSeverity(usedRatio);
  if (base === "ok" || resetsAtMs === undefined) {
    return base;
  }
  const resetPassed = resetsAtMs <= nowMs;
  const selfHealing =
    resetsAtMs - nowMs <= OPS_POLICY.quotaSelfHealingMinutes * MINUTE_MS;
  return resetPassed || selfHealing ? "info" : base;
}
