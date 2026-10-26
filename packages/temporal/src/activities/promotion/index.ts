import { randomInt } from "node:crypto";
import { Context } from "@temporalio/activity";
import { createTemporalReadClient } from "#client";
import { parseTemporalNamespace } from "#shared/infra/temporal-namespace.ts";
import { z } from "zod/v4";
import { promotionConfig } from "#config/promotion.ts";
import {
  PromotionRunInputSchema,
  nextPromotionEligibleAt,
  promotionStateSummary,
  type PromotionState,
  type PromotionTarget,
  type PromotionRunInput,
} from "#shared/promotion.ts";
import { redactSecrets } from "#shared/redact.ts";
import { agentTaskSecretTokens } from "#activities/agent/agent-task-env.ts";
import { runPromotionAgent } from "./agent.ts";
import { reconcileClosedPromotionOwner } from "./ownership.ts";
import { promotionManifest, promotionTarget } from "./manifest.ts";
import { promotionAlertFingerprint, promotionReport } from "./report.ts";
import {
  assertPromotionOwnership,
  promotionStore,
  readPromotionState,
  solverReservedMicrousd,
  SolverBudgetSchema,
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
    nextEligibleAt: nextPromotionEligibleAt(target, next, Date.now()),
  };
}

async function states() {
  const store = promotionStore();
  return await Promise.all(
    promotionManifest.targets.map((target) =>
      readPromotionState(store, target.id),
    ),
  );
}

async function solverSpend() {
  const current = await promotionStore().read(
    `solver/${new Date().toISOString().slice(0, 7)}.json`,
    SolverBudgetSchema,
  );
  return current === undefined ? 0 : solverReservedMicrousd(current.value);
}

async function inspectPromotionTick() {
  const config = await promotionConfig();
  for (const id of config.enabledTargets) promotionTarget(id);
  const store = promotionStore();
  const currentStates = await states();
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
          return description.status.name === "RUNNING";
        },
      }),
    ),
  );
  const dueTargetIds = config.enabled
    ? snapshots
        .filter(
          (state) =>
            config.enabledTargets.includes(state.targetId) &&
            !state.paused &&
            state.lock === null &&
            state.blockedReason === null &&
            promotionTarget(state.targetId).action !== "pending" &&
            (state.nextEligibleAt === null ||
              Date.parse(state.nextEligibleAt) <= Date.now()),
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
  return { dueTargetIds, alerts };
}

async function executePromotion(raw: PromotionRunInput) {
  const input = PromotionRunInputSchema.parse(raw);
  if (
    input.mode === "run" &&
    parseTemporalNamespace(Bun.env["TEMPORAL_NAMESPACE"]) !== "prod"
  )
    throw new Error("Promotion publishing requires the production namespace");
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
  if (
    input.mode === "run" &&
    (!config.enabled || !config.enabledTargets.includes(target.id))
  )
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
      (input.mode === "run" &&
        (before.paused || before.blockedReason !== null)))
  )
    return {
      targetId: target.id,
      status: "blocked",
      summary: before.blockedReason ?? "Target is paused or already owned",
    };
  const state = await updatePromotionState(store, target.id, (current) => {
    if (
      input.mode !== "reconcile" &&
      (current.lock !== null ||
        (input.mode === "run" &&
          (current.paused || current.blockedReason !== null)))
    )
      throw new Error("Promotion target is already owned or paused");
    return {
      ...current,
      lock: { occurrenceId, acquiredAt: new Date().toISOString() },
      lastOccurrenceId: occurrenceId,
    };
  });
  try {
    const outcome = await runPromotionAgent({
      target,
      state,
      occurrenceId,
      mode: input.mode,
      store,
    });
    const result = outcome.result;
    const recorded = await store.put(
      `runs/${encodeURIComponent(occurrenceId)}.json`,
      {
        result,
        usage: outcome.usage,
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
      const blockedReason = uncertain
        ? "Submission outcome uncertain; reconcile the remote result"
        : !verified && result.status === "verified"
          ? "Agent claimed publication without a verified tool receipt"
          : result.status === "blocked"
            ? result.summary
            : !verified &&
                result.status === "deferred" &&
                (current.nextEligibleAt === null ||
                  Date.parse(current.nextEligibleAt) <= Date.now())
              ? "Deferred without a future eligibility deadline; inspect current rules and history"
              : current.blockedReason;
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
        blockedReason:
          paused ||
          state.attempts.some((attempt) => attempt.status === "uncertain")
            ? state.blockedReason
            : null,
        lastAlertFingerprint: paused ? state.lastAlertFingerprint : null,
      })),
    ),
  );
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
  inspectPromotionTick,
  managePromotion,
  acknowledgePromotionAlert,
  collectPromotionDailyReport,
};
export const promotionAgentActivities = { executePromotion };
export type PromotionActivities = typeof promotionControlActivities &
  typeof promotionAgentActivities;
