import {
  worstSeverity,
  type Severity,
} from "@shepherdjerred/ops-model/severity.ts";

/**
 * The TRMNL templates render four states. `info` is healthy on an e-ink glance,
 * so it folds into `ok`; ranking otherwise follows the ops model.
 */
export type Status = Exclude<Severity, "info">;

export function statusFromSeverity(severity: Severity): Status {
  return severity === "info" ? "ok" : severity;
}

export function worstStatus(statuses: readonly Status[]): Status {
  return statuses.length === 0
    ? "unknown"
    : statusFromSeverity(worstSeverity(statuses));
}

export function isUnavailableState(state: string): boolean {
  return state === "unavailable" || state === "unknown";
}
