import path from "node:path";
import { describe, expect, test } from "vitest";
import {
  captureOut,
  hotbarBody,
  lookBody,
  moveBody,
  renderClients,
  renderClientStatus,
} from "#lib/mc/game-client.ts";

const entry = path.resolve(import.meta.dirname, "../../src/index.ts");

async function run(args: string[]) {
  const child = Bun.spawn([process.execPath, "run", entry, "mc", ...args], {
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...Bun.env,
      HOME: "/nonexistent-toolkit-mc-test",
      TOOLKIT_MC_NO_AUTOSTART: "1",
    },
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { stdout, stderr, exitCode };
}

const client = {
  name: "HarnessClient",
  target: "sbx-abc123",
  server: "127.0.0.1:50001",
  pid: 4242,
  startedAt: "2026-10-04T00:00:00.000Z",
  artifacts: "/home/me/.toolkit/mc/clients/HarnessClient-1",
};

describe("client argument bodies", () => {
  test("look takes yaw and pitch, including negatives", () => {
    expect(lookBody(["-90", "-30.5"])).toEqual({ yaw: -90, pitch: -30.5 });
    expect(() => lookBody(["90"])).toThrow("<pitch> must be a number");
  });

  test("move validates buttons and defaults to one second", () => {
    expect(moveBody(["forward", "jump"], undefined)).toEqual({
      buttons: ["forward", "jump"],
      ticks: 20,
    });
    expect(moveBody(["attack"], "40")).toEqual({
      buttons: ["attack"],
      ticks: 40,
    });
    expect(() => moveBody([], undefined)).toThrow("move needs buttons");
    expect(() => moveBody(["fly"], undefined)).toThrow('unknown button "fly"');
  });

  test("hotbar is an index 0-8", () => {
    expect(hotbarBody(["3"])).toEqual({ slot: 3 });
    expect(() => hotbarBody(["9"])).toThrow("hotbar index 0-8");
    expect(() => hotbarBody([])).toThrow("<slot> must be a number");
  });

  test("capture --out resolves against the caller's directory", () => {
    expect(captureOut("shots/a.png", "/work")).toBe("/work/shots/a.png");
    expect(captureOut(undefined, "/work")).toBeUndefined();
    expect(() => captureOut("a.jpg", "/work")).toThrow("must end in .png");
  });
});

describe("client rendering", () => {
  test("summarizes a joined client", () => {
    const text = renderClientStatus({
      client,
      state: {
        connected: true,
        position: [0.5, -60, 0.5],
        yaw: 135,
        pitch: 20,
        health: 20,
        food: 20,
        world: "minecraft:overworld",
        hotbar: 0,
        screen: "",
        inventory: [
          { slot: 0, type: "minecraft:stone", count: 64, name: "Stone" },
        ],
        target: {
          kind: "block",
          position: [0, -61, 2],
          type: "minecraft:grass_block",
        },
        fps: 60,
        heldInputs: [],
        pid: 777,
      },
    });
    expect(text).toContain("HarnessClient → sbx-abc123 (127.0.0.1:50001)");
    expect(text).toContain(
      "at 0.5,-60.0,0.5 in minecraft:overworld; yaw 135.0 pitch 20.0",
    );
    expect(text).toContain("hotbar 0 (minecraft:stone ×64)");
    expect(text).toContain("looking at block minecraft:grass_block @ 0,-61,2");
  });

  test("shows a client that is not in a world", () => {
    expect(
      renderClientStatus({
        client,
        state: { connected: false, screen: "Connection Lost" },
      }),
    ).toContain('not in a world (screen "Connection Lost")');
    expect(renderClients([])).toContain("toolkit mc client start");
  });
});

describe("toolkit mc client", () => {
  test("--help prints the client usage", async () => {
    const { stdout, exitCode } = await run(["client", "--help"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("toolkit mc client capture [--out f.png]");
  });

  test("validates arguments before contacting the daemon", async () => {
    const { stderr, exitCode } = await run(["client", "move", "fly"]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain('unknown button "fly"');
    const unknown = await run(["client", "dance"]);
    expect(unknown.stderr).toContain('unknown client action "dance"');
  });

  test("never starts against live tsmc", async () => {
    const { stderr, exitCode } = await run([
      "client",
      "start",
      "--target",
      "live",
    ]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("joins sandboxes only");
  });

  test("negative look angles reach the daemon", async () => {
    const { stderr, exitCode } = await run(["client", "look", "-90", "-30"]);
    expect(exitCode).toBe(1);
    expect(stderr).not.toContain("Unknown option");
    expect(stderr).toContain("toolkit mc daemon start");
  });
});
