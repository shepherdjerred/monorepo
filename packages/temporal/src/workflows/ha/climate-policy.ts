// Occupied-home heat for the living room and bedroom.
// Day (08:00–24:00 America/Los_Angeles) holds both rooms at 21°C.
// Sleep (00:00–08:00) holds the bedroom at 18°C and turns living-room heat off.
// Away turns off heat only. Cool is never overwritten.

export const DAY_SETPOINT_C = 21;
export const SLEEP_SETPOINT_C = 18;
export const HEATING_SEASON_OUTDOOR_C = 18;
export const DAY_START_HOUR = 8;
export const LOS_ANGELES = "America/Los_Angeles";

export type ClimateRoom = "bedroom" | "living_room";
export type ClimatePhase = "sleep" | "day";

export type ClimateCommand =
  | { readonly kind: "noop" }
  | { readonly kind: "heat"; readonly temperatureC: number }
  | { readonly kind: "turn_off" };

export type RoomClimateState = {
  readonly mode: string;
  readonly targetC: number | undefined;
  readonly currentC: number | undefined;
};

export type ClimateDecisionInput = {
  readonly room: ClimateRoom;
  readonly phase: ClimatePhase;
  readonly occupied: boolean;
  readonly everyoneConfirmedAway: boolean;
  readonly outdoorC: number | undefined;
  readonly roomState: RoomClimateState;
};

export function losAngelesHour(now: Date): number {
  const hour = new Intl.DateTimeFormat("en-US", {
    timeZone: LOS_ANGELES,
    hour: "numeric",
    hourCycle: "h23",
  })
    .formatToParts(now)
    .find((part) => part.type === "hour")?.value;
  const parsed = Number(hour);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 23) {
    throw new Error(
      `Could not read the Los Angeles hour from ${now.toISOString()}`,
    );
  }
  return parsed;
}

export function climatePhase(hour: number): ClimatePhase {
  return hour < DAY_START_HOUR ? "sleep" : "day";
}

function setpointC(room: ClimateRoom, phase: ClimatePhase): number | undefined {
  if (phase === "day") return DAY_SETPOINT_C;
  return room === "bedroom" ? SLEEP_SETPOINT_C : undefined;
}

function inHeatingSeason(
  outdoorC: number | undefined,
  currentC: number | undefined,
  targetC: number,
): boolean {
  return (
    (outdoorC !== undefined && outdoorC <= HEATING_SEASON_OUTDOOR_C) ||
    (currentC !== undefined && currentC < targetC)
  );
}

const NOOP: ClimateCommand = { kind: "noop" };
const TURN_OFF: ClimateCommand = { kind: "turn_off" };

function heat(temperatureC: number): ClimateCommand {
  return { kind: "heat", temperatureC };
}

/**
 * Desired command for one room. Already-correct heat is a no-op.
 * Heating season gates entering heat from any other mode. A unit that is
 * already heating follows the phase setpoint even when the outdoor reading
 * is missing, so midnight still drops 21°C to 18°C.
 */
export function desiredClimateCommand(
  input: ClimateDecisionInput,
): ClimateCommand {
  const { room, phase, occupied, everyoneConfirmedAway, outdoorC, roomState } =
    input;
  const { mode, targetC, currentC } = roomState;

  if (!occupied) {
    return everyoneConfirmedAway && mode === "heat" ? TURN_OFF : NOOP;
  }
  if (mode === "cool") return NOOP;
  if (phase === "sleep" && room === "living_room") {
    return mode === "heat" ? TURN_OFF : NOOP;
  }

  const temperatureC = setpointC(room, phase);
  if (temperatureC === undefined) return NOOP;
  if (mode === "heat") {
    return targetC === temperatureC ? NOOP : heat(temperatureC);
  }
  return inHeatingSeason(outdoorC, currentC, temperatureC)
    ? heat(temperatureC)
    : NOOP;
}
