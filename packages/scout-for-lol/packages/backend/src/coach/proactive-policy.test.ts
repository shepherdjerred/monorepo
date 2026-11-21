import { describe, expect, test } from "vitest";
import { EnvironmentSchema } from "#src/configuration.ts";
import {
  decideProactiveTurn,
  proactiveRefusedIn,
  type ProactiveFlags,
} from "./proactive-policy.ts";

/** Every combination of the three coach flags. */
const EVERY_FLAG_STATE: readonly ProactiveFlags[] = [false, true].flatMap(
  (coachEnabled) =>
    [false, true].flatMap((liveAnswersEnabled) =>
      [false, true].map((proactiveEnabled) => ({
        coachEnabled,
        liveAnswersEnabled,
        proactiveEnabled,
      })),
    ),
);

describe("decideProactiveTurn", () => {
  test("production admits no proactive turn under any flag state", () => {
    expect(EVERY_FLAG_STATE).toHaveLength(8);
    for (const flags of EVERY_FLAG_STATE) {
      expect(decideProactiveTurn("prod", flags), JSON.stringify(flags)).toEqual(
        { admitted: false, reason: "production" },
      );
    }
    expect(proactiveRefusedIn("prod")).toBe(true);
  });

  test.each(EnvironmentSchema.options.filter((env) => env !== "prod"))(
    "%s admits a proactive turn only with all three flags on",
    (environment) => {
      expect(proactiveRefusedIn(environment)).toBe(false);
      for (const flags of EVERY_FLAG_STATE) {
        const decision = decideProactiveTurn(environment, flags);
        expect(decision.admitted, JSON.stringify(flags)).toBe(
          flags.coachEnabled &&
            flags.liveAnswersEnabled &&
            flags.proactiveEnabled,
        );
      }
    },
  );

  test.each<[ProactiveFlags, string]>([
    [
      { coachEnabled: false, liveAnswersEnabled: true, proactiveEnabled: true },
      "coach_disabled",
    ],
    [
      { coachEnabled: true, liveAnswersEnabled: false, proactiveEnabled: true },
      "live_answers_disabled",
    ],
    [
      { coachEnabled: true, liveAnswersEnabled: true, proactiveEnabled: false },
      "proactive_disabled",
    ],
  ])("beta refuses %o as %s", (flags, reason) => {
    expect(decideProactiveTurn("beta", flags)).toEqual({
      admitted: false,
      reason,
    });
  });
});
