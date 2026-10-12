import { mkdtemp, mkdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import {
  actorActionBody,
  playtestFiles,
  renderActorAction,
  renderReport,
  scenarioTemplate,
} from "#lib/mc/play.ts";

let dir: string;
beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "toolkit-mc-play-"));
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("actor action bodies", () => {
  test("builds each action from flags and trailing text", () => {
    expect(
      actorActionBody(
        "goto",
        { pos: "1,-60,2", range: "2", timeout: "5000" },
        "",
      ),
    ).toEqual({
      pos: { x: 1, y: -60, z: 2 },
      range: 2,
      timeoutMs: 5000,
    });
    expect(actorActionBody("command", {}, "/time set day")).toEqual({
      command: "/time set day",
    });
    expect(
      actorActionBody("place", { pos: "0,0,0", block: "minecraft:stone" }, ""),
    ).toEqual({
      pos: { x: 0, y: 0, z: 0 },
      block: "minecraft:stone",
    });
    expect(
      actorActionBody("equip", { item: "minecraft:bow", slot: "offhand" }, ""),
    ).toEqual({
      item: "minecraft:bow",
      slot: "offhand",
    });
    expect(actorActionBody("attack", { type: "minecraft:pig" }, "")).toEqual({
      type: "minecraft:pig",
    });
  });

  test("fails loudly on missing or invalid input", () => {
    expect(() => actorActionBody("use", {}, "")).toThrow(/--pos/u);
    expect(() => actorActionBody("chat", {}, "")).toThrow(
      /a message is required/u,
    );
    expect(() =>
      actorActionBody("goto", { pos: "1,2,3", range: "far" }, ""),
    ).toThrow(/--range must be a number/u);
    expect(() =>
      actorActionBody("equip", { item: "x", slot: "pocket" }, ""),
    ).toThrow();
  });
});

describe("rendering", () => {
  test("renders an action result with its events", () => {
    expect(
      renderActorAction({
        ok: false,
        detail: "breaking minecraft:bedrock was refused",
        pos: { x: 1, y: -60, z: 1 },
        events: [
          {
            seq: 7,
            ts: "2026-10-04T00:00:00Z",
            type: "actor",
            player: "alice",
            text: "x",
          },
        ],
      }),
    ).toBe(
      "FAILED  breaking minecraft:bedrock was refused\n  at 1,-60,1\n  #7 actor alice: x",
    );
  });

  test("summarizes a failed report", () => {
    const text = renderReport({
      runId: "pt-20261004-015929-585a",
      dir: "/runs/pt-20261004-015929-585a",
      scenario: {
        name: "lamp",
        description: "",
        file: "/x.playtest.ts",
        sha256: "0".repeat(64),
      },
      target: { id: "sbx-abc123", profile: "paper" },
      startedAt: "2026-10-04T00:00:00Z",
      durationMs: 2500,
      status: "failed",
      steps: [
        {
          name: "light it",
          status: "failed",
          durationMs: 10,
          error: "not lit",
        },
      ],
      assertions: [
        { description: "lamp is lit", passed: false, detail: "found unlit" },
      ],
      notes: [],
      artifacts: [],
    });
    expect(text).toContain("FAILED  lamp  (2.5s, pt-20261004-015929-585a)");
    expect(text).toContain("step ✗ light it: not lit");
    expect(text).toContain("assert ✗ lamp is lit (found unlit)");
    expect(text).toContain("report /runs/pt-20261004-015929-585a/report.json");
  });
});

describe("playtest files", () => {
  test("expands directories into sorted scenario files", async () => {
    await mkdir(path.join(dir, "suite", "nested"), { recursive: true });
    await Bun.write(path.join(dir, "suite", "b.playtest.ts"), "");
    await Bun.write(path.join(dir, "suite", "nested", "a.playtest.ts"), "");
    await Bun.write(path.join(dir, "suite", "helper.ts"), "");
    expect(await playtestFiles([path.join(dir, "suite")])).toEqual([
      path.join(dir, "suite", "b.playtest.ts"),
      path.join(dir, "suite", "nested", "a.playtest.ts"),
    ]);
  });

  test("fails when a directory has no scenarios", async () => {
    await mkdir(path.join(dir, "empty"), { recursive: true });
    await expect(playtestFiles([path.join(dir, "empty")])).rejects.toThrow(
      /No \*\.playtest\.ts files/u,
    );
  });

  test("scaffolds a scenario that imports the public API", () => {
    expect(scenarioTemplate('lever "test"')).toContain(
      'import { defineScenario } from "@shepherdjerred/mc-harness/playtest/define.ts";',
    );
    expect(scenarioTemplate('lever "test"')).toContain(
      String.raw`name: "lever \"test\""`,
    );
  });
});
