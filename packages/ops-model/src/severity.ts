import { z } from "zod";

/**
 * Severity of one signal, section, or the whole snapshot.
 *
 * `unknown` means "we could not observe this" — a stale or failed source. It
 * ranks above `info` so missing data is never rendered as healthy, and below
 * `warning` so a known problem still sorts ahead of a blind spot.
 */
export const SEVERITIES = [
  "ok",
  "info",
  "unknown",
  "warning",
  "error",
] as const;

export const SeveritySchema = z.enum(SEVERITIES);

export type Severity = z.infer<typeof SeveritySchema>;

const RANK: Record<Severity, number> = {
  ok: 0,
  info: 1,
  unknown: 2,
  warning: 3,
  error: 4,
};

export function severityRank(severity: Severity): number {
  return RANK[severity];
}

/** The worst severity in the list; an empty list is `ok` (nothing to report). */
export function worstSeverity(severities: Iterable<Severity>): Severity {
  let worst: Severity = "ok";
  for (const severity of severities) {
    if (RANK[severity] > RANK[worst]) {
      worst = severity;
    }
  }
  return worst;
}

/** Severity from a count against inclusive warning/error thresholds. */
export function severityFromCount(
  count: number,
  thresholds: { warning: number; error: number },
): Severity {
  if (count >= thresholds.error) {
    return "error";
  }
  return count >= thresholds.warning ? "warning" : "ok";
}

/** Whether a severity is something a human should look at. */
export function isAttention(severity: Severity): boolean {
  return RANK[severity] >= RANK.unknown;
}
