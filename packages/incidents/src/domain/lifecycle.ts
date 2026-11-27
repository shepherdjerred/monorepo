/**
 * Per-kind status machine. Non-terminal incident statuses move freely among
 * themselves (an investigation can regress); terminal statuses are reached
 * only through `resolve` (or `canceled` for maintenance) and left only through
 * `reopen`.
 */
import {
  INCIDENT_STATUSES,
  isOpenStatus,
  MAINTENANCE_STATUSES,
  type IncidentKind,
  type IncidentStatus,
} from "#shared/contract.ts";

/** Moves `changeStatus` may make. Resolution and reopening have their own commands. */
export const STATUS_MOVES: Readonly<
  Record<IncidentStatus, readonly IncidentStatus[]>
> = {
  investigating: ["identified", "mitigating", "monitoring"],
  identified: ["investigating", "mitigating", "monitoring"],
  mitigating: ["investigating", "identified", "monitoring"],
  monitoring: ["investigating", "identified", "mitigating"],
  resolved: [],
  scheduled: ["in_progress", "canceled"],
  in_progress: ["verifying", "canceled"],
  verifying: ["in_progress", "canceled"],
  completed: [],
  canceled: [],
};

export function statusesFor(kind: IncidentKind): readonly IncidentStatus[] {
  return kind === "incident" ? INCIDENT_STATUSES : MAINTENANCE_STATUSES;
}

export function initialStatus(kind: IncidentKind): IncidentStatus {
  return kind === "incident" ? "investigating" : "scheduled";
}

export function canMove(
  kind: IncidentKind,
  from: IncidentStatus,
  to: IncidentStatus,
): boolean {
  return statusesFor(kind).includes(to) && STATUS_MOVES[from].includes(to);
}

/** Terminal status `resolve` moves to, or null when resolving is not allowed from `from`. */
export function resolveTarget(
  kind: IncidentKind,
  from: IncidentStatus,
): IncidentStatus | null {
  if (!isOpenStatus(from)) return null;
  if (kind === "incident") return "resolved";
  return from === "in_progress" || from === "verifying" ? "completed" : null;
}

/** Status `reopen` returns to, or null when the record cannot be reopened. */
export function reopenTarget(from: IncidentStatus): IncidentStatus | null {
  if (from === "resolved") return "investigating";
  return from === "completed" ? "in_progress" : null;
}

/** Entering `monitoring` (incident) or `verifying` (maintenance) marks mitigation. */
export function marksMitigation(status: IncidentStatus): boolean {
  return status === "monitoring" || status === "verifying";
}
