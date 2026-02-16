import type { TServiceParams } from "@digital-alchemy/core";
import {
  openCoversWithDelay,
  runParallel,
  runSequential,
  runSequentialWithDelay,
  repeat,
  runIf,
  wait,
  withTimeout,
} from "../util.ts";
import z from "zod";
import { instrumentWorkflow } from "../metrics.ts";

export function goodMorning({ hass, scheduler, logger }: TServiceParams) {
  const bedroomScene = hass.refBy.id("scene.bedroom_dimmed");
  const bedroomMediaPlayer = hass.refBy.id("media_player.bedroom");
  const bedroomBrightScene = hass.refBy.id("scene.bedroom_bright");
  const extraMediaPlayers = [hass.refBy.id("media_player.main_bathroom"), hass.refBy.id("media_player.entryway")];
  const bedroomHeater = hass.refBy.id("climate.bedroom_thermostat");
  // TODO: Re-enable when living room thermostat is back online
  // const livingRoomClimate = hass.refBy.id("climate.living_room");
  const entrywayLight = hass.refBy.id("switch.entryway_overhead_lights");
  const mainBathroomLight = hass.refBy.id("switch.main_bathroom_lights");
  const personJerred = hass.refBy.id("person.jerred");
  const personShuxin = hass.refBy.id("person.shuxin");

  function isAnyoneHome() {
    const jerredHome = personJerred.state === "home";
    const shuxinHome = personShuxin.state === "home";
    const anyoneHome = jerredHome || shuxinHome;
    logger.info(
      `isAnyoneHome check: jerred=${personJerred.state} (home=${String(jerredHome)}), shuxin=${personShuxin.state} (home=${String(shuxinHome)}), result=${String(anyoneHome)}`,
    );
    return anyoneHome;
  }

  const weekdayWakeUpHour = 8;
  const weekendWakeUpHour = 9;

  const startVolume = 0;
  const initialVolumeSteps = 3; // Steps for bedroom player at wake up
  const additionalVolumeSteps = 2; // Additional gentle steps for all players

  // one hour before
  scheduler.cron({
    schedule: [`0 ${(weekdayWakeUpHour - 1).toString()} * * 1-5`, `0 ${(weekendWakeUpHour - 1).toString()} * * 6,0`],
    exec: () => instrumentWorkflow("good_morning_early", runEarly),
  });

  // at wake up time
  scheduler.cron({
    schedule: [`0 ${weekdayWakeUpHour.toString()} * * 1-5`, `0 ${weekendWakeUpHour.toString()} * * 6,0`],
    exec: () => instrumentWorkflow("good_morning_wake_up", runWakeUp),
  });

  // 15 minutes later
  scheduler.cron({
    schedule: [`15 ${weekdayWakeUpHour.toString()} * * 1-5`, `15 ${weekendWakeUpHour.toString()} * * 6,0`],
    exec: () => instrumentWorkflow("good_morning_get_up", runGetUp),
  });

  async function runEarly() {
    logger.info("good_morning_early triggered");
    await withTimeout(
      runIf(isAnyoneHome(), () =>
        hass.call.climate.set_temperature({
          entity_id: bedroomHeater.entity_id,
          hvac_mode: "heat",
          temperature: 22, // pre-wake heating
        }),
      ),
      { amount: 2, unit: "m" },
      "good_morning_early workflow",
    );
  }

  async function runWakeUp() {
    logger.info("good_morning_wake_up triggered");
    await withTimeout(
      runParallel([
        () =>
          hass.call.climate.set_temperature({
            entity_id: bedroomHeater.entity_id,
            hvac_mode: "heat",
            temperature: 22,
          }),
        // TODO: Re-enable when living room thermostat is back online
        // async () => {
        //   try {
        //     await livingRoomClimate.set_temperature({
        //       hvac_mode: "heat",
        //       temperature: 24,
        //     });
        //   } catch {
        //     logger.debug("Living room climate not available, skipping");
        //   }
        // },
        () =>
          runIf(isAnyoneHome(), () =>
            runParallel([
              () =>
                hass.call.notify.notify({
                  title: "Good Morning",
                  message: "Good Morning! Time to wake up.",
                }),
              () =>
                runSequential([
                  // Debug: Log the full state before doing anything
                  () =>
                    (async () => {
                      logger.info(`Before any changes - Full state: ${JSON.stringify(bedroomMediaPlayer.attributes)}`);
                      logger.info(`Before any changes - Entity state: ${bedroomMediaPlayer.state}`);
                      return Promise.resolve();
                    })(),
                  () => hass.call.media_player.unjoin({ entity_id: bedroomMediaPlayer.entity_id }),
                  // Wait longer for unjoin to complete fully
                  () => wait({ amount: 5, unit: "s" }),
                  // Debug: Log state after unjoin
                  () =>
                    (async () => {
                      logger.info(`After unjoin - Full state: ${JSON.stringify(bedroomMediaPlayer.attributes)}`);
                      logger.info(`After unjoin - Entity state: ${bedroomMediaPlayer.state}`);
                      return Promise.resolve();
                    })(),
                  // Try volume_set with explicit value
                  () =>
                    (async () => {
                      logger.info("Calling volume_set with volume_level: 0");
                      await hass.call.media_player.volume_set({
                        entity_id: bedroomMediaPlayer.entity_id,
                        volume_level: 0,
                      });
                      logger.info("volume_set call completed");
                      return Promise.resolve();
                    })(),
                  // Wait and check if it took effect
                  () => wait({ amount: 2, unit: "s" }),
                  // Debug: Log state after volume_set
                  () =>
                    (async () => {
                      logger.info(`After volume_set - Full state: ${JSON.stringify(bedroomMediaPlayer.attributes)}`);
                      return Promise.resolve();
                    })(),
                  // Play media with error handling and retry
                  () =>
                    (async () => {
                      try {
                        logger.info("Attempting to play media on bedroom player");
                        await hass.call.media_player.play_media({
                          entity_id: bedroomMediaPlayer.entity_id,
                          media: JSON.stringify({
                            media_content_id: "FV:2/5",
                            media_content_type: "favorite_item_id",
                          }),
                        });
                        logger.info("Successfully started media playback");
                      } catch (error) {
                        const errorMsg = z
                          .instanceof(Error)
                          .transform((error) => error.message)
                          .catch((ctx) => String(ctx.value))
                          .parse(error);
                        logger.error(`First play_media attempt failed: ${errorMsg}`);
                        logger.info("Waiting additional time and retrying...");
                        await wait({ amount: 3, unit: "s" });
                        try {
                          await hass.call.media_player.play_media({
                            entity_id: bedroomMediaPlayer.entity_id,
                            media: JSON.stringify({
                              media_content_id: "FV:2/5",
                              media_content_type: "favorite_item_id",
                            }),
                          });
                          logger.info("Retry successful");
                        } catch (retryError) {
                          const retryErrorMsg = z
                            .instanceof(Error)
                            .transform((error) => error.message)
                            .catch((ctx) => String(ctx.value))
                            .parse(retryError);
                          logger.error(`Retry also failed: ${retryErrorMsg}`);
                          // Continue with the rest of the routine even if media fails
                        }
                      }
                    })(),
                  () =>
                    runSequentialWithDelay(
                      repeat(
                        () => hass.call.media_player.volume_up({ entity_id: bedroomMediaPlayer.entity_id }),
                        initialVolumeSteps,
                      ),
                      {
                        amount: 5,
                        unit: "s",
                      },
                    ),
                ]),
              () => hass.call.scene.turn_on({ entity_id: bedroomScene.entity_id, transition: 3 }),
              () => hass.call.switch.turn_on({ entity_id: mainBathroomLight.entity_id }),
            ]),
          ),
      ]),
      { amount: 5, unit: "m" },
      "good_morning_wake_up workflow",
    );
  }

  async function runGetUp() {
    logger.info("good_morning_get_up triggered");
    await withTimeout(
      runIf(isAnyoneHome(), () =>
        runParallel([
          () =>
            runIf(personShuxin.state === "not_home", () =>
              openCoversWithDelay(hass, ["cover.bedroom_left", "cover.bedroom_right"]),
            ),
          () => hass.call.scene.turn_on({ entity_id: bedroomBrightScene.entity_id, transition: 60 }),
          () =>
            runSequential([
              // Set extra players to start volume
              () =>
                (async () => {
                  for (const player of extraMediaPlayers) {
                    await hass.call.media_player.volume_set({
                      entity_id: player.entity_id,
                      volume_level: startVolume,
                    });
                  }
                })(),
              // Join all players together
              () =>
                hass.call.media_player.join({
                  entity_id: bedroomMediaPlayer.entity_id,
                  group_members: extraMediaPlayers.map((p) => p.entity_id),
                }),
              // Gentle volume increase for all players (bedroom + extra)
              () =>
                runSequentialWithDelay(
                  repeat(async () => {
                    // Increase bedroom player volume
                    await hass.call.media_player.volume_up({ entity_id: bedroomMediaPlayer.entity_id });
                    // Increase extra players volume
                    await Promise.all(
                      extraMediaPlayers.map(async (player) => {
                        logger.debug(`Increasing volume for ${player.entity_id}`);
                        await hass.call.media_player.volume_up({ entity_id: player.entity_id });
                      }),
                    );
                  }, additionalVolumeSteps), // Only 2 additional steps instead of 5+3
                  {
                    amount: 5,
                    unit: "s",
                  },
                ),
            ]),
          () => hass.call.switch.turn_on({ entity_id: entrywayLight.entity_id }),
        ]),
      ),
      { amount: 5, unit: "m" },
      "good_morning_get_up workflow",
    );
  }
}
