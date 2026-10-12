import { log, sleep, patched } from "@temporalio/workflow";
import {
  callServiceUnchecked,
  everyoneAway,
  getEntitiesInDomain,
  matchExact,
  sendNotification,
  startEligibleVacuums,
  verifyState,
  verifyStartedVacuums,
  verifyVacuumStartHistory,
  VACUUM_HISTORY_PATCH,
  setOutcome,
} from "./util.ts";
import { PRESENCE_COOLDOWN_SECONDS } from "#shared/infra/presence.ts";

export async function leavingHome(): Promise<void> {
  // HA presence routinely emits a brief not_home blip while the user is
  // stationary; wait and reconfirm before any side-effects.
  await sleep(PRESENCE_COOLDOWN_SECONDS * 1000);
  if (!(await everyoneAway())) {
    log.info("Leaving-home presence event debounced", {
      reason: "someone-still-home",
      phase: "debounced",
    });
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

  const useHistory = patched(VACUUM_HISTORY_PATCH);
  const { started, requestedAt } = await startEligibleVacuums();
  // Verify concurrently so the fleet's sleep budget stays ~one unit's worth
  // rather than summing sequentially across all floors.
  const options = {
    delaySeconds: 5 * 60,
    retries: 3,
    retryDelaySeconds: 60,
  };
  if (useHistory) {
    const interrupted = await verifyVacuumStartHistory(
      started,
      requestedAt,
      options,
    );
    if (interrupted) await setOutcome("interrupted", "commanded-return");
  } else {
    await verifyStartedVacuums(started, options);
  }
}
