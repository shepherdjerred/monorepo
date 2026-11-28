import path from "node:path";
import { expect, test } from "vitest";
import {
  FRONTEND_DEV_PREREQUISITE_COMMAND,
  FRONTEND_OPTIMIZE_IMAGES_COMMAND,
  astroDevCommand,
  runFrontendDev,
} from "#scripts/dev.ts";

function ignoreSignal(_signal: NodeJS.Signals): void {
  // Default test process stub does not observe signals.
}

test("builds upstream workspace dependencies, optimizes showcase images, and forwards CLI flags to astro dev", async () => {
  const calls: { command: readonly string[]; cwd: string }[] = [];
  const processes = [
    { exited: Promise.resolve(0), kill: ignoreSignal },
    { exited: Promise.resolve(0), kill: ignoreSignal },
    { exited: Promise.resolve(0), kill: ignoreSignal },
  ];

  const exitCode = await runFrontendDev(
    ["--host", "127.0.0.1", "--port", "4321"],
    (command, cwd) => {
      calls.push({ command, cwd });
      const next = processes.shift();
      if (next === undefined) throw new Error("unexpected spawn");
      return next;
    },
  );

  expect(exitCode).toBe(0);
  const frontendRoot = path.resolve(import.meta.dirname, "..");
  const repoRoot = path.resolve(frontendRoot, "../../../..");
  expect(calls).toEqual([
    {
      command: FRONTEND_DEV_PREREQUISITE_COMMAND,
      cwd: repoRoot,
    },
    {
      command: FRONTEND_OPTIMIZE_IMAGES_COMMAND,
      cwd: frontendRoot,
    },
    {
      command: astroDevCommand(["--host", "127.0.0.1", "--port", "4321"]),
      cwd: frontendRoot,
    },
  ]);
});

test("stops immediately when upstream dependency builds fail", async () => {
  const calls: string[][] = [];
  const exitCode = await runFrontendDev(["--port", "4321"], (command) => {
    calls.push([...command]);
    return { exited: Promise.resolve(13), kill: ignoreSignal };
  });

  expect(exitCode).toBe(13);
  expect(calls).toEqual([[...FRONTEND_DEV_PREREQUISITE_COMMAND]]);
});

test("stops before astro dev when showcase image optimization fails", async () => {
  const calls: string[][] = [];
  const exitCodes = [0, 9];
  const exitCode = await runFrontendDev(["--port", "4321"], (command) => {
    calls.push([...command]);
    const code = exitCodes.shift() ?? 1;
    return { exited: Promise.resolve(code), kill: ignoreSignal };
  });

  expect(exitCode).toBe(9);
  expect(calls).toEqual([
    [...FRONTEND_DEV_PREREQUISITE_COMMAND],
    [...FRONTEND_OPTIMIZE_IMAGES_COMMAND],
  ]);
});

test("forwards SIGINT and SIGTERM to the active child process", async () => {
  const receivedSignals: NodeJS.Signals[] = [];
  const astroExited = Promise.withResolvers<number>();
  let step = 0;

  const runPromise = runFrontendDev([], () => {
    step += 1;
    if (step < 3) {
      return { exited: Promise.resolve(0), kill: ignoreSignal };
    }
    return {
      exited: astroExited.promise,
      kill(signal?: NodeJS.Signals | number) {
        if (typeof signal === "string") {
          receivedSignals.push(signal);
        }
        astroExited.resolve(0);
      },
    };
  });

  await Bun.sleep(10);
  process.emit("SIGTERM", "SIGTERM");
  expect(await runPromise).toBe(0);
  expect(receivedSignals).toEqual(["SIGTERM"]);
});
