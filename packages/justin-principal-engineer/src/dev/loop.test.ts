import { mkdtemp, rename, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";

import { runDevLoop } from "#src/dev/loop.ts";

const directories: string[] = [];
const controllers: AbortController[] = [];
const loops: Promise<void>[] = [];
const noOp = (): void => undefined;

afterEach(async () => {
  for (const controller of controllers.splice(0)) controller.abort();
  await Promise.all(loops.splice(0));
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true });
});

async function setup() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "jpe-dev-"));
  directories.push(directory);
  const file = path.join(directory, "turn.ts");
  await Bun.write(file, 'process.stdout.write("first");');
  const controller = new AbortController();
  controllers.push(controller);
  return { directory, file, controller };
}

function start(input: Parameters<typeof runDevLoop>[0]): Promise<void> {
  const loop = runDevLoop(input);
  loops.push(loop);
  return loop;
}

describe("foreground development", () => {
  test("a source save starts a fresh process that sees the edit", async () => {
    const { directory, file, controller } = await setup();
    const outputs: string[] = [];
    const loop = start({
      watchPath: directory,
      intervalMs: 60_000,
      signal: controller.signal,
      log: noOp,
      turn: async () => {
        const child = Bun.spawn([process.execPath, file], {
          stdout: "pipe",
          stderr: "pipe",
        });
        outputs.push(await new Response(child.stdout).text());
        return await child.exited;
      },
    });
    await expect.poll(() => outputs.includes("first")).toBe(true);
    await Bun.write(`${file}.tmp`, 'process.stdout.write("edited");');
    await rename(`${file}.tmp`, file);
    await expect.poll(() => outputs.includes("edited")).toBe(true);
    controller.abort();
    await loop;
  });

  test("coalesces edits during a turn without overlapping or canceling it", async () => {
    const { directory, file, controller } = await setup();
    let release = noOp;
    let turns = 0;
    const changes: string[] = [];
    const loop = start({
      watchPath: directory,
      intervalMs: 60_000,
      signal: controller.signal,
      log: (message) => {
        changes.push(message);
      },
      turn: async () => {
        turns += 1;
        if (turns === 1)
          await new Promise<void>((resolve) => {
            release = resolve;
          });
        else controller.abort();
        return 0;
      },
    });
    try {
      await expect.poll(() => turns).toBe(1);
      await Bun.write(file, "first edit");
      await expect
        .poll(() =>
          changes.some((message) => message.startsWith("Source changed")),
        )
        .toBe(true);
      await Bun.write(file, "second edit");
      await expect
        .poll(
          () =>
            changes.filter((message) => message.startsWith("Source changed"))
              .length,
        )
        .toBeGreaterThan(1);
      expect(turns).toBe(1);
    } finally {
      release();
    }
    await loop;
    expect(turns).toBe(2);
  });

  test("recovers from a child failure when source is fixed", async () => {
    const { directory, file, controller } = await setup();
    await Bun.write(file, 'throw new Error("broken edit");');
    const exits: number[] = [];
    const loop = start({
      watchPath: directory,
      intervalMs: 60_000,
      signal: controller.signal,
      log: noOp,
      turn: async () => {
        const child = Bun.spawn([process.execPath, file], {
          stdout: "ignore",
          stderr: "ignore",
        });
        const exit = await child.exited;
        exits.push(exit);
        return exit;
      },
    });
    await expect.poll(() => exits.includes(1)).toBe(true);
    await Bun.write(file, "process.exit(0);");
    await expect.poll(() => exits.includes(0)).toBe(true);
    controller.abort();
    await loop;
  });

  test("stop drains the current turn and schedules no more work", async () => {
    const { directory, controller } = await setup();
    let release = noOp;
    let finished = false;
    let turns = 0;
    const loop = start({
      watchPath: directory,
      intervalMs: 1,
      signal: controller.signal,
      log: noOp,
      turn: async () => {
        turns += 1;
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        finished = true;
        return 0;
      },
    });
    await expect.poll(() => turns).toBe(1);
    controller.abort();
    expect(finished).toBe(false);
    release();
    await loop;
    expect(finished).toBe(true);
    expect(turns).toBe(1);
  });
});
