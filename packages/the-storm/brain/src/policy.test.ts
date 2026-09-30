import { describe, expect, it } from "vitest";
import type { PilotConfig } from "./config.ts";
import {
  humanPlayers,
  inPilotWindow,
  privateAuthCacheMode,
  windowEndDelayMs,
} from "./policy.ts";

const CONFIG: PilotConfig = {
  enabled: false,
  timeZone: "America/Los_Angeles",
  startHour: 18,
  endHour: 20,
  minecraftHost: "127.0.0.1",
  minecraftPort: 25_565,
  rconHost: "127.0.0.1",
  rconPort: 25_575,
  clientVersion: "26.1",
  maxCompanions: 1,
  botPlayerName: "",
  llmEnabled: false,
  llmModel: "gpt-6-luna",
  monthlyBudgetUsd: 20,
};

describe("pilot policy", () => {
  it("opens exactly from 18:00 to 20:00 Pacific daylight time", () => {
    expect(inPilotWindow(CONFIG, new Date("2026-09-26T00:59:00Z"))).toBe(false);
    expect(inPilotWindow(CONFIG, new Date("2026-09-27T01:00:00Z"))).toBe(true);
    expect(inPilotWindow(CONFIG, new Date("2026-09-27T03:00:00Z"))).toBe(false);
  });

  it("handles Pacific standard time separately", () => {
    expect(inPilotWindow(CONFIG, new Date("2026-12-02T02:00:00Z"))).toBe(true);
    expect(inPilotWindow(CONFIG, new Date("2026-12-02T04:00:00Z"))).toBe(false);
  });

  it("requires owner access and excludes other users from the token cache", () => {
    expect(privateAuthCacheMode(0o700)).toBe(true);
    for (const mode of [0o600, 0o400, 0o000, 0o701]) {
      expect(privateAuthCacheMode(mode)).toBe(false);
    }
  });

  it("ends at 20:00 Pacific during daylight and standard time", () => {
    expect(windowEndDelayMs(CONFIG, new Date("2026-09-27T01:30:00Z"))).toBe(
      90 * 60 * 1000,
    );
    expect(windowEndDelayMs(CONFIG, new Date("2026-12-02T03:30:00Z"))).toBe(
      30 * 60 * 1000,
    );
    expect(() =>
      windowEndDelayMs(CONFIG, new Date("2026-09-27T03:00:00Z")),
    ).toThrow();
  });

  it("requires a real player and rejects unknown list formats", () => {
    expect(
      humanPlayers("There are 1 of a max of 20 players online: Alex"),
    ).toEqual(["Alex"]);
    expect(
      humanPlayers(
        "There are 2 of a max of 20 players online: BotOne, Alex",
        "BotOne",
      ),
    ).toEqual(["Alex"]);
    expect(
      humanPlayers(
        "There are 1 of a max of 20 players online: BotOne",
        "BotOne",
      ),
    ).toEqual([]);
    expect(() => humanPlayers("online maybe: Alex", "BotOne")).toThrow();
    expect(() =>
      humanPlayers("There are 2 of a max of 20 players online: Alex", "BotOne"),
    ).toThrow();
  });
});
