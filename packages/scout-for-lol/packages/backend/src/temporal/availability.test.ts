import { describe, expect, test } from "vitest";
import type { ScoutTemporalHealth } from "#src/temporal/health.ts";
import { startsAvailable } from "#src/temporal/availability.ts";

/**
 * The bug this pins: the supervisor stays INSTALLED while its connection is
 * down, because the reconnect loop is the thing it exists to run. Reading its
 * presence as availability lit up every workflow-start arm in the console
 * during an outage, and each of those arms could only throw.
 *
 * Exhaustive over the health union rather than spot-checked, so a new state has
 * to be classified here before it can silently default into "available".
 */

const STATES: readonly ScoutTemporalHealth["state"][] = [
  "starting",
  "connected",
  "degraded",
  "stopping",
];

describe("durable starts are available only while connected", () => {
  test("an installed supervisor with no connection is unavailable", () => {
    // Mid-reconnect: the supervisor exists, `client()` throws.
    expect(
      startsAvailable({ supervisorInstalled: true, health: "degraded" }),
    ).toBe(false);
  });

  test("an installed, connected supervisor is available", () => {
    expect(
      startsAvailable({ supervisorInstalled: true, health: "connected" }),
    ).toBe(true);
  });

  test("no supervisor is unavailable whatever the health record says", () => {
    // The health record is process-global and outlives any one supervisor, so
    // it alone must never be enough to report available.
    for (const health of STATES) {
      expect(startsAvailable({ supervisorInstalled: false, health })).toBe(
        false,
      );
    }
  });

  test("connected is the only state that reports available", () => {
    const available = STATES.filter((health) =>
      startsAvailable({ supervisorInstalled: true, health }),
    );
    expect(available).toEqual(["connected"]);
  });
});
