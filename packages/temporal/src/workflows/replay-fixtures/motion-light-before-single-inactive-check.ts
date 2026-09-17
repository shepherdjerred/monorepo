import { CancellationScope, sleep } from "@temporalio/workflow";
import {
  callServiceForCleanup,
  callServiceUnchecked,
  getEntityStateUnchecked,
} from "#workflows/ha/util.ts";
import {
  MOTION_LIGHT_ROOMS,
  type MotionLightRoom,
} from "#shared/infra/motion-light.ts";

const INACTIVITY_CHECK_INTERVAL = "5 minutes" as const;

export async function motionLight(room: MotionLightRoom): Promise<void> {
  const { motionEntityId, lightEntityId } = MOTION_LIGHT_ROOMS[room];

  try {
    await callServiceUnchecked("switch", "turn_on", {
      entity_id: lightEntityId,
    });

    let inactive = false;
    while (!inactive) {
      await sleep(INACTIVITY_CHECK_INTERVAL);
      const motion = await getEntityStateUnchecked(motionEntityId);
      if (motion.state !== "off") {
        continue;
      }

      await sleep(INACTIVITY_CHECK_INTERVAL);
      const stillInactive = await getEntityStateUnchecked(motionEntityId);
      inactive = stillInactive.state === "off";
    }
  } finally {
    await CancellationScope.nonCancellable(() =>
      callServiceForCleanup("switch", "turn_off", {
        entity_id: lightEntityId,
      }),
    );
  }
}
