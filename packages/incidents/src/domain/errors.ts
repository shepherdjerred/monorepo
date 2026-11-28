import type { IncidentSystem } from "#shared/contract.ts";
import type { IncidentRecord } from "#domain/model.ts";

/** Expected, caller-facing refusals. Mapped 1:1 onto tRPC error codes. */
export type IncidentErrorCode =
  | "BAD_REQUEST"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "PRECONDITION_FAILED";

export type IncidentConflictDetail =
  | {
      readonly kind: "duplicate";
      readonly existing: IncidentRecord;
      readonly systems: readonly IncidentSystem[];
    }
  | {
      readonly kind: "stale-revision";
      readonly expectedRevision: number;
      readonly current: IncidentRecord;
    };

export class IncidentError extends Error {
  override readonly name = "IncidentError";

  constructor(
    readonly code: IncidentErrorCode,
    message: string,
    readonly conflict?: IncidentConflictDetail,
  ) {
    super(message);
  }
}

export function duplicateIncident(
  existing: IncidentRecord,
  systems: readonly IncidentSystem[],
): IncidentError {
  return new IncidentError(
    "CONFLICT",
    `INC-${String(existing.number)} is already open for ${systems.join(", ")}; join it instead`,
    { kind: "duplicate", existing, systems },
  );
}

export function staleRevision(
  current: IncidentRecord,
  expectedRevision: number,
): IncidentError {
  return new IncidentError(
    "CONFLICT",
    `INC-${String(current.number)} is at revision ${String(current.revision)}, not ${String(expectedRevision)}; refetch and retry`,
    { kind: "stale-revision", expectedRevision, current },
  );
}
