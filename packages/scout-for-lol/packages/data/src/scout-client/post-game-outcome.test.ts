import { describe, expect, test } from "vitest";
import {
  ScoutClientPostGameOutcomeSchema,
  projectPostGameOutcome,
  type ScoutClientPostGameProcessingState,
} from "./post-game-outcome.ts";

const complete: ScoutClientPostGameProcessingState = {
  identityResolved: true,
  conversion: "complete",
  deliveryMode: "live",
};

describe("projectPostGameOutcome", () => {
  test("a convertible live bundle is complete", () => {
    expect(projectPostGameOutcome(complete)).toBe("complete");
  });

  test("an unresolved identity wins over every other fact", () => {
    expect(
      projectPostGameOutcome({
        identityResolved: false,
        conversion: "unsupported",
        deliveryMode: "silent-backfill",
      }),
    ).toBe("waiting_identity");
  });

  test("a silent backfill is historical even when it converts", () => {
    expect(
      projectPostGameOutcome({ ...complete, deliveryMode: "silent-backfill" }),
    ).toBe("historical");
  });

  test("an unconvertible game is an unsupported mode", () => {
    expect(
      projectPostGameOutcome({
        ...complete,
        conversion: "unsupported",
        deliveryMode: null,
      }),
    ).toBe("unsupported_mode");
  });

  test("end-of-game stats alone are end_of_game", () => {
    expect(
      projectPostGameOutcome({ ...complete, conversion: "end_of_game_only" }),
    ).toBe("end_of_game");
  });

  test("every projection result is in the closed label set", () => {
    const outcomes = new Set<string>();
    for (const identityResolved of [true, false]) {
      for (const conversion of [
        "complete",
        "end_of_game_only",
        "unsupported",
      ] as const) {
        for (const deliveryMode of ["live", "silent-backfill", null] as const) {
          outcomes.add(
            projectPostGameOutcome({
              identityResolved,
              conversion,
              deliveryMode,
            }),
          );
        }
      }
    }
    expect([...outcomes].sort()).toEqual(
      [...ScoutClientPostGameOutcomeSchema.options].sort(),
    );
  });
});
