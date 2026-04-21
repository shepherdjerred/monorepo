import { sleep } from "@temporalio/workflow";
import {
  anyoneHome,
  callService,
  getEntityState,
  matchExact,
  openCoversSequentially,
  sendNotification,
  verifyState,
  volumeUpBy,
} from "./util.ts";

const BEDROOM_MEDIA = "media_player.bedroom";
const MAIN_BATHROOM_MEDIA = "media_player.main_bathroom";
const ENTRYWAY_MEDIA = "media_player.entryway";
const EXTRA_MEDIA_PLAYERS = [MAIN_BATHROOM_MEDIA, ENTRYWAY_MEDIA];
const BEDROOM_DIMMED = "scene.bedroom_dimmed";
const BEDROOM_BRIGHT = "scene.bedroom_bright";
const ENTRYWAY_LIGHT = "switch.entryway_overhead_lights";
const MAIN_BATHROOM_LIGHT = "switch.main_bathroom_lights";
const BEDROOM_COVERS = ["cover.bedroom_left", "cover.bedroom_right"] as const;

const WAKE_MEDIA = {
  media_content_id: "FV:2/5",
  media_content_type: "favorite_item_id",
};

export async function goodMorningEarly(): Promise<void> {
  if (!(await anyoneHome())) {
    console.warn("good_morning_early: no one home, skipping");
    return;
  }
  console.warn("good_morning_early: placeholder (climate disabled)");
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

  await callService("switch", "turn_on", { entity_id: MAIN_BATHROOM_LIGHT });
  await verifyState(MAIN_BATHROOM_LIGHT, matchExact("on"), {
    delaySeconds: 10,
    retries: 0,
    retryDelaySeconds: 30,
  });
}

export async function goodMorningGetUp(): Promise<void> {
  if (!(await anyoneHome())) {
    console.warn("good_morning_get_up: no one home, skipping");
    return;
  }

  const shuxin = await getEntityState("person.shuxin");
  if (shuxin.state === "not_home") {
    await openCoversSequentially(BEDROOM_COVERS);
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

  const allPlayers = [BEDROOM_MEDIA, ...EXTRA_MEDIA_PLAYERS];
  for (let step = 0; step < 2; step += 1) {
    for (const player of allPlayers) {
      await callService("media_player", "volume_up", { entity_id: player });
    }
    if (step < 1) {
      await sleep("5 seconds");
    }
  }

  await callService("switch", "turn_on", { entity_id: ENTRYWAY_LIGHT });
  await verifyState(ENTRYWAY_LIGHT, matchExact("on"), {
    delaySeconds: 10,
    retries: 0,
    retryDelaySeconds: 30,
  });
}
