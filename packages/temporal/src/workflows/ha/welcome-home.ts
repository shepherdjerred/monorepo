import { sleep } from "@temporalio/workflow";
import {
  anyoneHome,
  callService,
  getEntityState,
  sendNotification,
  shouldStopVacuum,
} from "./util.ts";
import { PRESENCE_COOLDOWN_SECONDS } from "#shared/presence.ts";

const LIVING_ROOM_SCENE = "scene.living_room_bright" as const;
const FRONT_DOOR_LOCK = "lock.front_door" as const;
const ENTRYWAY_LIGHT = "switch.light_2" as const;
const FRONT_DOOR_LIGHT = "switch.light" as const;
const SUN = "sun.sun" as const;
const ROOMBA = "vacuum.roomba" as const;
const Q7_MAX = "vacuum.q7_max" as const;
const VACUUMS = [ROOMBA, Q7_MAX] as const;

/**
 * Runs on every arrival (`not_home` → `home`), not just when the house was
 * empty. `firstArrival` is true when this person arrived to an otherwise-empty
 * house — only then do we send the welcome notification and dock the vacuums
 * (vacuums only run while the house is empty). Unlocking and lights happen on
 * every arrival so the door/lights are always handled, even if someone else is
 * already home.
 */
export async function welcomeHome(firstArrival = true): Promise<void> {
  // HA presence routinely emits a brief home blip from a single bad reading;
  // wait and reconfirm before any side-effects.
  await sleep(PRESENCE_COOLDOWN_SECONDS * 1000);
  if (!(await anyoneHome())) {
    console.warn(
      JSON.stringify({
        level: "info",
        msg: "welcomeHome debounced: no one is home",
        component: "ha-presence",
        workflow: "welcomeHome",
        phase: "debounced",
      }),
    );
    return;
  }

  if (firstArrival) {
    await sendNotification(
      "Welcome Home",
      "Welcome back! Hope you had a great time.",
    );
  }

  await callService("lock", "unlock", { entity_id: FRONT_DOOR_LOCK });

  await callService("scene", "turn_on", { entity_id: LIVING_ROOM_SCENE });

  const sun = await getEntityState(SUN);
  if (sun.state === "below_horizon") {
    await callService("switch", "turn_on", { entity_id: ENTRYWAY_LIGHT });
    await callService("switch", "turn_on", { entity_id: FRONT_DOOR_LIGHT });
  }

  if (firstArrival) {
    for (const vacuum of VACUUMS) {
      const state = await getEntityState(vacuum);
      if (shouldStopVacuum(state.state)) {
        await callService("vacuum", "return_to_base", { entity_id: vacuum });
      }
    }
  }
}
