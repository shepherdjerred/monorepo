import type { TServiceParams } from "@digital-alchemy/core";
import type { ENTITY_STATE } from "@digital-alchemy/hass";
import { shouldStopCleaning, withTimeout } from "../util.ts";
import { instrumentWorkflow } from "../metrics.ts";

export function welcomeHome({ hass, logger }: TServiceParams) {
  const personJerred = hass.refBy.id("person.jerred");
  const personShuxin = hass.refBy.id("person.shuxin");
  const roomba = hass.refBy.id("vacuum.roomba");
  const entrywayLight = hass.refBy.id("switch.entryway_overhead_lights");
  const livingRoomScene = hass.refBy.id("scene.living_room_main_bright");
  const bedroomHeater = hass.refBy.id("climate.bedroom_thermostat");
  // TODO: Re-enable when living room thermostat is back online
  // const livingRoomClimate = hass.refBy.id("climate.living_room");

  // TODO: Re-enable when Christmas decorations are back
  // const christmasScenes = [
  //   hass.refBy.id("scene.christmas_tree_silent_night"),
  //   hass.refBy.id("scene.christmas_tree_under_the_tree"),
  // ];

  async function runWelcomeHome() {
    await instrumentWorkflow("welcome_home", async () => {
      await withTimeout(
        (async () => {
          logger.info("Welcome Home automation triggered");

          await hass.call.notify.notify({
            title: "Welcome Home",
            message: "Welcome back! Hope you had a great time.",
          });

          // Set climate to comfortable home temperature (22°C)
          logger.debug("Setting climate to home comfort mode");
          await hass.call.climate.set_temperature({
            entity_id: bedroomHeater.entity_id,
            hvac_mode: "heat",
            temperature: 22,
          });
          // TODO: Re-enable when living room thermostat is back online
          // try {
          //   await livingRoomClimate.set_temperature({
          //     hvac_mode: "heat",
          //     temperature: 24,
          //   });
          // } catch {
          //   logger.debug("Living room climate not available, skipping");
          // }

          logger.debug("Turning on entryway light");
          await hass.call.switch.turn_on({ entity_id: entrywayLight.entity_id });

          logger.debug("Setting living room scene to bright");
          await hass.call.scene.turn_on({ entity_id: livingRoomScene.entity_id });

          // TODO: Re-enable when Christmas decorations are back
          // const randomScene = christmasScenes[Math.floor(Math.random() * christmasScenes.length)];
          // if (randomScene) {
          //   logger.debug("Turning on random Christmas tree scene");
          //   await randomScene.turn_on();
          // } else {
          //   throw new Error("No Christmas tree scene found");
          // }

          if (shouldStopCleaning(roomba.state)) {
            logger.debug("Commanding Roomba to return to base");
            await roomba.return_to_base();
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
      if (oldState && newState && newState.state === "home" && oldState.state === "not_home") {
        // Only trigger if Shuxin is not home (this is the first arrival)
        if (personShuxin.state === "not_home") {
          await runWelcomeHome();
        }
      }
    },
  );

  personShuxin.onUpdate(
    async (
      newState: ENTITY_STATE<"person.shuxin"> | undefined,
      oldState: ENTITY_STATE<"person.shuxin"> | undefined,
    ) => {
      if (oldState && newState && newState.state === "home" && oldState.state === "not_home") {
        // Only trigger if Jerred is not home (this is the first arrival)
        if (personJerred.state === "not_home") {
          await runWelcomeHome();
        }
      }
    },
  );
}
