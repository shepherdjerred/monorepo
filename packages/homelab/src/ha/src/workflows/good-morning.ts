import type { TServiceParams } from "@digital-alchemy/core";
import {
  isAnyoneHome,
  mediaParam,
  openCoversWithDelay,
  runParallel,
  runSequential,
  runSequentialWithDelay,
  repeat,
  runIf,
  verifyAfterDelay,
  wait,
  withTimeout,
} from "@shepherdjerred/homelab/ha/src/util.ts";
import { instrumentWorkflow } from "@shepherdjerred/homelab/ha/src/metrics.ts";
import { setHomeComfortMode } from "@shepherdjerred/homelab/ha/src/climate-modes.ts";

export function goodMorning({ hass, scheduler, logger }: TServiceParams) {
  const bedroomScene = hass.refBy.id("scene.bedroom_dimmed");
  const bedroomMediaPlayer = hass.refBy.id("media_player.bedroom");
  const bedroomBrightScene = hass.refBy.id("scene.bedroom_bright");
  const extraMediaPlayers = [
    hass.refBy.id("media_player.main_bathroom"),
    hass.refBy.id("media_player.entryway"),
  ];
  const entrywayLight = hass.refBy.id("switch.entryway_overhead_lights");
  const mainBathroomLight = hass.refBy.id("switch.main_bathroom_lights");
  const personJerred = hass.refBy.id("person.jerred");
  const personShuxin = hass.refBy.id("person.shuxin");

  function isAnyoneHomeWithLogging() {
    const anyoneHome = isAnyoneHome(hass);
    logger.info(
      `isAnyoneHome check: jerred=${personJerred.state}, shuxin=${personShuxin.state}, result=${String(anyoneHome)}`,
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
    schedule: [
      `0 ${(weekdayWakeUpHour - 1).toString()} * * 1-5`,
      `0 ${(weekendWakeUpHour - 1).toString()} * * 6,0`,
    ],
    exec: () => instrumentWorkflow("good_morning_early", runEarly),
  });

  // at wake up time
  scheduler.cron({
    schedule: [
      `0 ${weekdayWakeUpHour.toString()} * * 1-5`,
      `0 ${weekendWakeUpHour.toString()} * * 6,0`,
    ],
    exec: () => instrumentWorkflow("good_morning_wake_up", runWakeUp),
  });

  // 15 minutes later
  scheduler.cron({
    schedule: [
      `15 ${weekdayWakeUpHour.toString()} * * 1-5`,
      `15 ${weekendWakeUpHour.toString()} * * 6,0`,
    ],
    exec: () => instrumentWorkflow("good_morning_get_up", runGetUp),
  });

  async function runEarly() {
    logger.info("good_morning_early triggered");
    await withTimeout(
      runIf(isAnyoneHomeWithLogging(), () =>
        setHomeComfortMode(hass, logger),
      ),
      { amount: 2, unit: "m" },
      "good_morning_early workflow",
    );
  }

  async function runWakeUp() {
    logger.info("good_morning_wake_up triggered");
    await withTimeout(
      runParallel([
        () => setHomeComfortMode(hass, logger),
        () =>
          runIf(isAnyoneHomeWithLogging(), () =>
            runParallel([
              () =>
                withTimeout(
                  hass.call.notify.notify({
                    title: "Good Morning",
                    message: "Good Morning! Time to wake up.",
                  }),
                  { amount: 30, unit: "s" },
                  "notify.notify good_morning",
                ),
              () =>
                runSequential([
                  // Debug: Log the full state before doing anything
                  () => {
                    logger.info(
                      `Before any changes - Full state: ${JSON.stringify(bedroomMediaPlayer.attributes)}`,
                    );
                    logger.info(
                      `Before any changes - Entity state: ${bedroomMediaPlayer.state}`,
                    );
                    return Promise.resolve();
                  },
                  () =>
                    withTimeout(
                      hass.call.media_player.unjoin({
                        entity_id: bedroomMediaPlayer.entity_id,
                      }),
                      { amount: 30, unit: "s" },
                      "media_player.unjoin",
                    ),
                  // Wait longer for unjoin to complete fully
                  () => wait({ amount: 5, unit: "s" }),
                  // Debug: Log state after unjoin
                  () => {
                    logger.info(
                      `After unjoin - Full state: ${JSON.stringify(bedroomMediaPlayer.attributes)}`,
                    );
                    logger.info(
                      `After unjoin - Entity state: ${bedroomMediaPlayer.state}`,
                    );
                    return Promise.resolve();
                  },
                  // Try volume_set with explicit value
                  () =>
                    (async () => {
                      logger.info("Calling volume_set with volume_level: 0");
                      await withTimeout(
                        hass.call.media_player.volume_set({
                          entity_id: bedroomMediaPlayer.entity_id,
                          volume_level: 0,
                        }),
                        { amount: 30, unit: "s" },
                        "media_player.volume_set",
                      );
                      logger.info("volume_set call completed");
                      return;
                    })(),
                  // Wait and check if it took effect
                  () => wait({ amount: 2, unit: "s" }),
                  // Debug: Log state after volume_set
                  () => {
                    logger.info(
                      `After volume_set - Full state: ${JSON.stringify(bedroomMediaPlayer.attributes)}`,
                    );
                    return Promise.resolve();
                  },
                  // Play media with error handling and retry
                  () =>
                    (async () => {
                      try {
                        logger.info(
                          "Attempting to play media on bedroom player",
                        );
                        await withTimeout(
                          hass.call.media_player.play_media({
                            entity_id: bedroomMediaPlayer.entity_id,
                            media: mediaParam({
                              media_content_id: "FV:2/5",
                              media_content_type: "favorite_item_id",
                            }),
                          }),
                          { amount: 30, unit: "s" },
                          "media_player.play_media",
                        );
                        logger.info("Successfully started media playback");
                      } catch (playError) {
                        const errorMsg =
                          playError instanceof Error
                            ? playError.message
                            : String(playError);
                        logger.error(
                          `First play_media attempt failed: ${errorMsg}`,
                        );
                        logger.info("Waiting additional time and retrying...");
                        await wait({ amount: 3, unit: "s" });
                        try {
                          await withTimeout(
                            hass.call.media_player.play_media({
                              entity_id: bedroomMediaPlayer.entity_id,
                              media: mediaParam({
                                media_content_id: "FV:2/5",
                                media_content_type: "favorite_item_id",
                              }),
                            }),
                            { amount: 30, unit: "s" },
                            "media_player.play_media retry",
                          );
                          logger.info("Retry successful");
                        } catch (retryError) {
                          const retryErrorMsg =
                            retryError instanceof Error
                              ? retryError.message
                              : String(retryError);
                          logger.error(`Retry also failed: ${retryErrorMsg}`);
                          // Continue with the rest of the routine even if media fails
                        }
                      }
                    })(),
                  () =>
                    runSequentialWithDelay(
                      repeat(
                        () =>
                          withTimeout(
                            hass.call.media_player.volume_up({
                              entity_id: bedroomMediaPlayer.entity_id,
                            }),
                            { amount: 10, unit: "s" },
                            "media_player.volume_up",
                          ),
                        initialVolumeSteps,
                      ),
                      {
                        amount: 5,
                        unit: "s",
                      },
                    ),
                ]),
              () =>
                withTimeout(
                  hass.call.scene.turn_on({
                    entity_id: bedroomScene.entity_id,
                    transition: 3,
                  }),
                  { amount: 30, unit: "s" },
                  "scene.turn_on bedroom_dimmed",
                ),
              () =>
                (async () => {
                  await withTimeout(
                    hass.call.switch.turn_on({
                      entity_id: mainBathroomLight.entity_id,
                    }),
                    { amount: 30, unit: "s" },
                    "switch.turn_on main_bathroom",
                  );
                  verifyAfterDelay({
                    entityId: mainBathroomLight.entity_id,
                    workflowName: "switch_on",
                    getActualState: () => mainBathroomLight.state,
                    check: "on",
                    delay: { amount: 10, unit: "s" },
                    logger,
                    hass,
                  });
                })(),
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
      runIf(isAnyoneHomeWithLogging(), () =>
        runParallel([
          () =>
            runIf(personShuxin.state === "not_home", () =>
              openCoversWithDelay(hass, logger, [
                "cover.bedroom_left",
                "cover.bedroom_right",
              ]),
            ),
          () =>
            withTimeout(
              hass.call.scene.turn_on({
                entity_id: bedroomBrightScene.entity_id,
                transition: 60,
              }),
              { amount: 30, unit: "s" },
              "scene.turn_on bedroom_bright",
            ),
          () =>
            runSequential([
              // Set extra players to start volume
              () =>
                (async () => {
                  for (const player of extraMediaPlayers) {
                    await withTimeout(
                      hass.call.media_player.volume_set({
                        entity_id: player.entity_id,
                        volume_level: startVolume,
                      }),
                      { amount: 30, unit: "s" },
                      `media_player.volume_set ${player.entity_id}`,
                    );
                  }
                })(),
              // Join all players together
              () =>
                withTimeout(
                  hass.call.media_player.join({
                    entity_id: bedroomMediaPlayer.entity_id,
                    group_members: extraMediaPlayers.map((p) => p.entity_id),
                  }),
                  { amount: 30, unit: "s" },
                  "media_player.join",
                ),
              // Gentle volume increase for all players (bedroom + extra)
              () =>
                runSequentialWithDelay(
                  repeat(async () => {
                    // Increase bedroom player volume
                    await withTimeout(
                      hass.call.media_player.volume_up({
                        entity_id: bedroomMediaPlayer.entity_id,
                      }),
                      { amount: 10, unit: "s" },
                      "media_player.volume_up bedroom",
                    );
                    // Increase extra players volume
                    await Promise.all(
                      extraMediaPlayers.map(async (player) => {
                        logger.debug(
                          `Increasing volume for ${player.entity_id}`,
                        );
                        await withTimeout(
                          hass.call.media_player.volume_up({
                            entity_id: player.entity_id,
                          }),
                          { amount: 10, unit: "s" },
                          `media_player.volume_up ${player.entity_id}`,
                        );
                      }),
                    );
                  }, additionalVolumeSteps),
                  {
                    amount: 5,
                    unit: "s",
                  },
                ),
            ]),
          () =>
            (async () => {
              await withTimeout(
                hass.call.switch.turn_on({
                  entity_id: entrywayLight.entity_id,
                }),
                { amount: 30, unit: "s" },
                "switch.turn_on entryway",
              );
              verifyAfterDelay({
                entityId: entrywayLight.entity_id,
                workflowName: "switch_on",
                getActualState: () => entrywayLight.state,
                check: "on",
                delay: { amount: 10, unit: "s" },
                logger,
                hass,
              });
            })(),
        ]),
      ),
      { amount: 5, unit: "m" },
      "good_morning_get_up workflow",
    );
  }
}
