import { describe, expect, test } from "vitest";
import {
  climatePhase,
  DAY_SETPOINT_C,
  desiredClimateCommand,
  losAngelesHour,
  SLEEP_SETPOINT_C,
  type ClimateDecisionInput,
  type RoomClimateState,
} from "./climate-policy.ts";

const OFF: RoomClimateState = {
  mode: "off",
  targetC: undefined,
  currentC: 19,
};

function decide(
  overrides: Partial<ClimateDecisionInput> &
    Pick<ClimateDecisionInput, "room" | "phase">,
): ReturnType<typeof desiredClimateCommand> {
  return desiredClimateCommand({
    occupied: true,
    everyoneConfirmedAway: false,
    outdoorC: 5,
    roomState: OFF,
    ...overrides,
  });
}

describe("losAngelesHour", () => {
  test("uses Pacific time, including daylight saving", () => {
    expect(losAngelesHour(new Date("2026-01-15T15:59:00Z"))).toBe(7);
    expect(losAngelesHour(new Date("2026-01-15T16:00:00Z"))).toBe(8);
    expect(losAngelesHour(new Date("2026-07-15T14:59:00Z"))).toBe(7);
    expect(losAngelesHour(new Date("2026-07-15T15:00:00Z"))).toBe(8);
    expect(losAngelesHour(new Date("2026-11-25T08:00:00Z"))).toBe(0);
  });
});

describe("climatePhase", () => {
  test("sleeps until 08:00 and holds the day setpoint after that", () => {
    expect(climatePhase(0)).toBe("sleep");
    expect(climatePhase(7)).toBe("sleep");
    expect(climatePhase(8)).toBe("day");
    expect(climatePhase(23)).toBe("day");
  });
});

describe("desiredClimateCommand", () => {
  test("holds both rooms at 21°C during the day when it is cold", () => {
    expect(decide({ room: "bedroom", phase: "day" })).toEqual({
      kind: "heat",
      temperatureC: DAY_SETPOINT_C,
    });
    expect(decide({ room: "living_room", phase: "day" })).toEqual({
      kind: "heat",
      temperatureC: DAY_SETPOINT_C,
    });
  });

  test("sets the bedroom back to 18°C at night and turns living-room heat off", () => {
    expect(
      decide({
        room: "bedroom",
        phase: "sleep",
        roomState: { mode: "heat", targetC: 21, currentC: 21 },
      }),
    ).toEqual({ kind: "heat", temperatureC: SLEEP_SETPOINT_C });
    expect(
      decide({
        room: "living_room",
        phase: "sleep",
        roomState: { mode: "heat", targetC: 21, currentC: 21 },
      }),
    ).toEqual({ kind: "turn_off" });
    expect(
      decide({
        room: "living_room",
        phase: "sleep",
        roomState: { mode: "off", targetC: undefined, currentC: 19 },
      }),
    ).toEqual({ kind: "noop" });
  });

  test("does not call the service when the unit is already at the setpoint", () => {
    expect(
      decide({
        room: "bedroom",
        phase: "day",
        roomState: { mode: "heat", targetC: 21, currentC: 20 },
      }),
    ).toEqual({ kind: "noop" });
    expect(
      decide({
        room: "bedroom",
        phase: "sleep",
        roomState: { mode: "heat", targetC: 18, currentC: 18.5 },
      }),
    ).toEqual({ kind: "noop" });
  });

  test("turns heat off only when everyone is confirmed away", () => {
    const away = {
      occupied: false,
      everyoneConfirmedAway: true,
      roomState: { mode: "heat", targetC: 21, currentC: 21 },
    } as const;
    expect(decide({ room: "bedroom", phase: "day", ...away })).toEqual({
      kind: "turn_off",
    });
    expect(decide({ room: "living_room", phase: "sleep", ...away })).toEqual({
      kind: "turn_off",
    });
    expect(
      decide({
        room: "bedroom",
        phase: "day",
        occupied: false,
        everyoneConfirmedAway: true,
        roomState: { mode: "cool", targetC: 24, currentC: 24 },
      }),
    ).toEqual({ kind: "noop" });
    expect(
      decide({
        room: "bedroom",
        phase: "day",
        occupied: false,
        everyoneConfirmedAway: false,
        roomState: { mode: "heat", targetC: 21, currentC: 21 },
      }),
    ).toEqual({ kind: "noop" });
  });

  test("never overwrites cool", () => {
    expect(
      decide({
        room: "bedroom",
        phase: "day",
        roomState: { mode: "cool", targetC: 24, currentC: 19 },
      }),
    ).toEqual({ kind: "noop" });
  });

  test("stays off on a warm day and still heats a cold room without an outdoor reading", () => {
    expect(
      decide({
        room: "bedroom",
        phase: "day",
        outdoorC: 25,
        roomState: { mode: "off", targetC: undefined, currentC: 23 },
      }),
    ).toEqual({ kind: "noop" });
    expect(
      decide({
        room: "bedroom",
        phase: "day",
        outdoorC: undefined,
        roomState: { mode: "off", targetC: undefined, currentC: 23 },
      }),
    ).toEqual({ kind: "noop" });
    expect(
      decide({
        room: "bedroom",
        phase: "day",
        outdoorC: undefined,
        roomState: { mode: "off", targetC: undefined, currentC: 19 },
      }),
    ).toEqual({ kind: "heat", temperatureC: DAY_SETPOINT_C });
  });

  test("lowers an existing heat setpoint at midnight even without outdoor temperature", () => {
    expect(
      decide({
        room: "bedroom",
        phase: "sleep",
        outdoorC: undefined,
        roomState: { mode: "heat", targetC: 21, currentC: 21 },
      }),
    ).toEqual({ kind: "heat", temperatureC: SLEEP_SETPOINT_C });
  });

  test("does not start heat at night when the room is already above 18°C and the weather is unknown", () => {
    expect(
      decide({
        room: "bedroom",
        phase: "sleep",
        outdoorC: undefined,
        roomState: { mode: "off", targetC: undefined, currentC: 19 },
      }),
    ).toEqual({ kind: "noop" });
  });
});
