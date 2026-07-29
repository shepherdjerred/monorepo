import { expect, test } from "bun:test";
import path from "node:path";
import type { CommandInput } from "#src/game/command/command-input.ts";
import { effectiveChordDelay, execute } from "./chord-executor.ts";

test("preserves the configured chord delay gate and canonical duration", () => {
  expect(effectiveChordDelay(0, 15)).toBe(0);
  expect(effectiveChordDelay(1, 15)).toBe(15);
});

test("executes from a directory with no application config", async () => {
  const originalDirectory = process.cwd();
  const emptyDirectory = path.join(
    Bun.env.TMPDIR ?? "/tmp",
    `pokemon-chord-${crypto.randomUUID()}`,
  );
  await Bun.write(path.join(emptyDirectory, ".keep"), "", {
    createPath: true,
  });
  const commands: CommandInput[] = [];
  try {
    process.chdir(emptyDirectory);
    await execute(
      [
        { command: "up", quantity: 1 },
        { command: "a", quantity: 1 },
      ],
      (command) => {
        commands.push(command);
        return Promise.resolve();
      },
      0,
    );
  } finally {
    process.chdir(originalDirectory);
  }
  expect(commands).toEqual([
    { command: "up", quantity: 1 },
    { command: "a", quantity: 1 },
  ]);
});
