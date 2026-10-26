import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, test } from "vitest";
import {
  isMacSessionPreflightFailure,
  MacSessionPreflightError,
  requireUnlockedMac,
} from "./mac-session.ts";

const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true });
});

test("locked preflight retains its exact observation and a distinct boundary error", async () => {
  const directory = await mkdtemp(
    path.join(tmpdir(), "facet-session-preflight-"),
  );
  directories.push(directory);
  const destination = path.join(directory, "workflow-2.session.json");
  await expect(
    requireUnlockedMac(destination, async (argv) => {
      expect(argv.slice(0, 3)).toEqual(["xcrun", "swift", "-e"]);
      return JSON.stringify({ onConsole: true, locked: true });
    }),
  ).rejects.toBeInstanceOf(MacSessionPreflightError);
  expect(await Bun.file(destination).json()).toEqual({
    onConsole: true,
    locked: true,
  });
});

test("preflight classification survives aggregate boundaries without classifying UI failures", () => {
  const blocked = new MacSessionPreflightError(new Error("locked"));
  expect(
    isMacSessionPreflightFailure(
      new AggregateError([new AggregateError([blocked])]),
    ),
  ).toBe(true);
  expect(
    isMacSessionPreflightFailure(
      new AggregateError([new Error("Native UI assertion failed")]),
    ),
  ).toBe(false);
  expect(isMacSessionPreflightFailure(new Error("Mac native preflight"))).toBe(
    false,
  );
});

test("a failed session probe remains preflight and cannot manufacture readiness evidence", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "facet-session-probe-"));
  directories.push(directory);
  const destination = path.join(directory, "session.json");
  await expect(
    requireUnlockedMac(destination, async () => {
      throw new Error("probe exited 3");
    }),
  ).rejects.toBeInstanceOf(MacSessionPreflightError);
  expect(await Bun.file(destination).exists()).toBe(false);
});
