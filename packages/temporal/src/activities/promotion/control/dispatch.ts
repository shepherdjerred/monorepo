import { Context } from "@temporalio/activity";
import { createTemporalReadClient } from "#client";
import { parseTemporalNamespace } from "#shared/infra/temporal-namespace.ts";
import { promotionConfig } from "#config/promotion.ts";
import { promotionDispatchAt, promotionRunBlocked } from "#shared/promotion.ts";
import { promotionWindow } from "#shared/promotion/cadence.ts";
import {
  promotionManifest,
  promotionTarget,
} from "#activities/promotion/manifest.ts";
import {
  promotionAlertFingerprint,
  promotionReport,
} from "#activities/promotion/report.ts";
import {
  promotionStore,
  readPromotionState,
  solverReservedMicrousd,
  SolverBudgetSchema,
} from "#activities/promotion/store.ts";
import { reconcileClosedPromotionOwner } from "./ownership.ts";
import { reserveReconciliation } from "./reconciliation.ts";
import { beginPromotionBatch } from "./batches.ts";
export async function states() {
  const store = promotionStore();
  return await Promise.all(
    promotionManifest.targets.map((target) =>
      readPromotionState(store, target.id),
    ),
  );
}

export async function solverSpend() {
  const current = await promotionStore().read(
    `solver/${new Date().toISOString().slice(0, 7)}.json`,
    SolverBudgetSchema,
  );
  return current === undefined ? 0 : solverReservedMicrousd(current.value);
}

function currentPromotionExecution() {
  const execution = Context.current().info.workflowExecution;
  if (execution === undefined)
    throw new Error("Promotion requires a Workflow-owned Activity");
  return execution;
}

export async function inspectPromotionTick(scheduled = false) {
  const config = await promotionConfig();
  for (const id of config.enabledTargets) promotionTarget(id);
  const store = promotionStore();
  const currentStates = await states();
  const liveOwners = new Set<string>();
  const snapshots = await Promise.all(
    currentStates.map((state) =>
      reconcileClosedPromotionOwner({
        store,
        state,
        ownerRunning: async (workflowId, runId) => {
          const client = await createTemporalReadClient(
            parseTemporalNamespace(Bun.env["TEMPORAL_NAMESPACE"]),
          );
          const description = await client.workflow
            .getHandle(workflowId, runId)
            .describe();
          const running = description.status.name === "RUNNING";
          if (running) liveOwners.add(state.targetId);
          return running;
        },
      }),
    ),
  );
  const dueTargetIds = config.enabled
    ? snapshots
        .filter(
          (state) =>
            config.enabledTargets.includes(state.targetId) &&
            !promotionRunBlocked(state) &&
            state.lock === null &&
            !["pending", "inspect"].includes(
              promotionTarget(state.targetId).action,
            ) &&
            (scheduled
              ? promotionWindow(
                  promotionTarget(state.targetId),
                  state,
                  Date.now(),
                ).canDispatch
              : promotionDispatchAt(promotionTarget(state.targetId), state) <=
                Date.now()),
        )
        .map((state) => state.targetId)
    : [];
  const spend = await solverSpend();
  const alerts = snapshots.flatMap((state) => {
    const fingerprint = promotionAlertFingerprint(state);
    return fingerprint === null || fingerprint === state.lastAlertFingerprint
      ? []
      : [
          {
            targetId: state.targetId,
            fingerprint,
            report: promotionReport([state], spend, fingerprint),
          },
        ];
  });
  const batchId =
    scheduled && config.enabled
      ? `production/${currentPromotionExecution().runId}`
      : null;
  const reconcileTargetIds: string[] = [];
  if (batchId !== null)
    for (const state of snapshots) {
      if (
        config.enabledTargets.includes(state.targetId) &&
        !liveOwners.has(state.targetId) &&
        (await reserveReconciliation(store, state, batchId))
      )
        reconcileTargetIds.push(state.targetId);
    }
  if (batchId !== null)
    await beginPromotionBatch({
      store,
      id: batchId,
      targets: promotionManifest.targets,
      states: snapshots,
      selected: [...dueTargetIds, ...reconcileTargetIds],
    });
  return {
    dueTargetIds,
    alerts,
    batchId,
    reconcileTargetIds,
    notBefore: Object.fromEntries(
      snapshots.map((state) => [
        state.targetId,
        new Date(
          Math.max(
            Date.now(),
            promotionDispatchAt(promotionTarget(state.targetId), state),
          ),
        ).toISOString(),
      ]),
    ),
  };
}
