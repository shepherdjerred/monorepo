import type { TServiceParams } from "@digital-alchemy/core";
import type { ENTITY_STATE } from "@digital-alchemy/hass";
import {
  shouldStopCleaning,
  verifyAfterDelay,
  withTimeout,
} from "@shepherdjerred/homelab/ha/src/util.ts";
import { instrumentWorkflow } from "@shepherdjerred/homelab/ha/src/metrics.ts";
import { setHomeComfortMode } from "@shepherdjerred/homelab/ha/src/climate-modes.ts";

export function welcomeHome({ hass, logger }: TServiceParams) {
  const personJerred = hass.refBy.id("person.jerred");
  const personShuxin = hass.refBy.id("person.shuxin");
  const roomba = hass.refBy.id("vacuum.roomba");
  const entrywayLight = hass.refBy.id("switch.entryway_overhead_lights");
  const livingRoomScene = hass.refBy.id("scene.living_room_main_bright");

  async function runWelcomeHome() {
    await instrumentWorkflow("welcome_home", async () => {
      await withTimeout(
        (async () => {
          logger.info("Welcome Home automation triggered");

          await withTimeout(
            hass.call.notify.notify({
              title: "Welcome Home",
              message: "Welcome back! Hope you had a great time.",
            }),
            { amount: 30, unit: "s" },
            "notify.notify welcome_home",
          );

          // Set climate to comfortable home temperature
          logger.debug("Setting climate to home comfort mode");
          await setHomeComfortMode(hass, logger);

          logger.debug("Turning on entryway light");
          await withTimeout(
            hass.call.switch.turn_on({
              entity_id: entrywayLight.entity_id,
            }),
            { amount: 30, unit: "s" },
            "switch.turn_on entryway",
          );

          // Verify entryway light
          verifyAfterDelay({
            entityId: entrywayLight.entity_id,
            workflowName: "switch_on",
            getActualState: () => entrywayLight.state,
            check: "on",
            delay: { amount: 10, unit: "s" },
            logger,
            hass,
          });

          logger.debug("Setting living room scene to bright");
          await withTimeout(
            hass.call.scene.turn_on({
              entity_id: livingRoomScene.entity_id,
            }),
            { amount: 30, unit: "s" },
            "scene.turn_on living_room",
          );

          if (shouldStopCleaning(roomba.state)) {
            logger.debug("Commanding Roomba to return to base");
            await withTimeout(
              hass.call.vacuum.return_to_base({
                entity_id: roomba.entity_id,
              }),
              { amount: 30, unit: "s" },
              "vacuum.return_to_base",
            );
          }
        })(),
        { amount: 2, unit: "m" },
        "welcome_home workflow",
      );
    });
  }

  // Trigger welcome home when first person arrives (house was empty)
  personJerred.onUpdate(
    async (
      newState: ENTITY_STATE<"person.jerred"> | undefined,
      oldState: ENTITY_STATE<"person.jerred"> | undefined,
    ) => {
      if (
        oldState &&
        newState &&
        newState.state === "home" &&
        oldState.state === "not_home" && // Only trigger if Shuxin is not home (this is the first arrival)
        personShuxin.state === "not_home"
      ) {
        await runWelcomeHome();
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
        newState.state === "home" &&
        oldState.state === "not_home" && // Only trigger if Jerred is not home (this is the first arrival)
        personJerred.state === "not_home"
      ) {
        await runWelcomeHome();
      }
    },
  );
}
