import { describe, expect, test } from "vitest";
import {
  COACH_APP_TURN_LIMITS,
  type CoachGameContext,
} from "@scout-for-lol/data";
import fixtures from "@scout-for-lol/data/scout-client/coach-context.fixtures.json" with { type: "json" };
import { z } from "zod";
import { appTurnAllowed, appTurnLimit } from "./app-turns.ts";
import { coachExecutionProfile, IN_GAME_PROFILE } from "./execution-profile.ts";

const complete = z
  .record(z.string(), z.unknown())
  .parse(fixtures.valid[0]?.body);

function only(section: string): CoachGameContext {
  // The fixture is validated by the contract's own tests.
  return z
    .custom<CoachGameContext>()
    .parse({ [section]: structuredClone(complete[section]) });
}

describe("coachExecutionProfile", () => {
  test.each(["champSelect", "live"])(
    "a turn in %s runs the in-game profile",
    (section) => {
      expect(coachExecutionProfile(only(section))).toBe(IN_GAME_PROFILE);
    },
  );

  test("the in-game profile is low effort, six steps and 1,200 output tokens", () => {
    expect(IN_GAME_PROFILE).toMatchObject({
      reasoningEffort: "low",
      maxSteps: 6,
      maxOutputTokens: 1200,
    });
  });

  test.each(["pregame", "postgame"])(
    "a %s turn keeps the Explore settings",
    (section) => {
      expect(coachExecutionProfile(only(section))).toBeNull();
    },
  );

  test("no game context keeps the Explore settings", () => {
    expect(coachExecutionProfile(null)).toBeNull();
    expect(coachExecutionProfile(undefined)).toBeNull();
  });
});

describe("app turn limits", () => {
  test("4 champ-select turns and 1 pre-game turn per game key", () => {
    expect(COACH_APP_TURN_LIMITS).toEqual({
      app_champ_select: 4,
      app_pregame: 1,
    });
    expect(appTurnLimit("app_champ_select")).toBe(4);
    expect(appTurnLimit("app_pregame")).toBe(1);
  });

  test.each([
    ["app_champ_select", 0, true],
    ["app_champ_select", 3, true],
    ["app_champ_select", 4, false],
    ["app_champ_select", 9, false],
    ["app_pregame", 0, true],
    ["app_pregame", 1, false],
  ] as const)(
    "%s with %i started allows the next: %s",
    (initiation, started, allowed) => {
      expect(appTurnAllowed(initiation, started)).toBe(allowed);
    },
  );
});
