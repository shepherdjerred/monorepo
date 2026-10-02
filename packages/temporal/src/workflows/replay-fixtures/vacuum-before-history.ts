// Retain the pre-history command sequence to verify old executions replay.
import {
  ApplicationFailure,
  log,
  proxyActivities,
  sleep,
  upsertMemo,
  workflowInfo,
} from "@temporalio/workflow";
import type { HaActivities } from "#activities/ha.ts";
import type { OutcomeActivities } from "#activities/outcome.ts";

const activities = proxyActivities<HaActivities>({
  taskQueue: "home",
  startToCloseTimeout: "30 seconds",
  retry: { maximumAttempts: 3 },
});
const outcomes = proxyActivities<OutcomeActivities>({
  taskQueue: "home",
  startToCloseTimeout: "10 seconds",
  retry: { maximumAttempts: 2 },
});
const vacuums = ["vacuum.1st_floor", "vacuum.2nd_floor", "vacuum.3rd_floor"];
const startStates = new Set(["idle", "docked", "charging", "paused"]);
const activeStates = new Set(["cleaning", "returning"]);

type HistoricalVerificationOptions = {
  delaySeconds: number;
  retries: number;
  retryDelaySeconds: number;
};

async function everyoneAway(): Promise<boolean> {
  const [jerred, shuxin] = await Promise.all([
    activities.getEntityState("person.jerred"),
    activities.getEntityState("person.shuxin"),
  ]);
  return jerred.state === "not_home" && shuxin.state === "not_home";
}

async function setOutcome(
  outcome: "executed" | "skipped",
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
}> {
  const active: string[] = [];
  const startable: string[] = [];
  const anomalous: string[] = [];
  for (const vacuum of vacuums) {
    const state = await activities.getEntityState(vacuum);
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
  for (const vacuum of startable) {
    await activities.callService("vacuum", "start", { entity_id: vacuum });
    started.push(vacuum);
  }
  return { active, started };
}

async function verifyState(
  entityId: string,
  matches: (state: string) => boolean,
  options: HistoricalVerificationOptions,
): Promise<boolean> {
  await sleep(options.delaySeconds * 1000);
  let remainingRetries = options.retries;
  while (remainingRetries >= 0) {
    const state = await activities.getEntityState(entityId);
    if (matches(state.state)) return true;
    if (remainingRetries > 0) await sleep(options.retryDelaySeconds * 1000);
    remainingRetries -= 1;
  }
  log.warn("Home Assistant entity verification failed", { entityId });
  return false;
}

async function verifyStartedVacuums(
  started: string[],
  options: HistoricalVerificationOptions,
): Promise<void> {
  const failures = await Promise.all(
    started.map(async (vacuum) => {
      const verified = await verifyState(
        vacuum,
        (state) => activeStates.has(state),
        options,
      );
      return verified ? undefined : vacuum;
    }),
  );
  const failed = failures.filter((vacuum) => vacuum !== undefined);
  if (failed.length > 0) {
    throw ApplicationFailure.nonRetryable(
      `Vacuum start verification failed: ${failed.join(", ")} did not become active`,
      "VacuumStartVerificationError",
    );
  }
}

export async function runVacuumIfNotHome(): Promise<void> {
  if (!(await everyoneAway())) {
    log.info("Skipping vacuum run", { reason: "someone-home" });
    await setOutcome("skipped", "someone-home");
    return;
  }
  const { active, started } = await startEligibleVacuums();
  if (started.length === 0) {
    if (active.length !== vacuums.length) {
      throw ApplicationFailure.nonRetryable(
        `Vacuum fleet classification is incomplete: ${String(active.length)} of ${String(vacuums.length)} units are active`,
        "VacuumFleetClassificationError",
      );
    }
    log.info("Skipping vacuum run", { reason: "all-units-active" });
    await setOutcome("skipped", "all-units-active");
    return;
  }
  await activities.sendNotification(
    "Vacuum Started",
    `The vacuums have started cleaning since no one is home (${String(started.length)} of ${String(vacuums.length)} floors).`,
  );
  await verifyStartedVacuums(started, {
    delaySeconds: 180,
    retries: 3,
    retryDelaySeconds: 60,
  });
  await setOutcome("executed", "started");
}

export async function leavingHome(): Promise<void> {
  await sleep(90 * 1000);
  if (!(await everyoneAway())) {
    log.info("Leaving-home presence event debounced", {
      reason: "someone-still-home",
      phase: "debounced",
    });
    return;
  }
  await activities.sendNotification(
    "Leaving Home",
    "Goodbye! The vacuums will start cleaning soon.",
  );
  const lights = await activities.getEntitiesInDomain("light");
  for (const light of lights)
    await activities.callService("light", "turn_off", {
      entity_id: light.entity_id,
    });
  for (const light of lights) {
    await verifyState(light.entity_id, (state) => state === "off", {
      delaySeconds: 10,
      retries: 0,
      retryDelaySeconds: 30,
    });
  }
  const { started } = await startEligibleVacuums();
  await verifyStartedVacuums(started, {
    delaySeconds: 300,
    retries: 3,
    retryDelaySeconds: 60,
  });
}
