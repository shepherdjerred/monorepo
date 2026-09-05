import { afterEach, describe, expect, test } from "vitest";
import { WeeklyParlayControlActionSchema } from "@scout-for-lol/data/model/bucks/weekly-parlay.ts";
import { resetConfigurationForTests } from "#src/configuration.ts";
import { handleWeeklyParlayControl } from "#src/http/weekly-parlay-control.ts";

const PATH = "http://localhost/api/internal/weekly-parlays/actions";
const initialToken = Bun.env["WEEKLY_PARLAY_CONTROL_TOKEN"];

afterEach(() => {
  if (initialToken === undefined) {
    delete Bun.env["WEEKLY_PARLAY_CONTROL_TOKEN"];
  } else {
    Bun.env["WEEKLY_PARLAY_CONTROL_TOKEN"] = initialToken;
  }
  resetConfigurationForTests();
});

describe("weekly parlay control action schema", () => {
  test("requires an index only for progress actions", () => {
    expect(
      WeeklyParlayControlActionSchema.safeParse({
        periodKey: "2026-08-24",
        action: "progress",
      }).success,
    ).toBe(false);
    expect(
      WeeklyParlayControlActionSchema.safeParse({
        periodKey: "2026-08-24",
        action: "open",
        updateIndex: 0,
      }).success,
    ).toBe(false);
    expect(
      WeeklyParlayControlActionSchema.parse({
        periodKey: "2026-08-24",
        action: "progress",
        updateIndex: 5,
      }),
    ).toMatchObject({ slot: 0, updateIndex: 5 });
    expect(
      WeeklyParlayControlActionSchema.parse({
        periodKey: "2026-08-24",
        slot: 2,
        action: "cancel",
      }),
    ).toMatchObject({ action: "cancel", slot: 2 });
  });

  test("accepts catch-up clocks only on open actions", () => {
    const window = {
      kind: "catch_up",
      openAt: "2026-08-24T19:00:00.000Z",
      bettingClosesAt: "2026-08-25T07:00:00.000Z",
      scoringStartsAt: "2026-08-25T07:00:00.000Z",
      scoringEndsAt: "2026-08-30T18:00:00.000Z",
    };
    expect(
      WeeklyParlayControlActionSchema.safeParse({
        periodKey: "2026-08-24",
        action: "open",
        window,
      }).success,
    ).toBe(true);
    expect(
      WeeklyParlayControlActionSchema.safeParse({
        periodKey: "2026-08-24",
        action: "start",
        window,
      }).success,
    ).toBe(false);
    expect(
      WeeklyParlayControlActionSchema.safeParse({
        periodKey: "2026-08-24",
        action: "open",
        window: { ...window, arbitraryClock: "2026-08-26T00:00:00.000Z" },
      }).success,
    ).toBe(false);
  });
});

describe("weekly parlay replay compatibility boundary", () => {
  test("is absent when its credential is not configured", async () => {
    delete Bun.env["WEEKLY_PARLAY_CONTROL_TOKEN"];
    resetConfigurationForTests();
    await expect(
      handleWeeklyParlayControl(
        new Request(PATH, { method: "POST" }),
        new URL(PATH),
      ),
    ).resolves.toBeNull();
  });

  test("rejects unauthorized and malformed requests", async () => {
    Bun.env["WEEKLY_PARLAY_CONTROL_TOKEN"] = "test-control-secret";
    resetConfigurationForTests();
    const unauthorized = await handleWeeklyParlayControl(
      new Request(PATH, {
        method: "POST",
        headers: { Authorization: "Bearer wrong-secret" },
      }),
      new URL(PATH),
    );
    expect(unauthorized?.status).toBe(401);

    const malformed = await handleWeeklyParlayControl(
      new Request(PATH, {
        method: "POST",
        headers: {
          Authorization: "Bearer test-control-secret",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ periodKey: "not-a-date", action: "open" }),
      }),
      new URL(PATH),
    );
    expect(malformed?.status).toBe(400);
  });
});
