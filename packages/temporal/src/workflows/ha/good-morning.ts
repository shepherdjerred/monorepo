import { sleep } from "@temporalio/workflow";
import {
  anyoneHome,
  callService,
  sendNotification,
  volumeUpBy,
} from "./util.ts";

const BEDROOM_MEDIA = "media_player.bedroom" as const;
const MAIN_BATHROOM_MEDIA = "media_player.main_bathroom" as const;
const ENTRYWAY_MEDIA = "media_player.entryway" as const;
const EXTRA_MEDIA_PLAYERS = [MAIN_BATHROOM_MEDIA, ENTRYWAY_MEDIA] as const;
const BEDROOM_DIMMED = "scene.bedroom_dimmed" as const;
const BEDROOM_BRIGHT = "scene.bedroom_bright" as const;
const MASTER_BATHROOM_HEAT = "climate.master_bathroom" as const;
const MORNING_HEAT_TEMP_C = 35;
const MORNING_HEAT_DURATION = "60 minutes" as const;

const WAKE_MEDIA = {
  media_content_id: "FV:2/5",
  media_content_type: "favorite_item_id",
};

export async function goodMorningEarly(): Promise<void> {
  if (!(await anyoneHome())) {
    console.warn("good_morning_early: no one home, skipping");
    return;
  }

  await callService("climate", "set_temperature", {
    entity_id: MASTER_BATHROOM_HEAT,
    temperature: MORNING_HEAT_TEMP_C,
    hvac_mode: "heat",
  });

  await sleep(MORNING_HEAT_DURATION);

  await callService("climate", "turn_off", {
    entity_id: MASTER_BATHROOM_HEAT,
  });
}

export async function goodMorningWakeUp(): Promise<void> {
  if (!(await anyoneHome())) {
    console.warn("good_morning_wake_up: no one home, skipping");
    return;
  }

  await sendNotification("Good Morning", "Good Morning! Time to wake up.");

  await callService("media_player", "unjoin", { entity_id: BEDROOM_MEDIA });
  await sleep("5 seconds");
  await callService("media_player", "volume_set", {
    entity_id: BEDROOM_MEDIA,
    volume_level: 0,
  });
  await sleep("2 seconds");
  await callService("media_player", "play_media", {
    entity_id: BEDROOM_MEDIA,
    media: WAKE_MEDIA,
  });
  await volumeUpBy(BEDROOM_MEDIA, 3, 5);

  await callService("scene", "turn_on", {
    entity_id: BEDROOM_DIMMED,
    transition: 3,
  });
}

export async function goodMorningGetUp(): Promise<void> {
  if (!(await anyoneHome())) {
    console.warn("good_morning_get_up: no one home, skipping");
    return;
  }

  await callService("scene", "turn_on", {
    entity_id: BEDROOM_BRIGHT,
    transition: 60,
  });

  for (const player of EXTRA_MEDIA_PLAYERS) {
    await callService("media_player", "volume_set", {
      entity_id: player,
      volume_level: 0,
    });
  }

  await callService("media_player", "join", {
    entity_id: BEDROOM_MEDIA,
    group_members: EXTRA_MEDIA_PLAYERS,
  });

  const allPlayers = [BEDROOM_MEDIA, ...EXTRA_MEDIA_PLAYERS] as const;
  for (let step = 0; step < 2; step += 1) {
    for (const player of allPlayers) {
      await callService("media_player", "volume_up", { entity_id: player });
    }
    if (step < 1) {
      await sleep("5 seconds");
    }
  }
}
