import type { TServiceParams } from "@digital-alchemy/core";
import { z } from "zod";
import { wait, openCoversWithDelay, closeCoversWithDelay, withTimeout } from "../util.ts";
import { instrumentWorkflow } from "../metrics.ts";

export function goodNight({ hass, logger, context }: TServiceParams) {
  const bedroomScene = hass.refBy.id("scene.bedroom_dimmed");
  const bedroomMediaPlayer = hass.refBy.id("media_player.bedroom");
  const bedroomLight = hass.refBy.id("light.bedroom");
  const bedroomHeater = hass.refBy.id("climate.bedroom_thermostat");
  // TODO: Re-enable when living room thermostat is back online
  // const livingRoomClimate = hass.refBy.id("climate.living_room");

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

            if (!result.success || result.data.data.actionID !== "A91A15AA-479E-416C-8F51-BD983A999266") {
              logger.debug("Event actionID does not match; ignoring");
            }

            await hass.call.notify.notify({
              title: "Good Night",
              message: "Good Night! Sleep well.",
            });

            // Set climate to bedtime mode - comfortable for falling asleep
            logger.debug("Setting climate to bedtime mode");
            await hass.call.climate.set_temperature({
              entity_id: bedroomHeater.entity_id,
              hvac_mode: "heat",
              temperature: 22,
            });
            // TODO: Re-enable when living room thermostat is back online
            // try {
            //   await livingRoomClimate.set_temperature({
            //     hvac_mode: "heat",
            //     temperature: 22,
            //   });
            // } catch {
            //   logger.debug("Living room climate not available, skipping");
            // }

            if (bedroomLight.state === "on") {
              logger.debug("Turning on bedroom scene");
              await hass.call.scene.turn_on({ entity_id: bedroomScene.entity_id });
            }

            logger.debug("Unjoining bedroom media player");
            await hass.call.media_player.unjoin({ entity_id: bedroomMediaPlayer.entity_id });

            logger.debug("Setting bedroom media player volume to 0");
            await hass.call.media_player.volume_set({
              entity_id: bedroomMediaPlayer.entity_id,
              volume_level: 0,
            });

            logger.debug("Playing media on bedroom media player");
            await hass.call.media_player.play_media({
              entity_id: bedroomMediaPlayer.entity_id,
              media: JSON.stringify({
                media_content_id: "FV:2/7",
                media_content_type: "favorite_item_id",
              }),
            });

            for (let i = 0; i < 9; i++) {
              logger.debug(`Increasing bedroom media player volume (step ${(i + 1).toString()})`);
              await wait({
                amount: 5,
                unit: "s",
              });
              await hass.call.media_player.volume_up({ entity_id: bedroomMediaPlayer.entity_id });
            }

            logger.debug("Closing bedroom covers");
            await closeCoversWithDelay(hass, ["cover.bedroom_left", "cover.bedroom_right"]);

            logger.debug("Opening living room covers");
            await openCoversWithDelay(hass, [
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
