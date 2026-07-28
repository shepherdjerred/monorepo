import {
  ApplicationFailure,
  patched,
  proxyActivities,
  sleep,
} from "@temporalio/workflow";
import { z } from "zod";
import {
  anyoneHome,
  callServiceUnchecked,
  getEntityState,
  sendNotification,
  setOutcome,
  volumeUpBy,
} from "./util.ts";
import type { WeatherActivities } from "#activities/weather.ts";

const weatherActivities = proxyActivities<WeatherActivities>({
  startToCloseTimeout: "30 seconds",
  retry: { maximumAttempts: 3 },
});

const BEDROOM_MEDIA = "media_player.bedroom" as const;
// NOTE: this entity_id flips from media_player.main_bathroom when the HA
// registry cleanup renames the Sonos (2026-07 "great refresh"); between this
// deploy and that rename the get-up join step no-ops on a missing entity.
const MASTER_BATHROOM_MEDIA = "media_player.master_bathroom" as const;
const EXTRA_MEDIA_PLAYERS = [MASTER_BATHROOM_MEDIA] as const;
const BEDROOM_DIMMED = "scene.bedroom_dimmed" as const;
const BEDROOM_BRIGHT = "scene.bedroom_bright" as const;
const MASTER_BATHROOM_HEAT = "climate.master_bathroom" as const;
const MASTER_BATHROOM_AIR_TEMP = "sensor.master_bathroom_temperature" as const;
const HOME_ZONE = "zone.home" as const;
// The INF-V1 floor heater's true max is 40°C. Upstream kgelinas/Mysa_HA capped
// it at 30°C (issue #16); the fix (PR #18) was closed unmerged and upstream is
// stale, so HA runs our fork shepherdjerred/Mysa_HA@v0.9.3 (via HACS), which
// exposes the real device limit. See
// packages/docs/plans/2026-05-05_mysa-max-temp-cap.md. The morning target is
// now 30°C (was 40°C until 2026-07) — warm feet without the multi-hour 40°C
// preheat, and only on cold mornings (see shouldHeatFloor).
const MORNING_HEAT_TEMP_C = 30;
// Cold-morning thresholds (user-tuned 2026-07): heat when the bathroom air is
// at/below 20°C OR the outdoor temperature is at/below 15°C.
const HEAT_INDOOR_THRESHOLD_C = 20;
const HEAT_OUTDOOR_THRESHOLD_C = 15;
const CONDITIONAL_FLOOR_HEAT_PATCH = "good-morning-conditional-floor-heat-v1";
const LEGACY_MORNING_HEAT_TEMP_C = 40;
const MORNING_HEAT_DURATION = "60 minutes" as const;
// The floor ramps ~8.3°C/hour (measured 2026-07-09: 22.3→30.6°C in the 60-min
// wake window), so hitting 30°C from a ~22°C start needs ~1 hour of lead.
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

const HomeZoneAttributes = z.object({
  latitude: z.number(),
  longitude: z.number(),
});

export function shouldHeatFloor(temps: {
  indoorC: number;
  outdoorC: number;
}): boolean {
  return (
    temps.indoorC <= HEAT_INDOOR_THRESHOLD_C ||
    temps.outdoorC <= HEAT_OUTDOOR_THRESHOLD_C
  );
}

function parseTemperatureC(entityId: string, raw: string): number {
  const value = Number.parseFloat(raw);
  if (!Number.isFinite(value)) {
    throw ApplicationFailure.nonRetryable(
      `Temperature sensor ${entityId} has non-numeric state: ${raw}`,
      "TemperatureSensorStateError",
    );
  }
  return value;
}

function parseHomeZoneCoordinates(
  attributes: Record<string, unknown>,
): z.infer<typeof HomeZoneAttributes> {
  const result = HomeZoneAttributes.safeParse(attributes);
  if (!result.success) {
    throw ApplicationFailure.nonRetryable(
      "Home Assistant zone.home attributes must include numeric latitude and longitude",
      "HomeZoneAttributesError",
    );
  }
  return result.data;
}

// Reads the bathroom air sensor and the outdoor temperature (Open-Meteo at the
// zone.home coordinates — HA has no weather integration) and decides whether
// the morning floor heat is worth running. Any read failure propagates and
// fails the workflow run: we never silently guess at the weather.
async function floorHeatDecision(): Promise<{
  heat: boolean;
  indoorC: number;
  outdoorC: number;
}> {
  const [indoorState, zoneState] = await Promise.all([
    getEntityState(MASTER_BATHROOM_AIR_TEMP),
    getEntityState(HOME_ZONE),
  ]);
  const indoorC = parseTemperatureC(
    MASTER_BATHROOM_AIR_TEMP,
    indoorState.state,
  );
  const { latitude, longitude } = parseHomeZoneCoordinates(
    zoneState.attributes,
  );
  const outdoorC = await weatherActivities.getOutdoorTemperatureC(
    latitude,
    longitude,
  );
  return { heat: shouldHeatFloor({ indoorC, outdoorC }), indoorC, outdoorC };
}

// Fires 2h15m before the wake routine so the bathroom floor is at temperature
// when goodMorningWakeUp runs (the floor's thermal mass needs ~1h to climb
// 22→30°C; the window stays 2h15m as a safe superset). Skips entirely on warm
// mornings (shouldHeatFloor). Owns its own turn-off so the heat can't stay on
// if the wake run never fires; the wake run's turn-off at the same wall-clock
// time is an idempotent no-op on an already-off thermostat. The hold re-checks
// presence every chunk and aborts early if the house empties mid-preheat.
export async function goodMorningPreheat(): Promise<void> {
  if (!(await anyoneHome())) {
    console.warn("good_morning_preheat: no one home, skipping");
    await setOutcome("skipped", "no-one-home");
    return;
  }

  const useConditionalFloorHeat = patched(CONDITIONAL_FLOOR_HEAT_PATCH);
  if (useConditionalFloorHeat) {
    const decision = await floorHeatDecision();
    if (!decision.heat) {
      console.warn(
        `good_morning_preheat: not cold (indoor ${String(decision.indoorC)}°C, outdoor ${String(decision.outdoorC)}°C), skipping heat`,
      );
      await setOutcome("skipped", "not-cold");
      return;
    }
  }

  await callServiceUnchecked("climate", "set_temperature", {
    entity_id: MASTER_BATHROOM_HEAT,
    temperature: useConditionalFloorHeat
      ? MORNING_HEAT_TEMP_C
      : LEGACY_MORNING_HEAT_TEMP_C,
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

  // Re-assert the heat setpoint on cold mornings (goodMorningPreheat normally
  // started it 2h15m ago; this is the fallback if the preheat run was skipped
  // or paused). On warm mornings the heat stays off; the rest of the wake
  // routine (notification, media, lights) is unconditional.
  let heat = true;
  if (patched(CONDITIONAL_FLOOR_HEAT_PATCH)) {
    const decision = await floorHeatDecision();
    heat = decision.heat;
    if (heat) {
      await callServiceUnchecked("climate", "set_temperature", {
        entity_id: MASTER_BATHROOM_HEAT,
        temperature: MORNING_HEAT_TEMP_C,
        hvac_mode: "heat",
      });
    } else {
      console.warn(
        `good_morning_wake_up: not cold (indoor ${String(decision.indoorC)}°C, outdoor ${String(decision.outdoorC)}°C), heat stays off`,
      );
    }
  } else {
    await callServiceUnchecked("climate", "set_temperature", {
      entity_id: MASTER_BATHROOM_HEAT,
      temperature: LEGACY_MORNING_HEAT_TEMP_C,
      hvac_mode: "heat",
    });
  }

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

  // Wait through the heat window, then always turn the thermostat off. The
  // unconditional cleanup recovers a preheat run that set the thermostat but
  // failed or was cancelled before its own backstop, even if this second
  // temperature reading is now warm.
  await sleep(MORNING_HEAT_DURATION);
  await callServiceUnchecked("climate", "turn_off", {
    entity_id: MASTER_BATHROOM_HEAT,
  });
  await setOutcome(
    "executed",
    heat ? "wake-routine-complete" : "wake-routine-complete-no-heat",
  );
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
