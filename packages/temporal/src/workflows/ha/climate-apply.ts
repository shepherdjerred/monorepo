import {
  ActivityFailure,
  ApplicationFailure,
  log,
  patched,
  proxyActivities,
} from "@temporalio/workflow";
import { z } from "zod";
import type { WeatherActivities } from "#activities/weather.ts";
import { OUTDOOR_WEATHER_UNAVAILABLE_ERROR_TYPE } from "#shared/infra/ha-errors.ts";
import {
  HOUSEHOLD_JERRED_ONLY_PATCH,
  householdResidents,
  isConfirmedAway,
} from "#shared/infra/presence.ts";
import { TASK_QUEUES } from "#shared/task-queues.ts";
import {
  climatePhase,
  desiredClimateCommand,
  losAngelesHour,
  type ClimateRoom,
  type RoomClimateState,
} from "./climate-policy.ts";
import { callService, getEntityState, setOutcome } from "./util.ts";

const weatherActivities = proxyActivities<WeatherActivities>({
  taskQueue: TASK_QUEUES.HOME,
  startToCloseTimeout: "30 seconds",
  retry: {
    initialInterval: "15 seconds",
    backoffCoefficient: 2,
    maximumAttempts: 4,
  },
});

const BEDROOM = "climate.bedroom" as const;
const LIVING_ROOM = "climate.living_room" as const;
const HOME_ZONE = "zone.home" as const;

const ROOMS = [
  { room: "bedroom", entityId: BEDROOM },
  { room: "living_room", entityId: LIVING_ROOM },
] as const satisfies readonly {
  readonly room: ClimateRoom;
  readonly entityId: typeof BEDROOM | typeof LIVING_ROOM;
}[];

const HomeZoneAttributes = z.object({
  latitude: z.number(),
  longitude: z.number(),
});

function isWeatherOutage(error: unknown): boolean {
  if (!(error instanceof ActivityFailure)) return false;
  const cause = error.cause;
  return (
    cause instanceof ApplicationFailure &&
    cause.type === OUTDOOR_WEATHER_UNAVAILABLE_ERROR_TYPE
  );
}

function readOptionalCelsius(
  value: unknown,
  label: string,
): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const trimmed = value.trim().toLowerCase();
    if (
      trimmed === "" ||
      trimmed === "unavailable" ||
      trimmed === "unknown" ||
      trimmed === "none"
    ) {
      return undefined;
    }
    const parsed = Number(trimmed);
    if (Number.isFinite(parsed)) return parsed;
  }
  throw ApplicationFailure.nonRetryable(
    `${label} is not a temperature`,
    "ClimateAttributeError",
  );
}

function roomState(
  mode: string,
  attributes: Record<string, unknown>,
  entityId: string,
): RoomClimateState {
  return {
    mode,
    targetC: readOptionalCelsius(
      attributes["temperature"],
      `${entityId} target`,
    ),
    currentC: readOptionalCelsius(
      attributes["current_temperature"],
      `${entityId} current temperature`,
    ),
  };
}

async function readOutdoorC(): Promise<number | undefined> {
  const zone = await getEntityState(HOME_ZONE);
  const parsed = HomeZoneAttributes.safeParse(zone.attributes);
  if (!parsed.success) {
    throw ApplicationFailure.nonRetryable(
      "Home Assistant zone.home attributes must include numeric latitude and longitude",
      "HomeZoneAttributesError",
    );
  }
  try {
    return await weatherActivities.getOutdoorTemperatureC(
      parsed.data.latitude,
      parsed.data.longitude,
    );
  } catch (error: unknown) {
    if (!isWeatherOutage(error)) throw error;
    log.warn(
      "home climate: outdoor weather unavailable, using room temperature only",
    );
    return undefined;
  }
}

async function applyRoom(
  entityId: typeof BEDROOM | typeof LIVING_ROOM,
  command: ReturnType<typeof desiredClimateCommand>,
): Promise<boolean> {
  if (command.kind === "noop") return false;
  if (command.kind === "turn_off") {
    await callService("climate", "turn_off", { entity_id: entityId });
    return true;
  }
  await callService("climate", "set_temperature", {
    entity_id: entityId,
    temperature: command.temperatureC,
    hvac_mode: "heat",
  });
  return true;
}

/** Read live presence, weather, and both rooms, then apply the phase policy. */
export async function applyHomeClimate(): Promise<void> {
  const phase = climatePhase(losAngelesHour(new Date()));
  const people = await Promise.all(
    householdResidents(patched(HOUSEHOLD_JERRED_ONLY_PATCH)).map((person) =>
      getEntityState(person),
    ),
  );
  const occupied = people.some((person) => person.state === "home");
  const everyoneConfirmedAway = people.every((person) =>
    isConfirmedAway(person.state),
  );
  const outdoorC = await readOutdoorC();

  let applied = false;
  for (const { room, entityId } of ROOMS) {
    const state = await getEntityState(entityId);
    const command = desiredClimateCommand({
      room,
      phase,
      occupied,
      everyoneConfirmedAway,
      outdoorC,
      roomState: roomState(state.state, state.attributes, entityId),
    });
    applied = (await applyRoom(entityId, command)) || applied;
  }

  await setOutcome(
    applied ? "executed" : "skipped",
    !applied && outdoorC === undefined
      ? "noop-weather-unavailable"
      : applied && outdoorC === undefined
        ? "applied-weather-unavailable"
        : applied
          ? "applied"
          : "noop",
  );
}
