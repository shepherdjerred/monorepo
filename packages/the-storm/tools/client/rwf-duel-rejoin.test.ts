import { expect, test } from "vitest";
import {
  EMPTY_REJOIN_STATE,
  observeDuelStatus,
  rejoinTrooperDuel,
  watchRwfDuels,
} from "./rwf-duel-rejoin.ts";

test("waits for one completed human duel before auto-rejoining", () => {
  let state = EMPTY_REJOIN_STATE;
  for (const status of [
    { phase: "Lobby", humans: 0 },
    { phase: "Lobby", humans: 1 },
    { phase: "Countdown", humans: 1 },
    { phase: "Live", humans: 1 },
    { phase: "Ended", humans: 1 },
    { phase: "Resetting", humans: 0 },
  ]) {
    const transition = observeDuelStatus(state, status);
    expect(transition.shouldRejoin).toBe(false);
    state = transition.state;
  }
  const transition = observeDuelStatus(state, { phase: "Lobby", humans: 0 });
  expect(transition.shouldRejoin).toBe(true);
  expect(transition.state).toEqual(EMPTY_REJOIN_STATE);
});

test("does not auto-rejoin when the human leaves before playing", () => {
  const joined = observeDuelStatus(EMPTY_REJOIN_STATE, {
    phase: "Lobby",
    humans: 1,
  });
  const left = observeDuelStatus(joined.state, { phase: "Lobby", humans: 0 });
  expect(left.shouldRejoin).toBe(false);
});

test("selects Trooper after the rejoin enters the pre-game roster", async () => {
  const commands: string[] = [];
  const states = [
    { phase: "Resetting", humans: 0 },
    { phase: "Lobby", humans: 0 },
    { phase: "Countdown", humans: 1 },
  ];
  const joined = await rejoinTrooperDuel({
    readStatus: async () => states.shift() ?? { phase: "Lobby", humans: 1 },
    sendCommand: async (command) => commands.push(command),
    shouldStop: () => false,
    intervalMs: 1,
    sleep: async () => {
      await Promise.resolve();
    },
  });
  expect(joined).toBe(true);
  expect(commands).toEqual(["rwf join", "rwf kit trooper"]);
});

test("does not select a kit after the preview stops before rejoin", async () => {
  const commands: string[] = [];
  const controller = new AbortController();
  const joined = await rejoinTrooperDuel({
    readStatus: async () => ({ phase: "Resetting", humans: 0 }),
    sendCommand: async (command) => commands.push(command),
    shouldStop: () => controller.signal.aborted,
    intervalMs: 1,
    timeoutMs: 10,
    sleep: async () => controller.abort(),
  });
  expect(joined).toBe(false);
  expect(commands).toEqual(["rwf join"]);
});

test("status read failures never auto-join before a human has played", async () => {
  const controller = new AbortController();
  const commands: string[] = [];
  const errors: unknown[] = [];
  await watchRwfDuels({
    readStatus: async () => {
      throw new Error("temporary RCON read failure");
    },
    sendCommand: async (command) => commands.push(command),
    shouldStop: () => controller.signal.aborted,
    onRejoined: () => {
      errors.push("unexpected rejoin");
    },
    onError: (error) => errors.push(error),
    sleep: async () => controller.abort(),
  });
  expect(commands).toEqual([]);
  expect(errors).toHaveLength(1);
});

test("watcher re-queues after the completed match and then stops cleanly", async () => {
  const controller = new AbortController();
  const commands: string[] = [];
  const statuses = [
    { phase: "Lobby", humans: 0 },
    { phase: "Lobby", humans: 1 },
    { phase: "Live", humans: 1 },
    { phase: "Resetting", humans: 0 },
    { phase: "Lobby", humans: 0 },
    { phase: "Lobby", humans: 0 },
    { phase: "Countdown", humans: 1 },
  ];
  const events: string[] = [];
  let sleeps = 0;
  await watchRwfDuels({
    readStatus: async () => {
      const status = statuses.shift();
      if (status === undefined) throw new Error("unexpected status read");
      return status;
    },
    sendCommand: async (command) => commands.push(command),
    shouldStop: () => controller.signal.aborted,
    onRejoined: () => events.push("rejoined"),
    onError: (error) => events.push(String(error)),
    intervalMs: 1,
    sleep: async () => {
      sleeps++;
      if (sleeps === 6) controller.abort();
    },
  });
  expect(commands).toEqual(["rwf join", "rwf kit trooper"]);
  expect(events).toEqual(["rejoined"]);
});
