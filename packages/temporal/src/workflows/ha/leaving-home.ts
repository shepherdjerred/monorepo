import {
  callService,
  getEntitiesInDomain,
  getEntityState,
  matchExact,
  sendNotification,
  shouldStartVacuum,
  verifyState,
} from "./util.ts";

const ROOMBA = "vacuum.roomba";

export async function leavingHome(): Promise<void> {
  await sendNotification(
    "Leaving Home",
    "Goodbye! The Roomba will start cleaning soon.",
  );

  const lights = await getEntitiesInDomain("light");
  for (const light of lights) {
    await callService("light", "turn_off", { entity_id: light.entity_id });
  }
  for (const light of lights) {
    await verifyState(light.entity_id, matchExact("off"), {
      delaySeconds: 10,
      retries: 0,
      retryDelaySeconds: 30,
    });
  }

  const roomba = await getEntityState(ROOMBA);
  if (shouldStartVacuum(roomba.state)) {
    await callService("vacuum", "start", { entity_id: ROOMBA });
    await verifyState(
      ROOMBA,
      (state) => state === "cleaning" || state === "returning",
      { delaySeconds: 5 * 60, retries: 3, retryDelaySeconds: 60 },
    );
  }
}
