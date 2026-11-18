import { defineSignal, log, setHandler, sleep } from "@temporalio/workflow";
import {
  firstUnavailableRoborock,
  ROBOROCK_RELOAD_COOLDOWN_MS,
  ROBOROCK_UNAVAILABLE_SETTLE_MS,
  ROBOROCK_VACUUM_ENTITIES,
} from "#shared/infra/roborock.ts";
import {
  callServiceUnchecked,
  getEntityStateUnchecked,
  setOutcome,
} from "./util.ts";

/**
 * Sent by the Home Assistant event bridge whenever a Roborock vacuum entity
 * enters the unavailable state (or is already unavailable on bridge startup).
 */
export const roborockUnavailable = defineSignal("roborockUnavailable");

/**
 * Singleton self-healing reconciler (`reconcile-roborock`) for wedged Roborock
 * Saros 10R L01 local TCP sessions.
 *
 * Waits through a 3-minute settle window so routine Home Assistant restarts or
 * single-poll blips recover on their own. If any floor vacuum is still
 * unavailable, reloads the shared Roborock config entry once (re-running the
 * L01 HELLO handshake for all three vacuums) and holds the singleton workflow
 * open for a 30-minute cooldown so genuinely powered-off vacuums cannot cause a
 * reload loop.
 */
export async function reconcileRoborock(): Promise<void> {
  let signals = 0;
  setHandler(roborockUnavailable, () => {
    signals += 1;
  });

  await sleep(ROBOROCK_UNAVAILABLE_SETTLE_MS);

  const states = await Promise.all(
    ROBOROCK_VACUUM_ENTITIES.map((entityId) =>
      getEntityStateUnchecked(entityId),
    ),
  );
  const target = firstUnavailableRoborock(states);

  if (target === undefined) {
    log.info(
      JSON.stringify({
        level: "info",
        msg: "reconcileRoborock: all vacuums available after settle window",
        component: "ha-roborock",
        workflow: "reconcileRoborock",
        phase: "noop",
        signals,
      }),
    );
    await setOutcome("skipped", "all-available");
    return;
  }

  await callServiceUnchecked("homeassistant", "reload_config_entry", {
    entity_id: target,
  });
  log.info(
    JSON.stringify({
      level: "info",
      msg: "reconcileRoborock: reloaded Roborock config entry",
      component: "ha-roborock",
      workflow: "reconcileRoborock",
      phase: "actuated",
      target,
      signals,
    }),
  );
  await setOutcome("executed", "reloaded-config-entry");
  await sleep(ROBOROCK_RELOAD_COOLDOWN_MS);
}
