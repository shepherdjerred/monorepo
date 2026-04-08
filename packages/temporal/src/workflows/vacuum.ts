import { proxyActivities, sleep } from "@temporalio/workflow";
import type { HaActivities } from "#activities/ha.ts";

const { getEntityState, callService, sendNotification } =
  proxyActivities<HaActivities>({
    startToCloseTimeout: "30 seconds",
  });

type EntityState = {
  state: string;
  entity_id: string;
};

const VACUUM_CLEANABLE_STATES = new Set(["idle", "docked", "paused"]);

function shouldStartCleaning(state: string): boolean {
  return VACUUM_CLEANABLE_STATES.has(state);
}

export async function runVacuumIfNotHome(): Promise<void> {
  // Check if everyone is away
  const jerred: EntityState = await getEntityState("person.jerred");
  const shuxin: EntityState = await getEntityState("person.shuxin");

  const everyoneAway =
    jerred.state === "not_home" && shuxin.state === "not_home";

  if (!everyoneAway) {
    console.warn("Someone is home, skipping vacuum");
    return;
  }

  // Check vacuum state
  const roomba: EntityState = await getEntityState("vacuum.roomba");

  if (!shouldStartCleaning(roomba.state)) {
    console.warn(`Vacuum is ${roomba.state}, skipping`);
    return;
  }

  // Start vacuum
  await sendNotification(
    "Vacuum Started",
    "The Roomba has started cleaning since no one is home.",
  );

  await callService("vacuum", "start", {
    entity_id: "vacuum.roomba",
  });

  // Durable timer: wait 3 minutes then verify
  await sleep("3 minutes");

  const roombaAfter: EntityState = await getEntityState("vacuum.roomba");
  if (roombaAfter.state === "cleaning") {
    console.warn("Vacuum confirmed cleaning");
  } else {
    console.warn(
      `Vacuum in unexpected state after start: ${roombaAfter.state}`,
    );
  }
}
