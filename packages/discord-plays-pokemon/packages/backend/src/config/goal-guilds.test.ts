import { describe, expect, it } from "vitest";
import { readGoalGuildIds } from "./goal-guilds.ts";

describe("readGoalGuildIds", () => {
  it("denies every guild when unset or empty", () => {
    expect(readGoalGuildIds({}).size).toBe(0);
    expect(readGoalGuildIds({ GOAL_ALLOWED_GUILD_IDS: "" }).size).toBe(0);
    expect(readGoalGuildIds({ GOAL_ALLOWED_GUILD_IDS: " , " }).size).toBe(0);
  });

  it("parses a comma-separated list of guild IDs", () => {
    expect([
      ...readGoalGuildIds({
        GOAL_ALLOWED_GUILD_IDS: "208425771172102144, 1337623164146155593",
      }),
    ]).toEqual(["208425771172102144", "1337623164146155593"]);
  });

  it("fails on a malformed entry instead of guessing", () => {
    expect(() =>
      readGoalGuildIds({ GOAL_ALLOWED_GUILD_IDS: "208425771172102144,storm" }),
    ).toThrow(/GOAL_ALLOWED_GUILD_IDS/);
  });
});
