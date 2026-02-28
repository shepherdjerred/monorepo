import type { TServiceParams } from "@digital-alchemy/core";
import type { ENTITY_STATE } from "@digital-alchemy/hass";
import {
  shouldStartCleaning,
  startRoombaWithVerification,
  verifyAfterDelay,
  withTimeout,
} from "@shepherdjerred/homelab/ha/src/util.ts";
import { instrumentWorkflow } from "@shepherdjerred/homelab/ha/src/metrics.ts";
import { setAwayMode } from "@shepherdjerred/homelab/ha/src/climate-modes.ts";

export function leavingHome({ hass, logger }: TServiceParams) {
  const personJerred = hass.refBy.id("person.jerred");
  const personShuxin = hass.refBy.id("person.shuxin");
  const roomba = hass.refBy.id("vacuum.roomba");

  async function runLeavingHome() {
    await instrumentWorkflow("leaving_home", async () => {
      await withTimeout(
        (async () => {
          logger.info("Leaving Home automation triggered");

          await withTimeout(
            hass.call.notify.notify({
              title: "Leaving Home",
              message: "Goodbye! The Roomba will start cleaning soon.",
            }),
            { amount: 30, unit: "s" },
            "notify.notify leaving_home",
          );

          // Set climate to energy-saving away mode
          logger.debug("Setting climate to away mode");
          await setAwayMode(hass, logger);

          // turn off all lights
          logger.debug("Turning off all lights");
          const lights = hass.refBy.domain("light");
          for (const light of lights) {
            await withTimeout(
              hass.call.light.turn_off({ entity_id: light.entity_id }),
              { amount: 30, unit: "s" },
              `light.turn_off ${light.entity_id}`,
            );
          }
          logger.debug("All lights turned off");

          // Verify lights are off
          for (const light of lights) {
            verifyAfterDelay({
              entityId: light.entity_id,
              workflowName: "light_off",
              getActualState: () => light.state,
              check: "off",
              delay: { amount: 10, unit: "s" },
              logger,
              hass,
            });
          }

          if (shouldStartCleaning(roomba.state)) {
            logger.debug("Commanding Roomba to start cleaning");
            await withTimeout(
              hass.call.vacuum.start({ entity_id: roomba.entity_id }),
              { amount: 30, unit: "s" },
              "vacuum.start",
            );
            startRoombaWithVerification(hass, logger, roomba);
          }
        })(),
        { amount: 3, unit: "m" },
        "leaving_home workflow",
      );
    });
  }

  // Trigger leaving home when last person leaves (house becomes empty)
  personJerred.onUpdate(
    async (
      newState: ENTITY_STATE<"person.jerred"> | undefined,
      oldState: ENTITY_STATE<"person.jerred"> | undefined,
    ) => {
      if (
        oldState &&
        newState &&
        newState.state === "not_home" &&
        oldState.state === "home" && // Only trigger if Shuxin is also not home (house is now empty)
        personShuxin.state === "not_home"
      ) {
        await runLeavingHome();
      }
    },
  );

  personShuxin.onUpdate(
    async (
      newState: ENTITY_STATE<"person.shuxin"> | undefined,
      oldState: ENTITY_STATE<"person.shuxin"> | undefined,
    ) => {
      if (
        oldState &&
        newState &&
        newState.state === "not_home" &&
        oldState.state === "home" && // Only trigger if Jerred is also not home (house is now empty)
        personJerred.state === "not_home"
      ) {
        await runLeavingHome();
      }
    },
  );
}
