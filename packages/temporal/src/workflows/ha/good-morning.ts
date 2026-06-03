import { sleep } from "@temporalio/workflow";
import {
  anyoneHome,
  callServiceUnchecked,
  sendNotification,
  setOutcome,
  volumeUpBy,
} from "./util.ts";

const BEDROOM_MEDIA = "media_player.bedroom" as const;
const MAIN_BATHROOM_MEDIA = "media_player.main_bathroom" as const;
const EXTRA_MEDIA_PLAYERS = [MAIN_BATHROOM_MEDIA] as const;
const BEDROOM_DIMMED = "scene.bedroom_dimmed" as const;
const BEDROOM_BRIGHT = "scene.bedroom_bright" as const;
const MASTER_BATHROOM_HEAT = "climate.master_bathroom" as const;
// Capped at 30°C by the Mysa HACS integration (kgelinas/Mysa_HA#16, fix in PR
// kgelinas/Mysa_HA#18). Bump back to 35 once the upstream fix ships.
const MORNING_HEAT_TEMP_C = 30;
const MORNING_HEAT_DURATION = "60 minutes" as const;

const WAKE_MEDIA = {
  media_content_id: "FV:2/5",
  media_content_type: "favorite_item_id",
};

export async function goodMorningWakeUp(): Promise<void> {
  if (!(await anyoneHome())) {
    console.warn("good_morning_wake_up: no one home, skipping");
    await setOutcome("skipped", "no-one-home");
    return;
  }

  // Start the bathroom heat cycle first so it warms while the wake routine
  // plays; it's turned off at the end after MORNING_HEAT_DURATION.
  await callServiceUnchecked("climate", "set_temperature", {
    entity_id: MASTER_BATHROOM_HEAT,
    temperature: MORNING_HEAT_TEMP_C,
    hvac_mode: "heat",
  });

  await sendNotification("Good Morning", "Good Morning! Time to wake up.");

  await callServiceUnchecked("media_player", "unjoin", {
    entity_id: BEDROOM_MEDIA,
  });
  await sleep("5 seconds");
  await callServiceUnchecked("media_player", "volume_set", {
    entity_id: BEDROOM_MEDIA,
    volume_level: 0,
  });
  await sleep("2 seconds");
  await callServiceUnchecked("media_player", "play_media", {
    entity_id: BEDROOM_MEDIA,
    media: WAKE_MEDIA,
  });
  await callServiceUnchecked("media_player", "shuffle_set", {
    entity_id: BEDROOM_MEDIA,
    shuffle: true,
  });
  await volumeUpBy(BEDROOM_MEDIA, 3, 5);

  await callServiceUnchecked("scene", "turn_on", {
    entity_id: BEDROOM_DIMMED,
    transition: 3,
  });

  // Hold the heat for the remainder of the cycle, then turn it off.
  await sleep(MORNING_HEAT_DURATION);
  await callServiceUnchecked("climate", "turn_off", {
    entity_id: MASTER_BATHROOM_HEAT,
  });
  await setOutcome("executed", "wake-routine-complete");
}

export async function goodMorningGetUp(): Promise<void> {
  if (!(await anyoneHome())) {
    console.warn("good_morning_get_up: no one home, skipping");
    await setOutcome("skipped", "no-one-home");
    return;
  }

  await callServiceUnchecked("scene", "turn_on", {
    entity_id: BEDROOM_BRIGHT,
    transition: 60,
  });

  for (const player of EXTRA_MEDIA_PLAYERS) {
    await callServiceUnchecked("media_player", "volume_set", {
      entity_id: player,
      volume_level: 0,
    });
  }

  await callServiceUnchecked("media_player", "join", {
    entity_id: BEDROOM_MEDIA,
    group_members: EXTRA_MEDIA_PLAYERS,
  });

  const allPlayers = [BEDROOM_MEDIA, ...EXTRA_MEDIA_PLAYERS] as const;
  for (let step = 0; step < 2; step += 1) {
    for (const player of allPlayers) {
      await callServiceUnchecked("media_player", "volume_up", {
        entity_id: player,
      });
    }
    if (step < 1) {
      await sleep("5 seconds");
    }
  }
  await setOutcome("executed", "getup-routine-complete");
}
