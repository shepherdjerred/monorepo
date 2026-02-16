import type { TServiceParams } from "@digital-alchemy/core";
import type { ENTITY_STATE } from "@digital-alchemy/hass";
import { shouldStartCleaning, withTimeout } from "../util.ts";
import { instrumentWorkflow } from "../metrics.ts";

export function leavingHome({ hass, logger }: TServiceParams) {
  const personJerred = hass.refBy.id("person.jerred");
  const personShuxin = hass.refBy.id("person.shuxin");
  const roomba = hass.refBy.id("vacuum.roomba");
  const bedroomHeater = hass.refBy.id("climate.bedroom_thermostat");
  // TODO: Re-enable when living room thermostat is back online
  // const livingRoomClimate = hass.refBy.id("climate.living_room");

  async function runLeavingHome() {
    await instrumentWorkflow("leaving_home", async () => {
      await withTimeout(
        (async () => {
          logger.info("Leaving Home automation triggered");

          await hass.call.notify.notify({
            title: "Leaving Home",
            message: "Goodbye! The Roomba will start cleaning soon.",
          });

          // Set climate to energy-saving away mode (20°C)
          logger.debug("Setting climate to away mode");
          await hass.call.climate.set_temperature({
            entity_id: bedroomHeater.entity_id,
            hvac_mode: "heat",
            temperature: 20,
          });
          // TODO: Re-enable when living room thermostat is back online
          // try {
          //   await livingRoomClimate.set_temperature({
          //     hvac_mode: "heat",
          //     temperature: 20,
          //   });
          // } catch {
          //   logger.debug("Living room climate not available, skipping");
          // }

          // turn off all lights
          logger.debug("Turning off all lights");
          const lights = hass.refBy.domain("light");
          for (const light of lights) {
            await hass.call.light.turn_off({ entity_id: light.entity_id });
          }
          logger.debug("All lights turned off");

          if (shouldStartCleaning(roomba.state)) {
            logger.debug("Commanding Roomba to start cleaning");
            await roomba.start();
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
      if (oldState && newState && newState.state === "not_home" && oldState.state === "home") {
        // Only trigger if Shuxin is also not home (house is now empty)
        if (personShuxin.state === "not_home") {
          await runLeavingHome();
        }
      }
    },
  );

  personShuxin.onUpdate(
    async (
      newState: ENTITY_STATE<"person.shuxin"> | undefined,
      oldState: ENTITY_STATE<"person.shuxin"> | undefined,
    ) => {
      if (oldState && newState && newState.state === "not_home" && oldState.state === "home") {
        // Only trigger if Jerred is also not home (house is now empty)
        if (personJerred.state === "not_home") {
          await runLeavingHome();
        }
      }
    },
  );
}
