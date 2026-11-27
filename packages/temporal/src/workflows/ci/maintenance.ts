import {
  ActivityFailure,
  ApplicationFailure,
  condition,
  continueAsNew,
  defineSignal,
  log,
  patched,
  proxyActivities,
  setHandler,
  uuid4,
  upsertMemo,
} from "@temporalio/workflow";
import type { CiMaintenanceActivities } from "#activities/maintenance/ci-maintenance.ts";
import type { StuckMaintenanceOutcome } from "#activities/maintenance/ci-maintenance-age-out.ts";
import type { CiMaintenanceHealthActivities } from "#activities/ops/ci-maintenance/ci-maintenance-health.ts";
import type { CiWorkspaceGoldenActivities } from "#activities/maintenance/ci-workspace-golden.ts";
import {
  initialMaintenanceState,
  nextMaintenanceCandidate,
  queuedMaintenanceAgeOut,
  recordGoldenSnapshot,
  recordMaintenanceObservation,
  type CiMaintenanceKind,
  type MaintenanceCandidate,
  type MaintenanceObservation,
  type MaintenancePolicy,
  type MaintenanceRequest,
  type MaintenanceState,
} from "#shared/ci-maintenance.ts";
import { TASK_QUEUES } from "#shared/task-queues.ts";

/**
 * Bounds pre-work retries, ages out requests stuck in Woodpecker's queue, and
 * rotates streams round-robin. Histories without the marker replay unbounded.
 */
const CI_MAINTENANCE_BOUNDED_PATCH = "ci-maintenance-bounded-stalls-v1";
/** Ticks also publish coordinator and golden-workspace health to Alertmanager. */
const CI_MAINTENANCE_HEALTH_PATCH = "ci-maintenance-health-alerts-v1";

const reads = proxyActivities<CiMaintenanceActivities>({
  taskQueue: TASK_QUEUES.REPO_AUTOMATION,
  startToCloseTimeout: "2 minutes",
  retry: { maximumAttempts: 3, initialInterval: "10 seconds" },
});
const writes = proxyActivities<CiMaintenanceActivities>({
  taskQueue: TASK_QUEUES.REPO_AUTOMATION,
  startToCloseTimeout: "1 minute",
  // A lost POST response never authorizes another submission.
  retry: { maximumAttempts: 1 },
});
// Up to five bounded Woodpecker calls (two reads, the queue, the cancel and a
// read-back, 15 seconds each) must finish inside one attempt, so a timeout
// cannot strike after the cancel is sent.
const ageOut = proxyActivities<CiMaintenanceActivities>({
  taskQueue: TASK_QUEUES.REPO_AUTOMATION,
  startToCloseTimeout: "2 minutes",
  retry: { maximumAttempts: 1 },
});
// The infra worker holds the CI namespace snapshot grant. The activity is
// idempotent per request, so retries resume the same snapshot.
const golden = proxyActivities<CiWorkspaceGoldenActivities>({
  taskQueue: TASK_QUEUES.INFRA,
  startToCloseTimeout: "20 minutes",
  heartbeatTimeout: "2 minutes",
  retry: { maximumAttempts: 3, initialInterval: "30 seconds" },
});
// Bounded reads and one Alertmanager POST on the infra worker's ops slots,
// which never wait behind its serial infra automation.
// A stale inspection is confirmed by a second read a minute later, so one
// attempt can take nearly two minutes; two attempts fit the tick's five.
const health = proxyActivities<CiMaintenanceHealthActivities>({
  taskQueue: TASK_QUEUES.OPS,
  startToCloseTimeout: "2 minutes",
  retry: { maximumAttempts: 2, initialInterval: "10 seconds" },
});
export const maintenanceTick = defineSignal("maintenanceTick");
export const maintenanceRetry =
  defineSignal<[{ kind: CiMaintenanceKind; requestId: string }]>(
    "maintenanceRetry",
  );
export const maintenanceConfirmAbsent = defineSignal<
  [{ requestId: string; evidence: string }]
>("maintenanceConfirmAbsent");

/** A failed snapshot stays pending and is retried next tick; other maintenance continues. */
async function selectGoldenSnapshot(state: MaintenanceState): Promise<void> {
  const pending = state.goldenSnapshot;
  if (pending === undefined || pending === null) return;
  try {
    const published = await golden.publishCiWorkspaceGoldenSnapshot(pending);
    recordGoldenSnapshot(state, published.snapshot);
  } catch {
    state.observation = "Golden workspace snapshot failed; retrying next tick";
  }
}

/**
 * Checks a request queued past its bound and cancels it only when Woodpecker's
 * queue shows it is stuck, so the next stream can run. A request that is only
 * behind a backlog keeps its place. Once a cancel is sent, confirmed or not,
 * it is recorded and never sent again; a check that fails before any cancel
 * is sent records nothing and runs again next tick.
 */
async function ageOutQueuedRequest(
  state: MaintenanceState,
  observation: MaintenanceObservation,
  policy: MaintenancePolicy,
): Promise<void> {
  if (!policy.bounded) return;
  const request = queuedMaintenanceAgeOut(state, observation);
  const checkedAt = observation.observedAt;
  if (request === undefined || checkedAt === undefined) return;
  const pipeline = String(request.pipeline);
  let result: StuckMaintenanceOutcome;
  try {
    result = await ageOut.cancelStuckCiMaintenance(request);
  } catch {
    request.lastQueueCheck = "failed";
    state.observation = `Could not check whether pipeline ${pipeline} is stuck; checking again next tick`;
    return;
  }
  request.lastQueueCheck = result.outcome;
  if (result.outcome === "canceled" || result.outcome === "uncertain")
    request.cancelRequestedAt = checkedAt;
  state.observation = {
    waiting: `Pipeline ${pipeline} has waited since ${String(request.queuedSince)} but is not stuck: ${result.detail}`,
    "not-queued": `Pipeline ${pipeline} left the queue: ${result.detail}`,
    canceled: `Canceled pipeline ${pipeline} because ${result.detail}; awaiting read-back`,
    uncertain: `Cancel of pipeline ${pipeline} is unconfirmed (${result.detail}); awaiting read-back without another cancel`,
  }[result.outcome];
}

/** An activity that the polling worker does not register yet, as during a mis-ordered rollout. */
function isUnregisteredActivity(error: unknown): boolean {
  return (
    error instanceof ActivityFailure &&
    error.cause instanceof ApplicationFailure &&
    error.cause.type === "NotFoundError"
  );
}

/** Recorded before the write activity; replay never invents another ID. */
function newMaintenanceRequest(
  candidate: MaintenanceCandidate,
  observation: MaintenanceObservation,
  policy: MaintenancePolicy,
): MaintenanceRequest {
  const request = { ...candidate, requestId: uuid4(), pipeline: null };
  return policy.bounded && observation.observedAt !== undefined
    ? { ...request, queuedSince: observation.observedAt }
    : request;
}

export async function runCiMaintenanceTick(): Promise<void> {
  if (!patched(CI_MAINTENANCE_HEALTH_PATCH)) {
    await reads.wakeCiMaintenance();
    return;
  }
  // Health reads the coordinator's memo and the cluster rather than the
  // coordinator itself, so it still pages while the coordinator is wedged.
  const [wake, published] = await Promise.allSettled([
    reads.wakeCiMaintenance(),
    health.publishCiMaintenanceHealth(),
  ]);
  if (wake.status === "rejected") throw wake.reason;
  if (published.status === "fulfilled") return;
  // Delivery syncs the activity workers before it routes this workflow, so
  // this only covers a rollout that ran out of order.
  if (!isUnregisteredActivity(published.reason)) throw published.reason;
  log.warn("CI maintenance health activity is not registered yet; skipped");
}

/** Durable state survives schedules, worker replacement, and ambiguous writes. */
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
    // Operators bind a retry to the exact diagnosed request. A running or
    // unacknowledged submission must first be reconciled, never discarded.
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
      const policy: MaintenancePolicy = {
        bounded: patched(CI_MAINTENANCE_BOUNDED_PATCH),
      };
      recordMaintenanceObservation(state, observation, policy);
      await ageOutQueuedRequest(state, observation, policy);
      await selectGoldenSnapshot(state);
      if (!observation.enabled || state.pending !== null || observation.busy)
        continue;
      const candidate = nextMaintenanceCandidate(
        state,
        observation.candidates,
        policy,
      );
      if (candidate === undefined) continue;
      state.pending = newMaintenanceRequest(candidate, observation, policy);
      try {
        const receipt = await writes.submitCiMaintenance(state.pending);
        if (receipt === null) state.pending = null;
        else state.pending.pipeline = receipt;
      } catch {
        state.observation =
          "Submission outcome uncertain; retaining request ID for read-back";
      }
    } catch {
      // Read/auth/quota failure preserves all state; the next schedule may
      // retry reads but cannot repeat a pending external write.
      state.observation = "Maintenance inspection failed; no new submission";
    } finally {
      // Describe exposes this durable snapshot without a Query handler, which
      // the repository's call-graph tracing does not support.
      upsertMemo({ ciMaintenance: state });
    }
  }
  return continueAsNew<typeof runCiMaintenanceCoordinator>(state);
}
