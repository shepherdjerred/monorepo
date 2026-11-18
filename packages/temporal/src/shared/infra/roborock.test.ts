import { describe, expect, test } from "vitest";
import {
  firstUnavailableRoborock,
  ROBOROCK_RELOAD_COOLDOWN_MS,
  ROBOROCK_UNAVAILABLE_SETTLE_MS,
  ROBOROCK_VACUUM_ENTITIES,
} from "./roborock.ts";

describe("roborock availability helpers", () => {
  test("exports expected settle and cooldown windows", () => {
    expect(ROBOROCK_VACUUM_ENTITIES).toEqual([
      "vacuum.1st_floor",
      "vacuum.2nd_floor",
      "vacuum.3rd_floor",
    ]);
    expect(ROBOROCK_UNAVAILABLE_SETTLE_MS).toBe(180_000);
    expect(ROBOROCK_RELOAD_COOLDOWN_MS).toBe(1_800_000);
  });

  test("returns undefined when vacuums are operational, errored, or unknown", () => {
    expect(
      firstUnavailableRoborock([
        { entity_id: "vacuum.1st_floor", state: "docked" },
        { entity_id: "vacuum.2nd_floor", state: "cleaning" },
        { entity_id: "vacuum.3rd_floor", state: "returning" },
      ]),
    ).toBeUndefined();

    expect(
      firstUnavailableRoborock([
        { entity_id: "vacuum.1st_floor", state: "paused" },
        { entity_id: "vacuum.2nd_floor", state: "idle" },
        { entity_id: "vacuum.3rd_floor", state: "error" },
      ]),
    ).toBeUndefined();

    expect(
      firstUnavailableRoborock([
        { entity_id: "vacuum.1st_floor", state: "unknown" },
        { entity_id: "sensor.unrelated", state: "unavailable" },
      ]),
    ).toBeUndefined();
  });

  test("returns the first unavailable floor in canonical fleet order", () => {
    expect(
      firstUnavailableRoborock([
        { entity_id: "vacuum.3rd_floor", state: "unavailable" },
        { entity_id: "vacuum.2nd_floor", state: "unavailable" },
        { entity_id: "vacuum.1st_floor", state: "docked" },
      ]),
    ).toBe("vacuum.2nd_floor");

    expect(
      firstUnavailableRoborock([
        { entity_id: "vacuum.3rd_floor", state: "unavailable" },
        { entity_id: "vacuum.1st_floor", state: "unavailable" },
      ]),
    ).toBe("vacuum.1st_floor");
  });
});
