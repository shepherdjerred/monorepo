import { describe, expect, test } from "vitest";
import type { RegionReadResponse } from "@shepherdjerred/mc-harness/protocol/bridge.ts";
import type { SandboxSummary } from "@shepherdjerred/mc-harness/protocol/ipc.ts";
import {
  paletteCounts,
  renderRegion,
  renderSandbox,
  renderWe,
} from "#lib/mc/render.ts";

function region(indices: number[]): RegionReadResponse {
  return {
    world: "world",
    min: { x: 0, y: -60, z: 0 },
    max: { x: indices.length - 1, y: -60, z: 0 },
    size: { x: indices.length, y: 1, z: 1 },
    palette: ["minecraft:air", "minecraft:stone"],
    blocks: Buffer.from(new Uint32Array(indices).buffer).toString("base64"),
    blockEntities: [],
  };
}

describe("region rendering", () => {
  test("counts little-endian uint32 palette indices", () => {
    expect(paletteCounts(region([1, 1, 0, 1]))).toEqual([
      ["minecraft:stone", 3],
      ["minecraft:air", 1],
    ]);
  });

  test("summarizes the box and palette", () => {
    const text = renderRegion(region([1, 0]));
    expect(text).toContain("world 0,-60,0 → 1,-60,0 (2×1×1)");
    expect(text).toContain("minecraft:stone");
  });
});

describe("WorldEdit rendering", () => {
  test("marks failed ops and history size", () => {
    const text = renderWe({
      results: [
        {
          command: "//set stone",
          ok: true,
          messages: ["8 blocks changed"],
          errors: [],
        },
        {
          command: "//bogus",
          ok: false,
          messages: [],
          errors: ["Unknown command"],
        },
      ],
      historySize: 1,
    });
    expect(text).toContain("ok  //set stone");
    expect(text).toContain("ERR //bogus");
    expect(text).toContain("! Unknown command");
    expect(text).toContain("history: 1");
  });
});

describe("sandbox rendering", () => {
  test("shows endpoints but no secrets exist to leak", () => {
    const sandbox: SandboxSummary = {
      id: "sbx-abc123",
      provider: "docker",
      profile: "paper",
      world: "void",
      status: "ready",
      createdAt: "2026-10-03T00:00:00.000Z",
      expiresAt: "2026-10-03T02:00:00.000Z",
      keep: true,
      bootMs: 41_000,
      endpoints: {
        game: { host: "127.0.0.1", port: 50_001 },
        rcon: { host: "127.0.0.1", port: 50_002 },
        bridge: { host: "127.0.0.1", port: 50_003 },
      },
    };
    const text = renderSandbox(sandbox);
    expect(text).toContain("sbx-abc123  ready  paper/void  keep");
    expect(text).toContain("game 127.0.0.1:50001  bridge 127.0.0.1:50003");
    expect(text).not.toMatch(/token|password/iu);
  });
});
