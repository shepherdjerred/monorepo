import { randomInt } from "node:crypto";
import { Context } from "@temporalio/activity";
import {
  states,
  solverSpend,
  inspectPromotionTick,
} from "./control/dispatch.ts";
import { parseTemporalNamespace } from "#shared/infra/temporal-namespace.ts";
import { z } from "zod/v4";
import { promotionConfig } from "#config/promotion.ts";
import {
  PromotionRunInputSchema,
  promotionDispatchAt,
  promotionRunBlocked,
  nextPromotionEligibleAt,
  promotionStateSummary,
  type PromotionState,
  type PromotionTarget,
  type PromotionRunInput,
} from "#shared/promotion/model.ts";
import { redactSecrets } from "#shared/redact.ts";
import { agentTaskSecretTokens } from "#activities/agent/agent-task-env.ts";
import { runBudgetedPromotion } from "./control/budgeted-agent.ts";
import type { PromotionTaskResult } from "./publication/task-contract.ts";
import { promotionManifest, promotionTarget } from "./manifest.ts";
import { promotionAlertFingerprint, promotionReport } from "./report.ts";
import { recordPromotionExecutionHealth } from "./control/execution-health.ts";
import { PromotionBudgetStop } from "./control/budget.ts";
import { promotionWindow } from "#shared/promotion/cadence.ts";
import { trackPromotionExecution } from "./control/tracked-execution.ts";
import { resetReconciliation } from "./control/reconciliation.ts";
import { finishPromotionBatch } from "./control/batches.ts";
import {
  assertPromotionOwnership,
  promotionStore,
  readPromotionState,
  updatePromotionState,
} from "./store.ts";

export const PromotionControlSchema = z.strictObject({
  operation: z.enum(["status", "pause", "resume"]),
  targetId: z.string().optional(),
});

function verifiedOccurrence(
  current: PromotionState,
  started: PromotionState,
  occurrenceId: string,
  reconcile: boolean,
): boolean {
  return current.attempts.some(
    (attempt) =>
      attempt.status === "verified" &&
      (attempt.occurrenceId === occurrenceId ||
        (reconcile &&
          started.attempts.some(
            (old) =>
              old.occurrenceId === attempt.occurrenceId &&
              old.status === "uncertain",
          ))),
  );
}

function scheduleAfterReceipt(
  target: PromotionTarget,
  state: PromotionState,
  verified: boolean,
): PromotionState {
  if (!verified) return state;
  const next = { ...state, bufferSeconds: randomInt(900, 1801) };
  return {
    ...next,
    nextEligibleAt:
      next.preflight === null
        ? new Date(
            Math.max(
              next.nextEligibleAt === null
                ? 0
                : Date.parse(next.nextEligibleAt),
              ...next.attempts
                .filter((item) => item.status !== "no-action")
                .map(
                  (item) =>
                    Date.parse(item.settledAt ?? item.attemptedAt) +
                    (target.minimumIntervalSeconds + next.bufferSeconds) * 1000,
                ),
            ),
          ).toISOString()
        : nextPromotionEligibleAt(target, next, Date.now()),
  };
}

function executionBlocker(
  state: PromotionState,
  result: PromotionTaskResult,
  verified: boolean,
  uncertain: boolean,
): string | null {
  if (uncertain)
    return "Submission outcome uncertain; reconcile the remote result";
  if (!verified && result.status === "verified")
    return "Agent claimed publication without a verified browser receipt";
  if (result.status === "blocked") return result.summary;
  return !verified &&
    result.status === "deferred" &&
    result.nativeCooldownObserved !== true &&
    (state.nextEligibleAt === null ||
      Date.parse(state.nextEligibleAt) <= Date.now())
    ? "Site cooldown was reported without a future deadline"
    : null;
}

function assertPublishingNamespace(mode: PromotionRunInput["mode"]): void {
  if (
    mode === "run" &&
    parseTemporalNamespace(Bun.env["TEMPORAL_NAMESPACE"]) !== "prod"
  )
    throw new Error("Promotion publishing requires the production namespace");
}

function scheduledWindowAllowed(
  input: PromotionRunInput,
  target: PromotionTarget,
  state: PromotionState,
) {
  return (
    input.mode === "reconcile" ||
    input.scheduled !== true ||
    promotionWindow(target, state, Date.now()).allowed
  );
}

async function executePromotion(raw: PromotionRunInput) {
  return await trackPromotionExecution(raw, executePromotionTask);
}

function publishingDisabled(
  input: PromotionRunInput,
  target: PromotionTarget,
  config: Awaited<ReturnType<typeof promotionConfig>>,
) {
  return (
    input.mode === "run" &&
    (!config.enabled || !config.enabledTargets.includes(target.id))
  );
}

async function executePromotionTask(raw: PromotionRunInput) {
  const input = PromotionRunInputSchema.parse(raw);
  assertPublishingNamespace(input.mode);
  const target = promotionTarget(input.targetId);
  const store = promotionStore();
  const info = Context.current().info;
  if (info.workflowExecution === undefined)
    throw new Error("Promotion requires a Workflow-owned Activity");
  if (info.workflowExecution.workflowId !== `storm-promotion/${target.id}`)
    throw new Error("Promotion Workflow ID must be storm-promotion/<targetId>");
  const occurrenceId = `${info.workflowExecution.workflowId}/${info.workflowExecution.runId}`;
  const before = await readPromotionState(store, target.id);
  const config = await promotionConfig();
  if (!scheduledWindowAllowed(input, target, before))
    return {
      targetId: target.id,
      status: "deferred",
      summary: "Outside preferred window or daily action limit reached",
    };
  if (publishingDisabled(input, target, config))
    return {
      targetId: target.id,
      status: "deferred",
      summary: "Target publishing is disabled",
    };
  if (target.action === "pending")
    return { targetId: target.id, status: "blocked", summary: target.notes };
  if (
    input.mode !== "reconcile" &&
    (before.lock !== null ||
      (input.mode === "run" && promotionRunBlocked(before)))
  )
    return {
      targetId: target.id,
      status: "blocked",
      summary: before.blockedReason ?? "Target is paused or already owned",
    };
  const dispatchAt = promotionDispatchAt(target, before);
  if (input.mode === "run" && dispatchAt > Date.now())
    return {
      targetId: target.id,
      status: "deferred",
      summary: `Caller schedule defers this action until ${new Date(dispatchAt).toISOString()}`,
    };
  const state = await updatePromotionState(store, target.id, (current) => {
    if (
      input.mode !== "reconcile" &&
      (current.lock !== null ||
        (input.mode === "run" && promotionRunBlocked(current)))
    )
      throw new Error("Promotion target is already owned or paused");
    if (
      input.mode === "run" &&
      promotionDispatchAt(target, current) > Date.now()
    )
      throw new Error("Caller schedule changed before executor claim");
    return {
      ...current,
      lock: { occurrenceId, acquiredAt: new Date().toISOString() },
      lastOccurrenceId: occurrenceId,
    };
  });
  try {
    const outcome = await runBudgetedPromotion(
      {
        ...(input.batchId === undefined ? {} : { batchId: input.batchId }),
        ...(input.scheduled === true ? { scheduled: true } : {}),
        target,
        state,
        occurrenceId,
        mode: input.mode,
        store,
      },
      { model: config.model, dailySpendUsd: config.dailySpendUsd },
    );
    const result = outcome.result;
    const recorded = await store.put(
      `runs/${encodeURIComponent(occurrenceId)}.json`,
      {
        result,
        usage: outcome.usage,
        browserTrace: outcome.browserTrace,
        targetId: target.id,
        completedAt: new Date().toISOString(),
      },
      undefined,
    );
    if (!recorded) throw new Error("Promotion run audit already exists");
    const settled = await updatePromotionState(store, target.id, (current) => {
      assertPromotionOwnership(current, occurrenceId);
      const uncertain = current.attempts.some(
        (attempt) => attempt.status === "uncertain",
      );
      const verified = verifiedOccurrence(
        current,
        state,
        occurrenceId,
        input.mode === "reconcile",
      );
      const blockedReason = executionBlocker(
        current,
        result,
        verified,
        uncertain,
      );
      const next = {
        ...current,
        blockedReason,
        lock: uncertain ? current.lock : null,
      };
      return scheduleAfterReceipt(target, next, verified);
    });
    return {
      targetId: target.id,
      status: settled.blockedReason === null ? result.status : "blocked",
      summary: settled.blockedReason ?? result.summary,
    };
  } catch (error: unknown) {
    return await failedExecution({
      store,
      target,
      occurrenceId,
      state,
      mode: input.mode,
      error,
    });
  }
}

async function failedExecution(input: {
  store: ReturnType<typeof promotionStore>;
  target: PromotionTarget;
  occurrenceId: string;
  state: PromotionState;
  mode: PromotionRunInput["mode"];
  error: unknown;
}) {
  const { store, target, occurrenceId, state, error } = input;
  if (error instanceof PromotionBudgetStop) {
    await updatePromotionState(store, target.id, (current) => {
      assertPromotionOwnership(current, occurrenceId);
      return { ...current, lock: null };
    });
    return {
      targetId: target.id,
      status: "deferred",
      summary: error.message,
    };
  }
  await recordPromotionExecutionHealth({
    store,
    targetId: target.id,
    occurrenceId,
    mode: input.mode,
    outcome: "failure",
  });
  const reason = redactSecrets(
    error instanceof Error ? error.message : String(error),
    agentTaskSecretTokens(undefined),
  );
  await updatePromotionState(store, target.id, (current) => {
    assertPromotionOwnership(current, occurrenceId);
    const uncertain = current.attempts.some(
      (attempt) => attempt.status === "uncertain",
    );
    return scheduleAfterReceipt(
      target,
      {
        ...current,
        lock: uncertain ? current.lock : null,
        blockedReason: reason,
      },
      verifiedOccurrence(
        current,
        state,
        occurrenceId,
        input.mode === "reconcile",
      ),
    );
  });
  return { targetId: target.id, status: "blocked", summary: reason };
}

async function managePromotion(raw: z.infer<typeof PromotionControlSchema>) {
  const input = PromotionControlSchema.parse(raw);
  const targets =
    input.targetId === undefined
      ? promotionManifest.targets
      : [promotionTarget(input.targetId)];
  if (input.operation === "status")
    return await Promise.all(
      targets.map(async (target) =>
        promotionStateSummary(
          await readPromotionState(promotionStore(), target.id),
        ),
      ),
    );
  const paused = input.operation === "pause";
  const changed = await Promise.all(
    targets.map((target) =>
      updatePromotionState(promotionStore(), target.id, (state) => ({
        ...state,
        paused,
        executionHealth: paused
          ? state.executionHealth
          : {
              consecutiveFailures: 0,
              lastOccurrenceId: state.executionHealth.lastOccurrenceId,
            },
        blockedReason:
          paused ||
          state.attempts.some((attempt) => attempt.status === "uncertain")
            ? state.blockedReason
            : null,
        lastAlertFingerprint: paused ? state.lastAlertFingerprint : null,
      })),
    ),
  );
  if (!paused)
    for (const state of changed)
      await resetReconciliation(promotionStore(), state);
  return changed.map((state) => promotionStateSummary(state));
}

async function acknowledgePromotionAlert(
  targetId: string,
  fingerprint: string,
) {
  promotionTarget(targetId);
  await updatePromotionState(promotionStore(), targetId, (state) =>
    promotionAlertFingerprint(state) === fingerprint
      ? { ...state, lastAlertFingerprint: fingerprint }
      : state,
  );
}

async function collectPromotionDailyReport() {
  return promotionReport(await states(), await solverSpend());
}

export const promotionControlActivities = {
  finishPromotionBatch: async (input: { id: string; overlaps: string[] }) =>
    finishPromotionBatch({ ...input, store: promotionStore() }),
  inspectPromotionTick,
  managePromotion,
  acknowledgePromotionAlert,
  collectPromotionDailyReport,
};
export const promotionAgentActivities = { executePromotion };
export type PromotionActivities = typeof promotionControlActivities &
  typeof promotionAgentActivities;
