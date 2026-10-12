import { describe, expect, test } from "vitest";
import type { Status } from "@discord-plays-pokemon/common";
import { disabledReason, EMPTY_GAME, KEYMAP, reduceGame } from "./game.ts";

const STATUS: Status = {
  sessionActive: true,
  driverFeedEnabled: true,
  playerList: [],
  playBlocker: null,
  voiceChannelName: "Hoenn",
  minimumInChannel: 2,
};
const READY = { ...EMPTY_GAME, connected: true, status: STATUS };

describe("controller bindings", () => {
  test.each([
    ["ArrowUp", "up"],
    ["KeyW", "up"],
    ["ArrowLeft", "left"],
    ["KeyA", "left"],
    ["ArrowDown", "down"],
    ["KeyS", "down"],
    ["ArrowRight", "right"],
    ["KeyD", "right"],
    ["KeyZ", "a"],
    ["KeyX", "b"],
    ["KeyQ", "lb"],
    ["KeyE", "rb"],
    ["Enter", "start"],
    ["ShiftLeft", "select"],
    ["ShiftRight", "select"],
  ])("%s maps to %s", (key, expected) => {
    expect(KEYMAP[key]).toBe(expected);
  });
  test("unbound keys are left alone", () => {
    expect(KEYMAP.Space).toBeUndefined();
  });
});

describe("game responses", () => {
  test("personalized status changes without dropping the current input log", () => {
    const inputs = [
      {
        id: "1",
        at: "2026-10-12T12:00:00Z",
        user: "May",
        source: "web" as const,
        command: "a",
      },
    ];
    const game = reduceGame(
      reduceGame(READY, { kind: "inputs", value: inputs }),
      { kind: "status", value: { ...STATUS, playBlocker: "not-in-voice" } },
    );
    expect(game.inputs).toEqual(inputs);
    expect(game.status?.playBlocker).toBe("not-in-voice");
  });
  test("a refused command explains the cause and acceptance clears it", () => {
    const refused = reduceGame(READY, {
      kind: "input-result",
      value: { accepted: false, command: "a", reason: "goal-mode" },
    });
    expect(refused.notice).toContain("goal agent");
    expect(
      reduceGame(refused, {
        kind: "input-result",
        value: { accepted: true, command: "a" },
      }).notice,
    ).toBeNull();
  });
  test("session end clears the state", () => {
    expect(reduceGame(READY, { kind: "state", value: null }).state).toBeNull();
  });
});

describe("disabled controls", () => {
  test("connection, session, and identity take priority", () => {
    expect(disabledReason(EMPTY_GAME, false)).toContain("Connecting");
    expect(disabledReason({ ...READY, status: null }, true)).toContain(
      "Checking",
    );
    expect(
      disabledReason(
        { ...READY, status: { ...STATUS, sessionActive: false } },
        true,
      ),
    ).toContain("No game");
    expect(disabledReason(READY, false)).toContain("Sign in");
  });
  test("voice and the player threshold have useful instructions", () => {
    expect(
      disabledReason(
        { ...READY, status: { ...STATUS, playBlocker: "not-in-voice" } },
        true,
      ),
    ).toContain("Join Hoenn");
    expect(
      disabledReason(
        { ...READY, status: { ...STATUS, playBlocker: "too-few-players" } },
        true,
      ),
    ).toContain("2 players");
  });
  test("the goal lease disables controls; other goal outcomes allow play", () => {
    const state = {
      phase: "overworld" as const,
      location: "Route 101",
      party: [],
      badges: Array.from({ length: 8 }, () => false),
      pokedexOwned: 0,
      money: 0,
      goal: { goal: "Explore", status: "running" as const },
    };
    expect(disabledReason({ ...READY, state }, true)).toContain("goal agent");
    expect(
      disabledReason(
        {
          ...READY,
          state: { ...state, goal: { ...state.goal, status: "completed" } },
        },
        true,
      ),
    ).toBeNull();
  });
});
