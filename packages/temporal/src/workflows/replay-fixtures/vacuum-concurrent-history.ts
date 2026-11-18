// Records the concurrent vacuum-start-history-v1 command sequence (before
// serialize-vacuum-start-history) so retained histories replay cleanly.
import {
  patched,
  proxyActivities,
  sleep,
  upsertMemo,
  workflowInfo,
} from "@temporalio/workflow";
import type { HaActivities } from "#activities/ha.ts";
import type { OutcomeActivities } from "#activities/outcome.ts";
import { PRESENCE_COOLDOWN_SECONDS } from "#shared/infra/presence.ts";
import { TASK_QUEUES } from "#shared/task-queues.ts";

const home = proxyActivities<HaActivities>({
  taskQueue: TASK_QUEUES.HOME,
  startToCloseTimeout: "30 seconds",
  retry: { maximumAttempts: 3 },
});
const outcomes = proxyActivities<OutcomeActivities>({
  taskQueue: TASK_QUEUES.HOME,
  startToCloseTimeout: "10 seconds",
  retry: { maximumAttempts: 2 },
});

const FLEET = [
  "vacuum.1st_floor",
  "vacuum.2nd_floor",
  "vacuum.3rd_floor",
] as const;

async function confirmEveryoneAway(): Promise<void> {
  await Promise.all([
    home.getEntityState("person.jerred"),
    home.getEntityState("person.shuxin"),
  ]);
  patched("presence-named-zones-away-v1");
}

async function startFleet(): Promise<Map<string, string>> {
  patched("vacuum-start-history-v1");
  const requestedAt = new Map<string, string>();
  for (const unit of FLEET) {
    await home.getEntityState(unit);
  }
  for (const unit of FLEET) {
    requestedAt.set(unit, new Date(Date.now()).toISOString());
    await home.callService("vacuum", "start", { entity_id: unit });
  }
  return requestedAt;
}

async function verifyConcurrently(
  requestedAt: Map<string, string>,
  delayMs: number,
): Promise<void> {
  await sleep(delayMs);
  await Promise.all(
    FLEET.map((unit) =>
      home.getVacuumStartEvidence(unit, requestedAt.get(unit) ?? ""),
    ),
  );
}

export async function runVacuumIfNotHome(): Promise<void> {
  await confirmEveryoneAway();
  const requestedAt = await startFleet();
  await home.sendNotification(
    "Vacuum Started",
    "The vacuums have started cleaning since no one is home (3 of 3 floors).",
  );
  await verifyConcurrently(requestedAt, 180_000);
  upsertMemo({ outcome: "executed", outcomeReason: "started" });
  await outcomes.recordWorkflowOutcome({
    workflow: workflowInfo().workflowType,
    outcome: "executed",
    reason: "started",
  });
}

export async function leavingHome(): Promise<void> {
  await sleep(PRESENCE_COOLDOWN_SECONDS * 1000);
  await confirmEveryoneAway();
  await home.sendNotification(
    "Leaving Home",
    "Goodbye! The vacuums will start cleaning soon.",
  );
  const lights = await home.getEntitiesInDomain("light");
  for (const light of lights) {
    await home.callService("light", "turn_off", { entity_id: light.entity_id });
  }
  for (const light of lights) {
    await sleep(10_000);
    await home.getEntityState(light.entity_id);
  }
  const requestedAt = await startFleet();
  await verifyConcurrently(requestedAt, 300_000);
}
