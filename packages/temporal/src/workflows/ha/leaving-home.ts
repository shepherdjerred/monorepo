import { sleep } from "@temporalio/workflow";
import {
  callServiceUnchecked,
  everyoneAway,
  getEntitiesInDomain,
  matchExact,
  sendNotification,
  startEligibleVacuums,
  verifyState,
} from "./util.ts";
import { PRESENCE_COOLDOWN_SECONDS } from "#shared/presence.ts";

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
    "Goodbye! The vacuums will start cleaning soon.",
  );

  // The front-door lock is owned by the debounced reconcileLock workflow, not
  // locked here — edge-triggered lock/unlock on raw presence flap caused the
  // door to cycle. This workflow only handles lights and the vacuums.
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

  const started = await startEligibleVacuums();
  // Verify concurrently so the fleet's sleep budget stays ~one unit's worth
  // rather than summing sequentially across all floors.
  await Promise.all(
    started.map((vacuum) =>
      verifyState(
        vacuum,
        (state) => state === "cleaning" || state === "returning",
        { delaySeconds: 5 * 60, retries: 3, retryDelaySeconds: 60 },
      ),
    ),
  );
}
