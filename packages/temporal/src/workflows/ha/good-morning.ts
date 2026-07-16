import { sleep } from "@temporalio/workflow";
import {
  anyoneHome,
  callServiceUnchecked,
  sendNotification,
  setOutcome,
  volumeUpBy,
} from "./util.ts";

const BEDROOM_MEDIA = "media_player.bedroom" as const;
// NOTE: this entity_id flips from media_player.main_bathroom when the HA
// registry cleanup renames the Sonos (2026-07 "great refresh"); between this
// deploy and that rename the get-up join step no-ops on a missing entity.
const MASTER_BATHROOM_MEDIA = "media_player.master_bathroom" as const;
const EXTRA_MEDIA_PLAYERS = [MASTER_BATHROOM_MEDIA] as const;
const BEDROOM_DIMMED = "scene.bedroom_dimmed" as const;
const BEDROOM_BRIGHT = "scene.bedroom_bright" as const;
const MASTER_BATHROOM_HEAT = "climate.master_bathroom" as const;
// The INF-V1 floor heater's true max is 40°C. Upstream kgelinas/Mysa_HA capped
// it at 30°C (issue #16); the fix (PR #18) was closed unmerged and upstream is
// stale, so HA runs our fork shepherdjerred/Mysa_HA@v0.9.3 (via HACS), which
// exposes the real device limit. Verified live: climate.master_bathroom.max_temp
// == 40 and a 35°C set applied without error. See
// packages/docs/plans/2026-05-05_mysa-max-temp-cap.md.
const MORNING_HEAT_TEMP_C = 40;
const MORNING_HEAT_DURATION = "60 minutes" as const;
// The floor ramps ~8.3°C/hour (measured 2026-07-09: 22.3→30.6°C in the 60-min
// wake window), so hitting 40°C from a ~22°C start needs ~2¼ hours of lead.
// goodMorningPreheat fires 2h15m before wake and owns its own turn-off as a
// backstop (wake time + 60m), so heat never stays on if the wake run skips.
// The 195-minute hold is chunked so a mid-hold departure (everyone leaves
// after preheat started) turns the floor off within one chunk instead of
// heating an empty house until the backstop.
const PREHEAT_HOLD_CHUNK = "15 minutes" as const;
const PREHEAT_HOLD_CHUNKS = 13; // 13 × 15m = 195m total window

const WAKE_MEDIA = {
  media_content_id: "FV:2/5",
  media_content_type: "favorite_item_id",
};

// Fires 2h15m before the wake routine so the bathroom floor is at temperature
// when goodMorningWakeUp runs (the floor's thermal mass needs ~2¼h to climb
// 22→40°C). Owns its own turn-off so the heat can't stay on if the wake run
// never fires; the wake run's turn-off at the same wall-clock time is an
// idempotent no-op on an already-off thermostat. The hold re-checks presence
// every chunk and aborts early if the house empties mid-preheat.
export async function goodMorningPreheat(): Promise<void> {
  if (!(await anyoneHome())) {
    console.warn("good_morning_preheat: no one home, skipping");
    await setOutcome("skipped", "no-one-home");
    return;
  }

  await callServiceUnchecked("climate", "set_temperature", {
    entity_id: MASTER_BATHROOM_HEAT,
    temperature: MORNING_HEAT_TEMP_C,
    hvac_mode: "heat",
  });

  for (let chunk = 0; chunk < PREHEAT_HOLD_CHUNKS; chunk += 1) {
    await sleep(PREHEAT_HOLD_CHUNK);
    if (!(await anyoneHome())) {
      console.warn("good_morning_preheat: everyone left mid-hold, turning off");
      await callServiceUnchecked("climate", "turn_off", {
        entity_id: MASTER_BATHROOM_HEAT,
      });
      await setOutcome("executed", "preheat-aborted-everyone-left");
      return;
    }
  }

  await callServiceUnchecked("climate", "turn_off", {
    entity_id: MASTER_BATHROOM_HEAT,
  });
  await setOutcome("executed", "preheat-complete");
}

export async function goodMorningWakeUp(): Promise<void> {
  if (!(await anyoneHome())) {
    console.warn("good_morning_wake_up: no one home, skipping");
    await setOutcome("skipped", "no-one-home");
    return;
  }

  // Re-assert the heat setpoint (goodMorningPreheat normally started it 2h15m
  // ago; this is the fallback if the preheat run was skipped or paused).
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
