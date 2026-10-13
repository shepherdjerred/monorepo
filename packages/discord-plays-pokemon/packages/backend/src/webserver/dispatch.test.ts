import { describe, expect, test } from "vitest";
import type { Response } from "@discord-plays-pokemon/common";
import type { Config } from "#src/config/schema.ts";
import { testConfig } from "#src/__tests__/fixtures/test-config.ts";
import type { CommandTiming } from "#src/emulator/command-sink.ts";
import { BUTTON } from "#src/emulator/constants.ts";
import {
  Emulator,
  InputLeaseConflictError,
  type InputSource,
} from "#src/emulator/emulator.ts";
import { InputLog } from "#src/game/input-log.ts";
import { handleRequest, type DispatchDriver } from "./dispatch.ts";

/** Records presses instead of queueing them on a running emulator loop. */
class RecordingEmulator extends Emulator {
  readonly presses: number[] = [];
  goalOwnsInput = false;

  constructor() {
    super({ wasmPath: "unused.wasm" });
  }

  override async queuePress(
    mask: number,
    _holdFrames: number,
    _gapFrames: number,
    source: InputSource = "interactive",
  ): Promise<void> {
    if (source !== "goal" && this.goalOwnsInput) {
      throw new InputLeaseConflictError("goal");
    }
    this.presses.push(mask);
    await Promise.resolve();
  }
}

const TIMING: CommandTiming = {
  pressFrames: 1,
  holdFrames: 9,
  burstHoldFrames: 1,
  burstGapFrames: 1,
  burstQuantity: 3,
};

/** No pause between chord actions, and at most three commands per chord. */
function dispatchConfig(): Config {
  const base = testConfig();
  return {
    ...base,
    game: {
      ...base.game,
      commands: {
        ...base.game.commands,
        delay_between_actions_in_milliseconds: 0,
        chord: { ...base.game.commands.chord, max_commands: 3, delay: 0 },
      },
    },
  };
}

function harness(active: boolean) {
  const emulator = new RecordingEmulator();
  const inputLog = new InputLog(10);
  const runtime = { emulator, timing: TIMING };
  const driver: DispatchDriver = {
    getActiveRuntime: () => (active ? runtime : null),
    inputLog,
  };
  const replies: Response[] = [];
  const socket = {
    emit: (event: string, response: Response) => {
      expect(event).toBe("response");
      replies.push(response);
      return true;
    },
  };
  const deps = {
    driver,
    config: dispatchConfig(),
    publisher: {
      sendStatus: () => {
        /* status is not under test */
      },
    },
  };
  const send = (value: string) =>
    handleRequest({ request: { kind: "command", value }, socket }, deps);
  return { emulator, inputLog, replies, send, deps };
}

describe("web command dispatch", () => {
  test("a chord completing after stop cannot repopulate cleared history", async () => {
    const { emulator, inputLog, replies, send, deps } = harness(true);
    const gate = Promise.withResolvers<undefined>();
    emulator.queuePress = () => gate.promise;
    const command = send("a");
    deps.driver.getActiveRuntime = () => null;
    inputLog.clear();
    gate.resolve(undefined);
    await command;
    expect(inputLog.recent()).toEqual([]);
    expect(replies).toEqual([
      {
        kind: "input-result",
        value: { accepted: false, command: "a", reason: "no-session" },
      },
    ]);
  });
  test("runs a valid chord and logs who sent it", async () => {
    const { emulator, inputLog, replies, send } = harness(true);
    await send("a up lb");
    expect(emulator.presses).toEqual([BUTTON.a, BUTTON.up, BUTTON.l]);
    expect(replies).toEqual([
      { kind: "input-result", value: { accepted: true, command: "a up lb" } },
    ]);
    expect(inputLog.recent()).toMatchObject([
      { source: "web", command: "a up lb" },
    ]);
  });

  test("rejects a command when no game is running", async () => {
    const { replies, send } = harness(false);
    await send("a");
    expect(replies).toEqual([
      {
        kind: "input-result",
        value: { accepted: false, command: "a", reason: "no-session" },
      },
    ]);
  });

  test("rejects text that is not a chord, or exceeds the chat limits", async () => {
    const { emulator, inputLog, replies, send } = harness(true);
    await send("hello there");
    await send("a b a b");
    expect(emulator.presses).toEqual([]);
    expect(inputLog.recent()).toEqual([]);
    expect(
      replies.map((reply) => reply.kind === "input-result" && reply.value),
    ).toEqual([
      { accepted: false, command: "hello there", reason: "invalid" },
      { accepted: false, command: "a b a b", reason: "invalid" },
    ]);
  });

  test("reports goal mode instead of running input it owns", async () => {
    const { emulator, inputLog, replies, send } = harness(true);
    emulator.goalOwnsInput = true;
    await send("a");
    expect(inputLog.recent()).toEqual([]);
    expect(replies).toEqual([
      {
        kind: "input-result",
        value: { accepted: false, command: "a", reason: "goal-mode" },
      },
    ]);
  });
});
