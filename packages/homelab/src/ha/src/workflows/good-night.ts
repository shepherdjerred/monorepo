import type { TServiceParams } from "@digital-alchemy/core";
import { z } from "zod";
import {
  wait,
  mediaParam,
  openCoversWithDelay,
  closeCoversWithDelay,
  withTimeout,
} from "@shepherdjerred/homelab/ha/src/util.ts";
import { instrumentWorkflow } from "@shepherdjerred/homelab/ha/src/metrics.ts";
import { setBedtimeMode } from "@shepherdjerred/homelab/ha/src/climate-modes.ts";

export function goodNight({ hass, logger, context }: TServiceParams) {
  const bedroomScene = hass.refBy.id("scene.bedroom_dimmed");
  const bedroomMediaPlayer = hass.refBy.id("media_player.bedroom");
  const bedroomLight = hass.refBy.id("light.bedroom");

  hass.socket.onEvent({
    context,
    event: "ios.action_fired",
    exec: async (event) => {
      await instrumentWorkflow("good_night", async () => {
        await withTimeout(
          (async () => {
            logger.info("Good Night automation triggered");

            const result = z
              .object({
                data: z.object({
                  actionID: z.string(),
                }),
              })
              .safeParse(event);

            if (
              !result.success ||
              result.data.data.actionID !==
                "A91A15AA-479E-416C-8F51-BD983A999266"
            ) {
              logger.debug("Event actionID does not match; ignoring");
              return;
            }

            await withTimeout(
              hass.call.notify.notify({
                title: "Good Night",
                message: "Good Night! Sleep well.",
              }),
              { amount: 30, unit: "s" },
              "notify.notify good_night",
            );

            // Set climate to bedtime mode - comfortable for falling asleep
            logger.debug("Setting climate to bedtime mode");
            await setBedtimeMode(hass, logger);

            if (bedroomLight.state === "on") {
              logger.debug("Turning on bedroom scene");
              await withTimeout(
                hass.call.scene.turn_on({
                  entity_id: bedroomScene.entity_id,
                }),
                { amount: 30, unit: "s" },
                "scene.turn_on bedroom",
              );
            }

            logger.debug("Unjoining bedroom media player");
            await withTimeout(
              hass.call.media_player.unjoin({
                entity_id: bedroomMediaPlayer.entity_id,
              }),
              { amount: 30, unit: "s" },
              "media_player.unjoin",
            );

            logger.debug("Setting bedroom media player volume to 0");
            await withTimeout(
              hass.call.media_player.volume_set({
                entity_id: bedroomMediaPlayer.entity_id,
                volume_level: 0,
              }),
              { amount: 30, unit: "s" },
              "media_player.volume_set",
            );

            logger.debug("Playing media on bedroom media player");
            await withTimeout(
              hass.call.media_player.play_media({
                entity_id: bedroomMediaPlayer.entity_id,
                media: mediaParam({
                  media_content_id: "FV:2/7",
                  media_content_type: "favorite_item_id",
                }),
              }),
              { amount: 30, unit: "s" },
              "media_player.play_media",
            );

            for (let i = 0; i < 9; i++) {
              logger.debug(
                `Increasing bedroom media player volume (step ${(i + 1).toString()})`,
              );
              await wait({
                amount: 5,
                unit: "s",
              });
              await withTimeout(
                hass.call.media_player.volume_up({
                  entity_id: bedroomMediaPlayer.entity_id,
                }),
                { amount: 10, unit: "s" },
                "media_player.volume_up",
              );
            }

            logger.debug("Closing bedroom covers");
            await closeCoversWithDelay(hass, logger, [
              "cover.bedroom_left",
              "cover.bedroom_right",
            ]);

            logger.debug("Opening living room covers");
            await openCoversWithDelay(hass, logger, [
              "cover.living_room_left",
              "cover.living_room_right",
              "cover.tv_left",
              "cover.tv_right",
            ]);
          })(),
          { amount: 5, unit: "m" },
          "good_night workflow",
        );
      });
    },
  });
}
