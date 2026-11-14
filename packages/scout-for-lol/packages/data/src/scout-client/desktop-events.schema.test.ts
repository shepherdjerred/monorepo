import { describe, expect, test } from "vitest";
import rawContract from "./desktop-events.contract.json" with { type: "json" };
import rawFixtures from "./desktop-events.fixtures.json" with { type: "json" };
import {
  SCOUT_DESKTOP_EVENTS_PATH,
  ScoutDesktopEventSchema,
  ScoutDesktopPlatformSchema,
  ScoutDesktopWindowCrashCauseSchema,
  ScoutDesktopWindowCrashOutcomeSchema,
} from "./desktop-events.schema.ts";

describe("Scout desktop event contract", () => {
  test("keeps the Zod schema aligned with the shared contract", () => {
    expect(SCOUT_DESKTOP_EVENTS_PATH).toBe(rawContract.path);
    expect(ScoutDesktopPlatformSchema.options).toEqual(
      rawContract.commonProperties.platform,
    );
    expect(ScoutDesktopWindowCrashCauseSchema.options).toEqual(
      rawContract.events.window_crashed.cause,
    );
    expect(ScoutDesktopWindowCrashOutcomeSchema.options).toEqual(
      rawContract.events.window_crashed.outcome,
    );
    expect(
      ScoutDesktopEventSchema.options.map((option) => option.shape.event.value),
    ).toEqual(Object.keys(rawContract.events));
  });

  test.each(rawFixtures.valid)("accepts the $event fixture", (fixture) => {
    expect(ScoutDesktopEventSchema.parse(fixture)).toEqual(fixture);
  });

  test.each(rawFixtures.invalid)("rejects $reason", ({ body }) => {
    expect(ScoutDesktopEventSchema.safeParse(body).success).toBe(false);
  });
});
