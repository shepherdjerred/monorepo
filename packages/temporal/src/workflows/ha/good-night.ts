import { sleep } from "@temporalio/workflow";
import {
  callService,
  closeCoversSequentially,
  getEntityState,
  openCoversSequentially,
  sendNotification,
} from "./util.ts";

const BEDROOM_MEDIA = "media_player.bedroom";
const BEDROOM_DIMMED = "scene.bedroom_dimmed";
const BEDROOM_LIGHT = "light.bedroom";
const BEDROOM_COVERS = ["cover.bedroom_left", "cover.bedroom_right"] as const;
const LIVING_ROOM_COVERS = [
  "cover.living_room_left",
  "cover.living_room_right",
  "cover.tv_left",
  "cover.tv_right",
] as const;

const SLEEP_MEDIA = {
  media_content_id: "FV:2/7",
  media_content_type: "favorite_item_id",
};

export async function goodNight(): Promise<void> {
  await sendNotification("Good Night", "Good Night! Sleep well.");

  const bedroomLight = await getEntityState(BEDROOM_LIGHT);
  if (bedroomLight.state === "on") {
    await callService("scene", "turn_on", { entity_id: BEDROOM_DIMMED });
  }

  await callService("media_player", "unjoin", { entity_id: BEDROOM_MEDIA });
  await callService("media_player", "volume_set", {
    entity_id: BEDROOM_MEDIA,
    volume_level: 0,
  });
  await callService("media_player", "play_media", {
    entity_id: BEDROOM_MEDIA,
    media: SLEEP_MEDIA,
  });

  for (let step = 0; step < 9; step += 1) {
    await sleep("5 seconds");
    await callService("media_player", "volume_up", {
      entity_id: BEDROOM_MEDIA,
    });
  }

  await closeCoversSequentially(BEDROOM_COVERS);
  await openCoversSequentially(LIVING_ROOM_COVERS);
}
