import { z } from "zod";

export const CI_MAINTENANCE_ID = "ci-maintenance-coordinator";
export const CI_MAINTENANCE_KINDS = [
  "release-notes",
  "ci-images",
  "workspace-seeds",
  "workspace-golden",
] as const;
export const CiMaintenanceKindSchema = z.enum(CI_MAINTENANCE_KINDS);
export type CiMaintenanceKind = z.infer<typeof CiMaintenanceKindSchema>;
export type MaintenanceCandidate = {
  kind: CiMaintenanceKind;
  source: string;
  fingerprint: string;
  frozen: boolean;
};
export type MaintenanceRequest = MaintenanceCandidate & {
  requestId: string;
  pipeline: number | null;
};
export type MaintenanceState = {
  completed: Partial<Record<CiMaintenanceKind, string>>;
  blocked: Partial<
    Record<CiMaintenanceKind, { requestId: string; reason: string }>
  >;
  pending: MaintenanceRequest | null;
  /**
   * A golden refresh that succeeded but whose claim is not yet snapshotted and
   * selected. Optional because earlier coordinator states predate it.
   */
  goldenSnapshot?: MaintenanceRequest | null;
  lastKind: CiMaintenanceKind;
  observation: string;
};
export const initialMaintenanceState = (): MaintenanceState => ({
  completed: {},
  blocked: {},
  pending: null,
  lastKind: "ci-images",
  observation: "starting",
});
export type MaintenanceObservation = {
  enabled: boolean;
  candidates: MaintenanceCandidate[];
  pending: {
    number: number;
    status: string;
    source: string;
    deferred?: boolean;
  } | null;
  busy: boolean;
};

export function isActiveMaintenanceStatus(status: string): boolean {
  return ["created", "pending", "running", "blocked"].includes(status);
}

/** Records the selected golden snapshot; the refresh is then complete. */
export function recordGoldenSnapshot(
  state: MaintenanceState,
  snapshot: string,
): void {
  const request = state.goldenSnapshot;
  if (request === undefined || request === null) return;
  state.completed[request.kind] = request.fingerprint;
  state.goldenSnapshot = null;
  state.observation = `Selected golden workspace snapshot ${snapshot}`;
}

export function nextMaintenanceCandidate(
  state: MaintenanceState,
  candidates: readonly MaintenanceCandidate[],
) {
  const ordered = [...candidates].sort(
    (a, b) =>
      Number(a.kind === state.lastKind) - Number(b.kind === state.lastKind),
  );
  return ordered.find(
    (candidate) =>
      !candidate.frozen &&
      // Publishing again before the last refresh is snapshotted would
      // snapshot a claim being rewritten.
      !(
        candidate.kind === "workspace-golden" &&
        state.goldenSnapshot !== undefined &&
        state.goldenSnapshot !== null
      ) &&
      state.blocked[candidate.kind] === undefined &&
      state.completed[candidate.kind] !== candidate.fingerprint,
  );
}

export function recordMaintenanceObservation(
  state: MaintenanceState,
  observed: MaintenanceObservation,
): void {
  const request = state.pending;
  if (request === null) return;
  const receipt = observed.pending;
  if (receipt === null) {
    state.observation =
      "Submission has no receipt; operator reconciliation required";
    return;
  }
  request.pipeline = receipt.number;
  if (isActiveMaintenanceStatus(receipt.status)) {
    state.observation = `Pipeline ${receipt.number.toString()} is ${receipt.status}`;
    return;
  }
  if (receipt.source !== request.source) {
    // Woodpecker resolves main during POST. The extension emits no maintenance
    // work when the expected source moved, so retry selection on the next tick.
    state.observation =
      "Main advanced before dispatch; awaiting its verification";
  } else if (receipt.status === "success" && receipt.deferred === true) {
    state.observation =
      "Candidate deferred while a human reviews the existing PR";
  } else if (
    receipt.status === "success" &&
    request.kind === "workspace-golden"
  ) {
    // Completed only once the refreshed claim is snapshotted and selected.
    state.goldenSnapshot = request;
    state.observation = `Snapshotting the golden workspace at ${request.source}`;
  } else if (receipt.status === "success") {
    state.completed[request.kind] = request.fingerprint;
    state.observation = `Completed ${request.kind} at ${request.source}`;
  } else {
    state.blocked[request.kind] = {
      requestId: request.requestId,
      reason: `Pipeline ${receipt.number.toString()} ended ${receipt.status}; inspect before retrying`,
    };
    state.observation =
      state.blocked[request.kind]?.reason ?? "Maintenance failed";
  }
  state.lastKind = request.kind;
  state.pending = null;
}
