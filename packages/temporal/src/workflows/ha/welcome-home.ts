import {
  callService,
  getEntityState,
  matchExact,
  sendNotification,
  shouldStopVacuum,
  verifyState,
} from "./util.ts";

const ENTRYWAY_LIGHT = "switch.entryway_overhead_lights";
const LIVING_ROOM_SCENE = "scene.living_room_main_bright";
const ROOMBA = "vacuum.roomba";

export async function welcomeHome(): Promise<void> {
  await sendNotification(
    "Welcome Home",
    "Welcome back! Hope you had a great time.",
  );

  await callService("switch", "turn_on", { entity_id: ENTRYWAY_LIGHT });
  await verifyState(ENTRYWAY_LIGHT, matchExact("on"), {
    delaySeconds: 10,
    retries: 0,
    retryDelaySeconds: 30,
  });

  await callService("scene", "turn_on", { entity_id: LIVING_ROOM_SCENE });

  const roomba = await getEntityState(ROOMBA);
  if (shouldStopVacuum(roomba.state)) {
    await callService("vacuum", "return_to_base", { entity_id: ROOMBA });
  }
}
