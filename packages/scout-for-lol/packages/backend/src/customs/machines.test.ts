import { describe, expect, test } from "bun:test";
import { transitionCustomGame } from "#src/customs/game-machine.ts";
import { transitionCustomNight } from "#src/customs/night-machine.ts";

describe("custom night machine", () => {
  test("runs a game and returns through intermission", () => {
    expect(
      transitionCustomNight("RECRUITING", { type: "START_PREPARING" }),
    ).toBe("PREPARING");
    expect(transitionCustomNight("PREPARING", { type: "START_DRAFT" })).toBe(
      "DRAFTING",
    );
    expect(transitionCustomNight("DRAFTING", { type: "TEAMS_LOCKED" })).toBe(
      "LOBBY_READY",
    );
    expect(transitionCustomNight("LOBBY_READY", { type: "GAME_STARTED" })).toBe(
      "PLAYING",
    );
    expect(
      transitionCustomNight("PLAYING", { type: "INTERMISSION_OPENED" }),
    ).toBe("INTERMISSION");
    expect(
      transitionCustomNight("INTERMISSION", { type: "PREPARE_NEXT_GAME" }),
    ).toBe("PREPARING");
  });

  test("refuses skipped transitions", () => {
    expect(() =>
      transitionCustomNight("RECRUITING", { type: "GAME_STARTED" }),
    ).toThrow("Invalid custom night transition");
  });
});

describe("custom game machine", () => {
  test("supports Riot replacing a manual result", () => {
    expect(
      transitionCustomGame("RESULT_PENDING", { type: "MANUAL_RESULT" }),
    ).toBe("MANUAL");
    expect(transitionCustomGame("MANUAL", { type: "RIOT_RESULT" })).toBe(
      "VERIFIED",
    );
  });

  test("supports retaining teams without drafting", () => {
    expect(transitionCustomGame("CAPTAINS_SET", { type: "TEAMS_LOCKED" })).toBe(
      "CODE_PENDING",
    );
  });
});
