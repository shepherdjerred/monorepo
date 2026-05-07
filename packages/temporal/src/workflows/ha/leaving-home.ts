import { sleep } from "@temporalio/workflow";
import {
  callService,
  callServiceUnchecked,
  everyoneAway,
  getEntitiesInDomain,
  getEntityState,
  matchExact,
  sendNotification,
  shouldStartVacuum,
  verifyState,
} from "./util.ts";
import { PRESENCE_COOLDOWN_SECONDS } from "#shared/presence.ts";

const FRONT_DOOR_LOCK = "lock.front_door" as const;
const ROOMBA = "vacuum.roomba" as const;

export async function leavingHome(): Promise<void> {
  // HA presence routinely emits a brief not_home blip while the user is
  // stationary; wait and reconfirm before any side-effects.
  await sleep(PRESENCE_COOLDOWN_SECONDS * 1000);
  if (!(await everyoneAway())) {
    console.warn(
      JSON.stringify({
        level: "info",
        msg: "leavingHome debounced: someone is still home",
        component: "ha-presence",
        workflow: "leavingHome",
        phase: "debounced",
      }),
    );
    return;
  }

  await sendNotification(
    "Leaving Home",
    "Goodbye! The Roomba will start cleaning soon.",
  );

  await callService("lock", "lock", { entity_id: FRONT_DOOR_LOCK });

  const lights = await getEntitiesInDomain("light");
  for (const light of lights) {
    // entity_id from getEntitiesInDomain is a runtime-filtered plain string —
    // use the untyped escape hatch since TS can't prove the literal.
    await callServiceUnchecked("light", "turn_off", {
      entity_id: light.entity_id,
    });
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
