import { expect, test } from "bun:test";
import { InputLeaseConflictError } from "#src/emulator/emulator.ts";
import type { CommandInput } from "#src/game/command/command-input.ts";
import { executeInteractiveChord } from "./message-handler.ts";

const COMMAND: CommandInput = {
  command: "a",
  quantity: 1,
};

test("interactive chord reports a goal lease without acknowledging input", async () => {
  const accepted = await executeInteractiveChord(
    [COMMAND],
    () => Promise.reject(new InputLeaseConflictError("goal")),
    0,
  );
  expect(accepted).toBe(false);
});

test("interactive chord accepts queued input and propagates unknown failures", async () => {
  const accepted = await executeInteractiveChord(
    [COMMAND],
    () => Promise.resolve(),
    0,
  );
  expect(accepted).toBe(true);
  await expect(
    executeInteractiveChord(
      [COMMAND],
      () => Promise.reject(new Error("queue failed")),
      0,
    ),
  ).rejects.toThrow("queue failed");
});
