import { CancellationScope, patched, sleep } from "@temporalio/workflow";
import {
  callServiceForCleanup,
  callServiceUnchecked,
  getEntityStateUnchecked,
} from "./util.ts";
import {
  MOTION_LIGHT_ROOMS,
  type MotionLightRoom,
} from "#shared/infra/motion-light.ts";

const INACTIVITY_CHECK_INTERVAL = "5 minutes" as const;
const SINGLE_INACTIVE_CHECK_PATCH = "motion-light-single-inactive-check-v1";

export async function motionLight(room: MotionLightRoom): Promise<void> {
  const { motionEntityId, lightEntityId } = MOTION_LIGHT_ROOMS[room];
  const useSingleInactiveCheck = patched(SINGLE_INACTIVE_CHECK_PATCH);

  try {
    await callServiceUnchecked("switch", "turn_on", {
      entity_id: lightEntityId,
    });

    for (;;) {
      await sleep(INACTIVITY_CHECK_INTERVAL);
      const motion = await getEntityStateUnchecked(motionEntityId);
      if (motion.state !== "off") {
        continue;
      }

      if (useSingleInactiveCheck) {
        return;
      }

      await sleep(INACTIVITY_CHECK_INTERVAL);
      const stillInactive = await getEntityStateUnchecked(motionEntityId);
      if (stillInactive.state === "off") {
        return;
      }
    }
  } finally {
    await CancellationScope.nonCancellable(() =>
      callServiceForCleanup("switch", "turn_off", {
        entity_id: lightEntityId,
      }),
    );
  }
}
