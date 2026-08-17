import { sleep } from "@temporalio/workflow";
import { callServiceUnchecked, getEntityStateUnchecked } from "./util.ts";
import {
  MOTION_LIGHT_ROOMS,
  type MotionLightRoom,
} from "#shared/motion-light.ts";

const INACTIVITY_TIMEOUT = "5 minutes" as const;

export async function motionLight(room: MotionLightRoom): Promise<void> {
  const { motionEntityId, lightEntityId } = MOTION_LIGHT_ROOMS[room];

  await callServiceUnchecked("switch", "turn_on", {
    entity_id: lightEntityId,
  });

  let motionActive = true;
  while (motionActive) {
    await sleep(INACTIVITY_TIMEOUT);
    const motion = await getEntityStateUnchecked(motionEntityId);
    if (motion.state === "off") {
      motionActive = false;
    }
  }

  await callServiceUnchecked("switch", "turn_off", {
    entity_id: lightEntityId,
  });
}
