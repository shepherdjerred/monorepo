import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { chmod, mkdtemp, readlink, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { SpaghettiHost } from "./host.ts";

// A stand-in game: records its environment and working directory, then exits
// without connecting, which the host must report as an unexpected exit.
const FAKE_GAME = String.raw`#!/bin/sh
printf '%s\n%s\n' "$SHIP_HOME" "$(pwd -P)" > env.txt
echo "fake game: no bridge" >&2
exit 3
`;

let dir: string;

/**
 * A path under the test directory, relative to the process's working
 * directory, as the app's configured paths are.
 */
function rel(...parts: string[]): string {
  return path.relative(process.cwd(), path.join(dir, ...parts));
}

function hostOptions() {
  return {
    build: {
      binary: rel("install/game"),
      engineArchive: rel("install/spaghetti.o2r"),
      gameArchive: rel("saves/spaghettikart-assets/mk64.o2r"),
      labelFont: rel("install/label.ttf"),
    },
    homeDir: rel("saves/123/spaghettikart"),
    lockstep: true,
    outputFps: 30,
  } as const;
}

beforeEach(async () => {
  dir = await realpath(await mkdtemp(path.join(tmpdir(), "sk-host-test-")));
  await Bun.write(path.join(dir, "install/game"), FAKE_GAME);
  await chmod(path.join(dir, "install/game"), 0o755);
  await Bun.write(path.join(dir, "install/spaghetti.o2r"), "engine");
  await Bun.write(
    path.join(dir, "saves/spaghettikart-assets/mk64.o2r"),
    "game",
  );
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("SpaghettiHost", () => {
  it("resolves relative paths so the game's links and home are valid", async () => {
    // The production defaults are relative: saves/<guildId>/spaghettikart as
    // home, saves/spaghettikart-assets/mk64.o2r as the extracted archive.
    const host = new SpaghettiHost(hostOptions());

    await expect(host.start()).rejects.toThrow(
      /exited with code 3: fake game: no bridge/,
    );
    await host.stop();

    const home = path.join(dir, "saves/123/spaghettikart");
    expect(await Bun.file(path.join(home, "mk64.o2r")).text()).toBe("game");
    expect(await Bun.file(path.join(home, "spaghetti.o2r")).text()).toBe(
      "engine",
    );
    expect(path.isAbsolute(await readlink(path.join(home, "mk64.o2r")))).toBe(
      true,
    );
    const env = await Bun.file(path.join(home, "env.txt")).text();
    const [shipHome, gameCwd] = env.trim().split("\n");
    expect(shipHome !== undefined && path.isAbsolute(shipHome)).toBe(true);
    expect(gameCwd).toBe(home);
  });

  it("drops traffic for a game that has died instead of queueing it", async () => {
    const host = new SpaghettiHost(hostOptions());
    await expect(host.start()).rejects.toThrow(/exited with code 3/);
    for (let i = 0; i < 100; i++) host.sendInput([]);
    expect(host.queuedMessages).toBe(0);
    await host.stop();
  });
});
