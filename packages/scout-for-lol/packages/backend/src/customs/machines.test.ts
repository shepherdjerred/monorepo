import { describe, expect, test } from "vitest";
import { transitionCustomGame } from "#src/customs/game-machine.ts";
import { transitionCustomNight } from "#src/customs/night-machine.ts";

describe("custom night state", () => {
  test("opens intermission only for the Riot result transition", () => {
    expect(transitionCustomNight("PLAYING", "RIOT_RESULT")).toBe(
      "INTERMISSION",
    );
    expect(() => transitionCustomNight("PLAYING", "PREPARE_NEXT_GAME")).toThrow(
      "Invalid custom night transition",
    );
  });

  test("supports the complete multi-game lifecycle", () => {
    expect(transitionCustomNight("RECRUITING", "START_PREPARING")).toBe(
      "PREPARING",
    );
    expect(transitionCustomNight("PREPARING", "START_DRAFT")).toBe("DRAFTING");
    expect(transitionCustomNight("DRAFTING", "TEAMS_LOCKED")).toBe(
      "LOBBY_READY",
    );
    expect(transitionCustomNight("LOBBY_READY", "GAME_STARTED")).toBe(
      "PLAYING",
    );
    expect(transitionCustomNight("INTERMISSION", "PREPARE_NEXT_GAME")).toBe(
      "PREPARING",
    );
  });
});

describe("custom game state", () => {
  test("has no manual result transition", () => {
    expect(transitionCustomGame("PLAYING", "AWAIT_RIOT")).toBe(
      "RESULT_PENDING",
    );
    expect(transitionCustomGame("RESULT_PENDING", "RIOT_RESULT")).toBe(
      "VERIFIED",
    );
  });

  test("supports retaining assigned teams", () => {
    expect(transitionCustomGame("CAPTAINS_SET", "TEAMS_LOCKED")).toBe(
      "CODE_PENDING",
    );
  });
});
