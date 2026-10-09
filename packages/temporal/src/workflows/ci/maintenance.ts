import {
  condition,
  continueAsNew,
  defineSignal,
  proxyActivities,
  setHandler,
  uuid4,
  upsertMemo,
} from "@temporalio/workflow";
import type { CiMaintenanceActivities } from "#activities/maintenance/ci-maintenance.ts";
import {
  initialMaintenanceState,
  nextMaintenanceCandidate,
  recordMaintenanceObservation,
  type MaintenanceState,
  type CiMaintenanceKind,
} from "#shared/ci-maintenance.ts";
import { TASK_QUEUES } from "#shared/task-queues.ts";

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
export const maintenanceTick = defineSignal("maintenanceTick");
export const maintenanceRetry =
  defineSignal<[{ kind: CiMaintenanceKind; requestId: string }]>(
    "maintenanceRetry",
  );
export const maintenanceConfirmAbsent = defineSignal<
  [{ requestId: string; evidence: string }]
>("maintenanceConfirmAbsent");

export async function runCiMaintenanceTick(): Promise<void> {
  await reads.wakeCiMaintenance();
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
      recordMaintenanceObservation(state, observation);
      if (!observation.enabled || state.pending !== null || observation.busy)
        continue;
      const candidate = nextMaintenanceCandidate(state, observation.candidates);
      if (candidate === undefined) continue;
      // Recorded before the write activity; replay never invents another ID.
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
