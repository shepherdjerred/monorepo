// Retain the concurrent vacuum-start-history-v1 command sequence so executions
// recorded before serialize-vacuum-start-history replay identically.
import {
  ApplicationFailure,
  log,
  patched,
  proxyActivities,
  sleep,
  upsertMemo,
  workflowInfo,
} from "@temporalio/workflow";
import type { HaActivities } from "#activities/ha.ts";
import type { OutcomeActivities } from "#activities/outcome.ts";
import {
  isConfirmedAway,
  PRESENCE_COOLDOWN_SECONDS,
} from "#shared/infra/presence.ts";
import { TASK_QUEUES } from "#shared/task-queues.ts";

const readActivities = proxyActivities<HaActivities>({
  taskQueue: TASK_QUEUES.HOME,
  startToCloseTimeout: "30 seconds",
  retry: {
    initialInterval: "2 seconds",
    backoffCoefficient: 2,
    maximumInterval: "20 seconds",
    maximumAttempts: 6,
  },
});
const activities = proxyActivities<HaActivities>({
  taskQueue: TASK_QUEUES.HOME,
  startToCloseTimeout: "30 seconds",
  retry: { maximumAttempts: 3 },
});
const outcomes = proxyActivities<OutcomeActivities>({
  taskQueue: TASK_QUEUES.HOME,
  startToCloseTimeout: "10 seconds",
  retry: { maximumAttempts: 2 },
});

const vacuums = ["vacuum.1st_floor", "vacuum.2nd_floor", "vacuum.3rd_floor"];
const startStates = new Set(["idle", "docked", "charging", "paused"]);
const activeStates = new Set(["cleaning", "returning"]);

async function everyoneAway(): Promise<boolean> {
  const [jerred, shuxin] = await Promise.all([
    readActivities.getEntityState("person.jerred"),
    readActivities.getEntityState("person.shuxin"),
  ]);
  return patched("presence-named-zones-away-v1")
    ? isConfirmedAway(jerred.state) && isConfirmedAway(shuxin.state)
    : jerred.state === "not_home" && shuxin.state === "not_home";
}

async function setOutcome(
  outcome: "executed" | "skipped" | "interrupted",
  reason: string,
): Promise<void> {
  upsertMemo({ outcome, outcomeReason: reason });
  try {
    await outcomes.recordWorkflowOutcome({
      workflow: workflowInfo().workflowType,
      outcome,
      reason,
    });
  } catch (error) {
    log.warn(
      `setOutcome: failed to record ${outcome}/${reason}: ${String(error)}`,
    );
  }
}

async function startEligibleVacuums(): Promise<{
  active: string[];
  started: string[];
  requestedAt: Record<string, string>;
}> {
  const active: string[] = [];
  const startable: string[] = [];
  const anomalous: string[] = [];
  for (const vacuum of vacuums) {
    const state = await readActivities.getEntityState(vacuum);
    if (startStates.has(state.state)) startable.push(vacuum);
    else if (activeStates.has(state.state)) active.push(vacuum);
    else anomalous.push(`${vacuum}=${state.state}`);
  }
  if (anomalous.length > 0) {
    throw ApplicationFailure.nonRetryable(
      `Vacuum fleet has anomalous states: ${anomalous.join(", ")}`,
      "VacuumFleetStateError",
    );
  }
  const started: string[] = [];
  const requestedAt: Record<string, string> = {};
  for (const vacuum of startable) {
    requestedAt[vacuum] = new Date(Date.now()).toISOString();
    await activities.callService("vacuum", "start", { entity_id: vacuum });
    started.push(vacuum);
  }
  return { active, started, requestedAt };
}

async function verifyConcurrent(
  started: readonly string[],
  requestedAt: Record<string, string>,
  options: { delaySeconds: number; retries: number; retryDelaySeconds: number },
): Promise<boolean> {
  if (started.length === 0) return false;
  await sleep(options.delaySeconds * 1000);
  const results = await Promise.all(
    started.map(async (vacuum) => {
      const requestTime = requestedAt[vacuum];
      if (requestTime === undefined)
        throw new Error(`Missing vacuum request time for ${vacuum}`);
      for (let attempt = 0; attempt <= options.retries; attempt += 1) {
        const evidence = await readActivities.getVacuumStartEvidence(
          vacuum,
          requestTime,
        );
        if (
          evidence.started &&
          evidence.commandedReturn &&
          (startStates.has(evidence.currentState) ||
            activeStates.has(evidence.currentState))
        ) {
          return { vacuum, verified: true, interrupted: true };
        }
        if (evidence.started && activeStates.has(evidence.currentState)) {
          return { vacuum, verified: true, interrupted: false };
        }
        if (attempt < options.retries)
          await sleep(options.retryDelaySeconds * 1000);
      }
      return { vacuum, verified: false, interrupted: false };
    }),
  );
  const failed = results
    .filter((result) => !result.verified)
    .map((result) => result.vacuum);
  if (failed.length > 0) {
    throw ApplicationFailure.nonRetryable(
      `Vacuum start verification failed: ${failed.join(", ")} did not become active or was stopped without a return command`,
      "VacuumStartVerificationError",
    );
  }
  return results.some((result) => result.interrupted);
}

export async function runVacuumIfNotHome(): Promise<void> {
  if (!(await everyoneAway())) {
    await setOutcome("skipped", "someone-home");
    return;
  }
  patched("vacuum-start-history-v1");
  const { active, started, requestedAt } = await startEligibleVacuums();
  if (started.length === 0) {
    if (active.length !== vacuums.length) {
      throw ApplicationFailure.nonRetryable(
        `Vacuum fleet classification is incomplete: ${String(active.length)} of ${String(vacuums.length)} units are active`,
        "VacuumFleetClassificationError",
      );
    }
    await setOutcome("skipped", "all-units-active");
    return;
  }
  await activities.sendNotification(
    "Vacuum Started",
    `The vacuums have started cleaning since no one is home (${String(started.length)} of ${String(vacuums.length)} floors).`,
  );
  const interrupted = await verifyConcurrent(started, requestedAt, {
    delaySeconds: 180,
    retries: 3,
    retryDelaySeconds: 60,
  });
  if (interrupted) {
    await setOutcome("interrupted", "commanded-return");
    return;
  }
  await setOutcome("executed", "started");
}

export async function leavingHome(): Promise<void> {
  await sleep(PRESENCE_COOLDOWN_SECONDS * 1000);
  if (!(await everyoneAway())) return;
  await activities.sendNotification(
    "Leaving Home",
    "Goodbye! The vacuums will start cleaning soon.",
  );
  const lights = await readActivities.getEntitiesInDomain("light");
  for (const light of lights) {
    await activities.callService("light", "turn_off", {
      entity_id: light.entity_id,
    });
  }
  for (const light of lights) {
    await sleep(10_000);
    await readActivities.getEntityState(light.entity_id);
  }
  patched("vacuum-start-history-v1");
  const { started, requestedAt } = await startEligibleVacuums();
  const interrupted = await verifyConcurrent(started, requestedAt, {
    delaySeconds: 300,
    retries: 3,
    retryDelaySeconds: 60,
  });
  if (interrupted) await setOutcome("interrupted", "commanded-return");
}
