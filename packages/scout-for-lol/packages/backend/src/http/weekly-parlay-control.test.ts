import { afterEach, describe, expect, test } from "vitest";
import { WeeklyParlayControlActionSchema } from "#src/betting/weekly-parlay-control.ts";
import { resetConfigurationForTests } from "#src/configuration.ts";
import { handleWeeklyParlayControl } from "#src/http/weekly-parlay-control.ts";

const PATH = "http://localhost/api/internal/weekly-parlays/actions";
const initialToken = Bun.env["WEEKLY_PARLAY_CONTROL_TOKEN"];

function restoreToken(): void {
  if (initialToken === undefined) {
    delete Bun.env["WEEKLY_PARLAY_CONTROL_TOKEN"];
  } else {
    Bun.env["WEEKLY_PARLAY_CONTROL_TOKEN"] = initialToken;
  }
  resetConfigurationForTests();
}

afterEach(restoreToken);

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
  });
});

describe("weekly parlay control HTTP boundary", () => {
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

  test("rejects unauthorized requests before parsing actions", async () => {
    Bun.env["WEEKLY_PARLAY_CONTROL_TOKEN"] = "test-control-secret";
    resetConfigurationForTests();
    const response = await handleWeeklyParlayControl(
      new Request(PATH, {
        method: "POST",
        headers: { Authorization: "Bearer wrong-secret" },
      }),
      new URL(PATH),
    );
    expect(response?.status).toBe(401);
  });

  test("accepts the bearer boundary and rejects malformed actions", async () => {
    Bun.env["WEEKLY_PARLAY_CONTROL_TOKEN"] = "test-control-secret";
    resetConfigurationForTests();
    const response = await handleWeeklyParlayControl(
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
    expect(response?.status).toBe(400);
    await expect(response?.json()).resolves.toEqual({
      error: "invalid_action",
    });
  });
});
