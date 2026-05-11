import {
  callService,
  everyoneAway,
  getEntityState,
  sendNotification,
  setOutcome,
  shouldStartVacuum,
  verifyState,
} from "./util.ts";

const ROOMBA = "vacuum.roomba" as const;

export async function runVacuumIfNotHome(): Promise<void> {
  if (!(await everyoneAway())) {
    console.warn("Someone is home, skipping vacuum");
    await setOutcome("skipped", "someone-home");
    return;
  }

  const roomba = await getEntityState(ROOMBA);
  if (!shouldStartVacuum(roomba.state)) {
    console.warn(`Vacuum is ${roomba.state}, skipping`);
    await setOutcome("skipped", `vacuum-state-${roomba.state}`);
    return;
  }

  await sendNotification(
    "Vacuum Started",
    "The Roomba has started cleaning since no one is home.",
  );
  await callService("vacuum", "start", { entity_id: ROOMBA });

  await verifyState(
    ROOMBA,
    (state) => state === "cleaning" || state === "returning",
    { delaySeconds: 3 * 60, retries: 3, retryDelaySeconds: 60 },
  );
  await setOutcome("executed", "started");
}
