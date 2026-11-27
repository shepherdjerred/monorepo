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
/**
 * Automatic retries for a stream whose pipelines end before any command
 * starts (a config-extension or forge blip). Each retry spans two schedule
 * ticks, one to read the ending and one to resubmit, so six retries ride out
 * about an hour of such failures before the stream blocks for an operator.
 */
export const MAX_PRE_WORK_RETRIES = 6;
/**
 * How long a submitted request waits in Woodpecker's queue before the
 * coordinator checks whether it is stuck. Healthy maintenance runs have waited
 * up to 49 minutes for an agent. Past this bound a request is canceled only
 * with evidence that it cannot run (newer work in its agent pool runs ahead of
 * it, or nothing in its pool runs at all); a request that is merely behind a
 * long backlog keeps its place, and the stalled-request alert reports it.
 */
export const QUEUED_AGE_OUT_MS = 2 * 60 * 60_000;
/**
 * Consecutive stuck age-outs per stream before it blocks: three cancels with
 * evidence that the request could not run (six hours) point at its agent pool
 * or labels, which resubmission cannot fix.
 */
export const MAX_QUEUED_AGE_OUTS = 3;
export type MaintenanceCandidate = {
  kind: CiMaintenanceKind;
  source: string;
  fingerprint: string;
  frozen: boolean;
};
/**
 * The latest stuck-or-slow check of a request queued past
 * {@link QUEUED_AGE_OUT_MS}: `waiting` means older work in its agent pool is
 * ahead of it, `failed` means the check could not run.
 */
export type QueueCheck =
  "waiting" | "not-queued" | "canceled" | "uncertain" | "failed";
export type MaintenanceRequest = MaintenanceCandidate & {
  requestId: string;
  pipeline: number | null;
  /**
   * When the request was submitted. A request submitted by an earlier
   * coordinator starts its clock when it is first seen queued.
   */
  queuedSince?: string;
  /** When an agent first took the request; it has then left the queue. */
  startedAt?: string;
  /**
   * When an age-out cancel was sent or could not be confirmed. Once set, the
   * coordinator never sends another cancel for this request.
   */
  cancelRequestedAt?: string;
  /** The latest age-out check, which tells a backlog from a stuck request. */
  lastQueueCheck?: QueueCheck;
};
export type BlockedMaintenanceStream = {
  requestId: string;
  reason: string;
  blockedAt?: string;
};
export type MaintenanceState = {
  completed: Partial<Record<CiMaintenanceKind, string>>;
  blocked: Partial<Record<CiMaintenanceKind, BlockedMaintenanceStream>>;
  pending: MaintenanceRequest | null;
  /**
   * A golden refresh that succeeded but whose claim is not yet snapshotted and
   * selected. Optional because earlier coordinator states predate it.
   */
  goldenSnapshot?: MaintenanceRequest | null;
  /**
   * Consecutive pre-work endings per stream since its last success or block.
   * Optional because earlier coordinator states predate it.
   */
  preWorkRetries?: Partial<Record<CiMaintenanceKind, number>>;
  /**
   * Consecutive stuck age-outs per stream since one of its requests last left
   * the queue. Optional because earlier coordinator states predate it.
   */
  ageOuts?: Partial<Record<CiMaintenanceKind, number>>;
  /**
   * When an inspection last succeeded. A coordinator whose inspections keep
   * failing, or whose workflow task is stuck, stops advancing it.
   */
  inspectedAt?: string;
  lastKind: CiMaintenanceKind;
  observation: string;
};
/**
 * Behavior selected by the coordinator's patch marker. Histories recorded
 * before the marker replay with `bounded: false`, the original behavior.
 */
export type MaintenancePolicy = { bounded: boolean };
const LEGACY_POLICY: MaintenancePolicy = { bounded: false };
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
    startedWork?: boolean;
  } | null;
  busy: boolean;
  observedAt?: string;
};
type MaintenanceReceipt = NonNullable<MaintenanceObservation["pending"]>;
/** A pending request's terminal receipt, as one tick observed it. */
type Settlement = {
  request: MaintenanceRequest;
  receipt: MaintenanceReceipt;
  observed: MaintenanceObservation;
  policy: MaintenancePolicy;
};

export function isActiveMaintenanceStatus(status: string): boolean {
  return ["created", "pending", "running", "blocked"].includes(status);
}

/** Waiting for an agent: no agent has taken the pipeline and no command ran. */
function isQueuedMaintenanceReceipt(receipt: MaintenanceReceipt) {
  return (
    (receipt.status === "created" || receipt.status === "pending") &&
    receipt.startedWork === false
  );
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

/** Round-robin position after the last settled stream, which goes last. */
function rotationRank(kind: CiMaintenanceKind, lastKind: CiMaintenanceKind) {
  const count = CI_MAINTENANCE_KINDS.length;
  return (
    (CI_MAINTENANCE_KINDS.indexOf(kind) -
      CI_MAINTENANCE_KINDS.indexOf(lastKind) +
      count -
      1) %
    count
  );
}

export function nextMaintenanceCandidate(
  state: MaintenanceState,
  candidates: readonly MaintenanceCandidate[],
  policy: MaintenancePolicy = LEGACY_POLICY,
) {
  // Bounded coordinators rotate through every stream so one that keeps
  // settling without work (an aged-out request) cannot starve a third.
  const rank = (kind: CiMaintenanceKind) =>
    policy.bounded
      ? rotationRank(kind, state.lastKind)
      : Number(kind === state.lastKind);
  const ordered = [...candidates].sort((a, b) => rank(a.kind) - rank(b.kind));
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

type StreamCounter = "preWorkRetries" | "ageOuts";

function clearStreamCount(
  state: MaintenanceState,
  counter: StreamCounter,
  kind: CiMaintenanceKind,
): void {
  const counts = state[counter];
  if (counts?.[kind] === undefined) return;
  state[counter] = Object.fromEntries(
    Object.entries(counts).filter(([key]) => key !== kind),
  );
}

function clearStreamCounts(state: MaintenanceState, kind: CiMaintenanceKind) {
  clearStreamCount(state, "preWorkRetries", kind);
  clearStreamCount(state, "ageOuts", kind);
}

/** The coordinator's own age-out settled: count it, and block a stream that keeps getting stuck. */
function recordAgeOut(
  state: MaintenanceState,
  { request, receipt, observed }: Settlement,
): void {
  const pipeline = receipt.number.toString();
  const ageOuts = (state.ageOuts?.[request.kind] ?? 0) + 1;
  if (ageOuts >= MAX_QUEUED_AGE_OUTS) {
    clearStreamCounts(state, request.kind);
    blockStream(
      state,
      request,
      `Pipeline ${pipeline} was aged out of the queue ${ageOuts.toString()} times in a row with evidence it could not run; check its agent pool and labels before retrying`,
      observed,
    );
    return;
  }
  state.ageOuts = { ...state.ageOuts, [request.kind]: ageOuts };
  state.observation = `Aged out pipeline ${pipeline} after it got stuck in the queue (${ageOuts.toString()} of ${MAX_QUEUED_AGE_OUTS.toString()}); rotating to the next stream`;
}

function blockStream(
  state: MaintenanceState,
  request: MaintenanceRequest,
  reason: string,
  observed: MaintenanceObservation,
): void {
  state.blocked[request.kind] = {
    requestId: request.requestId,
    reason,
    ...(observed.observedAt === undefined
      ? {}
      : { blockedAt: observed.observedAt }),
  };
  state.observation = reason;
}

/** An age-out settles; a transient pre-work error retries a bounded number of times. */
function recordPreWorkEnding(
  state: MaintenanceState,
  { request, receipt, observed, policy }: Settlement,
): void {
  const pipeline = receipt.number.toString();
  if (!policy.bounded) {
    state.observation = `Pipeline ${pipeline} ended ${receipt.status} before starting work; retrying next tick`;
    return;
  }
  if (
    request.cancelRequestedAt !== undefined &&
    (receipt.status === "canceled" || receipt.status === "killed")
  ) {
    // The coordinator's own age-out, not a pipeline fault.
    recordAgeOut(state, { request, receipt, observed, policy });
    return;
  }
  const retries = (state.preWorkRetries?.[request.kind] ?? 0) + 1;
  if (retries > MAX_PRE_WORK_RETRIES) {
    clearStreamCount(state, "preWorkRetries", request.kind);
    blockStream(
      state,
      request,
      `Pipeline ${pipeline} ended ${receipt.status} before starting work after ${MAX_PRE_WORK_RETRIES.toString()} automatic retries; inspect before retrying`,
      observed,
    );
    return;
  }
  state.preWorkRetries = { ...state.preWorkRetries, [request.kind]: retries };
  state.observation = `Pipeline ${pipeline} ended ${receipt.status} before starting work; retry ${retries.toString()} of ${MAX_PRE_WORK_RETRIES.toString()} next tick`;
}

function recordSettledReceipt(
  state: MaintenanceState,
  settlement: Settlement,
): void {
  const { request, receipt, observed, policy } = settlement;
  const succeeded = receipt.status === "success";
  if (receipt.source !== request.source) {
    // Woodpecker resolves main during POST. The extension emits no maintenance
    // work when the expected source moved, so retry selection on the next tick.
    state.observation =
      "Main advanced before dispatch; awaiting its verification";
    return;
  }
  if (succeeded) {
    if (receipt.deferred === true) {
      state.observation =
        "Candidate deferred while a human reviews the existing PR";
    } else if (request.kind === "workspace-golden") {
      // Completed only once the refreshed claim is snapshotted and selected.
      state.goldenSnapshot = request;
      state.observation = `Snapshotting the golden workspace at ${request.source}`;
    } else {
      state.completed[request.kind] = request.fingerprint;
      state.observation = `Completed ${request.kind} at ${request.source}`;
    }
    if (policy.bounded) clearStreamCounts(state, request.kind);
    return;
  }
  if (receipt.startedWork === false) {
    recordPreWorkEnding(state, settlement);
    return;
  }
  if (policy.bounded) clearStreamCounts(state, request.kind);
  blockStream(
    state,
    request,
    `Pipeline ${receipt.number.toString()} ended ${receipt.status}; inspect before retrying`,
    observed,
  );
}

/** A queued request keeps its clock; one an agent took resets its stream's age-outs. */
function recordQueuePosition(
  state: MaintenanceState,
  request: MaintenanceRequest,
  receipt: MaintenanceReceipt,
  observedAt: string,
): void {
  if (isQueuedMaintenanceReceipt(receipt)) {
    request.queuedSince ??= observedAt;
    return;
  }
  request.startedAt ??= observedAt;
  clearStreamCount(state, "ageOuts", request.kind);
}

export function recordMaintenanceObservation(
  state: MaintenanceState,
  observed: MaintenanceObservation,
  policy: MaintenancePolicy = LEGACY_POLICY,
): void {
  const observedAt = policy.bounded ? observed.observedAt : undefined;
  // Only a successful inspection reaches here, so a stale value means the
  // coordinator has stopped inspecting.
  if (observedAt !== undefined) state.inspectedAt = observedAt;
  const request = state.pending;
  if (request === null) return;
  const receipt = observed.pending;
  if (receipt === null) {
    // Starts the clock the stalled-request alert reads.
    if (observedAt !== undefined) request.queuedSince ??= observedAt;
    state.observation =
      "Submission has no receipt; operator reconciliation required";
    return;
  }
  request.pipeline = receipt.number;
  if (isActiveMaintenanceStatus(receipt.status)) {
    if (observedAt !== undefined)
      recordQueuePosition(state, request, receipt, observedAt);
    state.observation = `Pipeline ${receipt.number.toString()} is ${receipt.status}`;
    return;
  }
  recordSettledReceipt(state, { request, receipt, observed, policy });
  state.lastKind = request.kind;
  state.pending = null;
}

/**
 * The pending request that has waited in Woodpecker's queue past
 * {@link QUEUED_AGE_OUT_MS} without starting, and so is due for a check that
 * it is stuck rather than slow. A request whose cancel was already sent or
 * left uncertain is never returned again.
 */
export function queuedMaintenanceAgeOut(
  state: MaintenanceState,
  observed: MaintenanceObservation,
): MaintenanceRequest | undefined {
  const request = state.pending;
  const receipt = observed.pending;
  if (request === null || receipt === null) return undefined;
  if (
    request.pipeline !== receipt.number ||
    request.queuedSince === undefined ||
    request.cancelRequestedAt !== undefined ||
    observed.observedAt === undefined ||
    !isQueuedMaintenanceReceipt(receipt)
  )
    return undefined;
  const waited =
    Date.parse(observed.observedAt) - Date.parse(request.queuedSince);
  return waited >= QUEUED_AGE_OUT_MS ? request : undefined;
}
