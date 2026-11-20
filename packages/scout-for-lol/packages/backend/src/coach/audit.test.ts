import { describe, expect, test } from "vitest";
import { EnvironmentSchema } from "#src/configuration.ts";
import { proactiveTriggerOf, type CoachTurnRecord } from "./audit.ts";

const PROACTIVE: CoachTurnRecord = {
  deviceId: "4fa2a856-53af-42a4-85af-5cc085a942a3",
  initiation: "app_proactive",
  gameKey: "g-1",
  projection: {
    context: null,
    present: ["live"],
    accepted: ["live"],
    withheld: [],
  },
  flags: {
    coachEnabled: true,
    liveAnswersEnabled: true,
    proactiveEnabled: true,
  },
  trigger: { kind: "enemy_fed", windowKey: "Zed" },
};

describe("proactiveTriggerOf, checked before a coach turn writes anything", () => {
  test("outside production a proactive turn admits its trigger for its game", () => {
    for (const environment of EnvironmentSchema.options.filter(
      (name) => name !== "prod",
    )) {
      expect(proactiveTriggerOf(PROACTIVE, environment)).toEqual({
        gameKey: "g-1",
        trigger: { kind: "enemy_fed", windowKey: "Zed" },
      });
    }
  });

  test("production refuses a proactive turn whatever its flags say", () => {
    expect(() => proactiveTriggerOf(PROACTIVE, "prod")).toThrow(
      "never starts in production",
    );
  });

  test("a trigger rides only on a proactive turn, and a proactive turn always has one", () => {
    const { trigger: _trigger, ...withoutTrigger } = PROACTIVE;
    expect(() => proactiveTriggerOf(withoutTrigger, "beta")).toThrow();
    expect(() =>
      proactiveTriggerOf(
        { ...PROACTIVE, initiation: "player_typed", gameKey: null },
        "beta",
      ),
    ).toThrow();
    expect(() =>
      proactiveTriggerOf({ ...PROACTIVE, gameKey: null }, "beta"),
    ).toThrow("names its game");
  });

  test("any other turn has no trigger, in every environment", () => {
    const { trigger: _trigger, ...typed } = PROACTIVE;
    for (const environment of EnvironmentSchema.options) {
      expect(
        proactiveTriggerOf(
          { ...typed, initiation: "player_typed", gameKey: null },
          environment,
        ),
      ).toBeNull();
    }
  });
});
