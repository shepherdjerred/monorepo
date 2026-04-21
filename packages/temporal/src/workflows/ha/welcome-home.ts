import {
  callService,
  getEntityState,
  sendNotification,
  shouldStopVacuum,
} from "./util.ts";

const LIVING_ROOM_SCENE = "scene.living_room_bright" as const;
const ROOMBA = "vacuum.roomba" as const;

export async function welcomeHome(): Promise<void> {
  await sendNotification(
    "Welcome Home",
    "Welcome back! Hope you had a great time.",
  );

  await callService("scene", "turn_on", { entity_id: LIVING_ROOM_SCENE });

  const roomba = await getEntityState(ROOMBA);
  if (shouldStopVacuum(roomba.state)) {
    await callService("vacuum", "return_to_base", { entity_id: ROOMBA });
  }
}
