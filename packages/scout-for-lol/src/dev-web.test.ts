import path from "node:path";
import { expect, test } from "vitest";
import {
  DEV_WEB_PREREQUISITE_COMMAND,
  devWebCommand,
  runDevWeb,
} from "./dev-web.ts";

function ignoreSignal(_signal: NodeJS.Signals): void {
  // The test processes do not need to simulate signal handling.
}

test("builds the backend and app dependency closures before starting web dev", async () => {
  const calls: { command: readonly string[]; cwd: string }[] = [];
  const processes = [
    { exited: Promise.resolve(0), kill: ignoreSignal },
    { exited: Promise.resolve(0), kill: ignoreSignal },
  ];

  const exitCode = await runDevWeb(["--no-backend-watch"], (command, cwd) => {
    calls.push({ command, cwd });
    const process = processes.shift();
    if (process === undefined) throw new Error("unexpected process");
    return process;
  });

  expect(exitCode).toBe(0);
  const packageRoot = path.resolve(import.meta.dirname, "..");
  const root = path.resolve(packageRoot, "../..");
  expect(calls).toEqual([
    {
      command: DEV_WEB_PREREQUISITE_COMMAND,
      cwd: root,
    },
    {
      command: devWebCommand(["--no-backend-watch"]),
      cwd: packageRoot,
    },
  ]);
});

test("does not start web dev when prerequisite builds fail", async () => {
  const calls: string[][] = [];
  const exitCode = await runDevWeb([], (command) => {
    calls.push([...command]);
    return { exited: Promise.resolve(17), kill: ignoreSignal };
  });

  expect(exitCode).toBe(17);
  expect(calls).toEqual([DEV_WEB_PREREQUISITE_COMMAND]);
});
