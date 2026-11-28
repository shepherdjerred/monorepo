// Frozen CI maintenance coordinator and tick, recorded before bounded pre-work
// retries, queued age-out, round-robin rotation, and health alerts. Its state
// logic is copied rather than imported so the fixture keeps recording the
// original behavior.
import {
  condition,
  continueAsNew,
  defineSignal,
  proxyActivities,
  setHandler,
  uuid4,
  upsertMemo,
} from "@temporalio/workflow";
import type {
  CiMaintenanceKind,
  MaintenanceCandidate,
  MaintenanceObservation,
  MaintenanceRequest,
  MaintenanceState,
} from "#shared/ci-maintenance.ts";

type Activities = {
  wakeCiMaintenance: () => Promise<void>;
  inspectCiMaintenance: (
    pending: MaintenanceRequest | null,
  ) => Promise<MaintenanceObservation>;
  submitCiMaintenance: (request: MaintenanceRequest) => Promise<number | null>;
};

const reads = proxyActivities<Activities>({
  taskQueue: "repo-automation",
  startToCloseTimeout: "2 minutes",
  retry: { maximumAttempts: 3, initialInterval: "10 seconds" },
});
const writes = proxyActivities<Activities>({
  taskQueue: "repo-automation",
  startToCloseTimeout: "1 minute",
  retry: { maximumAttempts: 1 },
});
const golden = proxyActivities<{
  publishCiWorkspaceGoldenSnapshot: (
    request: MaintenanceRequest,
  ) => Promise<{ snapshot: string; deleted: string[] }>;
}>({
  taskQueue: "infra",
  startToCloseTimeout: "20 minutes",
  heartbeatTimeout: "2 minutes",
  retry: { maximumAttempts: 3, initialInterval: "30 seconds" },
});
const maintenanceTick = defineSignal("maintenanceTick");
const maintenanceRetry =
  defineSignal<[{ kind: CiMaintenanceKind; requestId: string }]>(
    "maintenanceRetry",
  );
const maintenanceConfirmAbsent = defineSignal<
  [{ requestId: string; evidence: string }]
>("maintenanceConfirmAbsent");

function isActiveMaintenanceStatus(status: string): boolean {
  return ["created", "pending", "running", "blocked"].includes(status);
}

function nextMaintenanceCandidate(
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
      !(
        candidate.kind === "workspace-golden" &&
        state.goldenSnapshot !== undefined &&
        state.goldenSnapshot !== null
      ) &&
      state.blocked[candidate.kind] === undefined &&
      state.completed[candidate.kind] !== candidate.fingerprint,
  );
}

function recordMaintenanceObservation(
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
    state.observation =
      "Main advanced before dispatch; awaiting its verification";
  } else if (receipt.status === "success" && receipt.deferred === true) {
    state.observation =
      "Candidate deferred while a human reviews the existing PR";
  } else if (
    receipt.status === "success" &&
    request.kind === "workspace-golden"
  ) {
    state.goldenSnapshot = request;
    state.observation = `Snapshotting the golden workspace at ${request.source}`;
  } else if (receipt.status === "success") {
    state.completed[request.kind] = request.fingerprint;
    state.observation = `Completed ${request.kind} at ${request.source}`;
  } else if (receipt.startedWork === false) {
    state.observation = `Pipeline ${receipt.number.toString()} ended ${receipt.status} before starting work; retrying next tick`;
  } else {
    state.blocked[request.kind] = {
      requestId: request.requestId,
      reason: `Pipeline ${receipt.number.toString()} ended ${receipt.status}; inspect before retrying`,
      ...(observed.observedAt === undefined
        ? {}
        : { blockedAt: observed.observedAt }),
    };
    state.observation =
      state.blocked[request.kind]?.reason ?? "Maintenance failed";
  }
  state.lastKind = request.kind;
  state.pending = null;
}

async function selectGoldenSnapshot(state: MaintenanceState): Promise<void> {
  const pending = state.goldenSnapshot;
  if (pending === undefined || pending === null) return;
  try {
    const published = await golden.publishCiWorkspaceGoldenSnapshot(pending);
    state.completed[pending.kind] = pending.fingerprint;
    state.goldenSnapshot = null;
    state.observation = `Selected golden workspace snapshot ${published.snapshot}`;
  } catch {
    state.observation = "Golden workspace snapshot failed; retrying next tick";
  }
}

export async function runCiMaintenanceTick(): Promise<void> {
  await reads.wakeCiMaintenance();
}

const initialMaintenanceState = (): MaintenanceState => ({
  completed: {},
  blocked: {},
  pending: null,
  lastKind: "ci-images",
  observation: "starting",
});

export async function runCiMaintenanceCoordinator(
  state: MaintenanceState = initialMaintenanceState(),
): Promise<never> {
  let requested = true;
  setHandler(maintenanceTick, () => {
    requested = true;
  });
  setHandler(maintenanceConfirmAbsent, ({ requestId, evidence }) => {
    const pending = state.pending;
    if (
      pending?.pipeline !== null ||
      pending.requestId !== requestId ||
      evidence.trim().length < 16
    )
      return;
    state.blocked[pending.kind] = {
      requestId,
      reason: `Operator confirmed submission absent: ${evidence.slice(0, 500)}`,
    };
    state.pending = null;
    state.observation =
      "Submission reconciled; explicit maintenanceRetry required";
    requested = true;
  });
  setHandler(maintenanceRetry, ({ kind, requestId }) => {
    if (
      state.pending === null &&
      state.blocked[kind]?.requestId === requestId
    ) {
      state.blocked = Object.fromEntries(
        Object.entries(state.blocked).filter(([key]) => key !== kind),
      );
      requested = true;
    }
  });
  for (let ticks = 0; ticks < 100; ticks++) {
    await condition(() => requested);
    requested = false;
    try {
      const observation = await reads.inspectCiMaintenance(state.pending);
      recordMaintenanceObservation(state, observation);
      await selectGoldenSnapshot(state);
      if (!observation.enabled || state.pending !== null || observation.busy)
        continue;
      const candidate = nextMaintenanceCandidate(state, observation.candidates);
      if (candidate === undefined) continue;
      state.pending = { ...candidate, requestId: uuid4(), pipeline: null };
      try {
        const receipt = await writes.submitCiMaintenance(state.pending);
        if (receipt === null) state.pending = null;
        else state.pending.pipeline = receipt;
      } catch {
        state.observation =
          "Submission outcome uncertain; retaining request ID for read-back";
      }
    } catch {
      state.observation = "Maintenance inspection failed; no new submission";
    } finally {
      upsertMemo({ ciMaintenance: state });
    }
  }
  return continueAsNew<typeof runCiMaintenanceCoordinator>(state);
}
