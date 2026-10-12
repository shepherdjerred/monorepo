import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { BlockGrid } from "@shepherdjerred/mc-build/core/grid.ts";
import { writeSchematic } from "@shepherdjerred/mc-build/core/schem.ts";
import { loadRegistry } from "@shepherdjerred/mc-build/registry/registry.ts";
import { assertTexturesPresent } from "@shepherdjerred/mc-build/render/index.ts";
import { collectEntry } from "#evals/bench/lib/collect.ts";
import {
  BENCH_FILES,
  listEntries,
  readEntry,
} from "#evals/bench/lib/entries.ts";

const FAKE_JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0]);

const fakeSheet = () => Promise.resolve(FAKE_JPEG);

describe("collectEntry", () => {
  it("writes the sheet, metadata and schematic copy for a promoted grid", async () => {
    const registry = await loadRegistry();
    const grid = new BlockGrid({ x: 5, y: 3, z: 5 });
    for (let x = 0; x < 5; x += 1) {
      for (let z = 0; z < 5; z += 1) {
        grid.set(x, 0, z, "minecraft:stone");
        if (x === 0 || x === 4 || z === 0 || z === 4) {
          grid.set(x, 1, z, "minecraft:oak_planks");
        }
      }
    }
    const bench = await mkdtemp(path.join(tmpdir(), "bench-"));
    const dir = path.join(bench, "history", "e2", "abc-codex-run1");
    const schematicOut = path.join(
      bench,
      "home",
      "e2",
      "abc-codex-run1",
      "site.schem",
    );
    let rendered: string | null = null;
    const meta = await collectEntry({
      schematic: writeSchematic(grid, registry.dataVersion),
      registry,
      renderSheet: (_grid, rubric) => {
        rendered = rubric;
        return Promise.resolve(FAKE_JPEG);
      },
      dir,
      schematicOut,
      meta: {
        id: "abc-codex-run1",
        task: "e2",
        rubric: "micro",
        anchor: false,
        weak: false,
        head: "abc",
        agent: "codex",
        model: null,
        runId: "run1",
        collectedAt: "2026-10-07T00:00:00.000Z",
        source: null,
        licence: null,
        seconds: 42,
        usage: null,
        checks: { passed: 4, total: 4 },
      },
    });
    expect(rendered).toBe("micro");
    expect(meta.blocks).toBe(25 + 16);
    expect(meta.size).toEqual({ x: 5, y: 3, z: 5 });
    expect(meta.lint.errors).toBe(0);
    expect(meta.repetition).toBe(0);
    expect(meta.schematic?.sha256).toHaveLength(64);
    expect(await Bun.file(path.join(dir, BENCH_FILES.sheet)).exists()).toBe(
      true,
    );
    expect(await Bun.file(schematicOut).exists()).toBe(true);

    const entry = await readEntry(dir);
    expect(entry?.meta.gridHash).toBe(meta.gridHash);
    expect(entry?.scores).toEqual([]);
    const listed = await listEntries("e2", "micro", bench);
    expect(listed.map((item) => item.meta.id)).toEqual(["abc-codex-run1"]);

    // Metadata without its sheet is a broken entry, not history: an offline
    // report must not publish it and a judge must not trip over it later.
    await rm(path.join(dir, BENCH_FILES.sheet));
    await expect(readEntry(dir)).rejects.toThrow(/no sheet\.jpg/u);
    await expect(listEntries("e2", "micro", bench)).rejects.toThrow(
      /no sheet\.jpg/u,
    );
  });

  it("measures repetition on what changed when the captured site is given", async () => {
    const registry = await loadRegistry();
    // Two identical 8³ cubes side by side (stone on a plank floor, so they are
    // not the uniform cubes the ratio skips): the second repeats the first.
    const grid = new BlockGrid({ x: 16, y: 8, z: 8 });
    grid.forEach((x, y, z) => {
      grid.set(x, y, z, y === 0 ? "minecraft:oak_planks" : "minecraft:stone");
    });
    const site = new BlockGrid({ x: 16, y: 8, z: 8 });
    const bench = await mkdtemp(path.join(tmpdir(), "bench-"));
    const meta = {
      id: "abc-codex-run2",
      task: "e2",
      rubric: "micro" as const,
      anchor: false,
      weak: false,
      head: "abc",
      agent: "codex",
      model: null,
      runId: "run2",
      collectedAt: "2026-10-07T00:00:00.000Z",
      source: null,
      licence: null,
      seconds: null,
      usage: null,
      checks: { passed: 0, total: 0 },
    };
    const whole = await collectEntry({
      schematic: writeSchematic(grid, registry.dataVersion),
      registry,
      renderSheet: fakeSheet,
      dir: path.join(bench, "history", "e2", "whole"),
      schematicOut: null,
      meta,
    });
    // The site already had the left cube, so only the right one is the build.
    site.forEach((x, y, z) => {
      if (x < 8) site.set(x, y, z, grid.get(x, y, z));
    });
    const delta = await collectEntry({
      schematic: writeSchematic(grid, registry.dataVersion),
      site: writeSchematic(site, registry.dataVersion),
      registry,
      renderSheet: fakeSheet,
      dir: path.join(bench, "history", "e2", "delta"),
      schematicOut: null,
      meta: { ...meta, id: "abc-codex-run3" },
    });
    expect(whole.repetition).toBeGreaterThan(0);
    expect(delta.repetition).toBe(0);
    const rock = new BlockGrid(grid.size, "minecraft:stone");
    const excavated = new BlockGrid(grid.size, "minecraft:stone");
    for (const ox of [0, 8]) {
      for (let x = 0; x < 4; x += 1) {
        for (let y = 0; y < 4; y += 1) {
          for (let z = 0; z < 4; z += 1)
            excavated.set(ox + x, y, z, "minecraft:air");
        }
      }
    }
    const excavation = await collectEntry({
      schematic: writeSchematic(excavated, registry.dataVersion),
      site: writeSchematic(rock, registry.dataVersion),
      registry,
      renderSheet: fakeSheet,
      dir: path.join(bench, "history", "e2", "excavation"),
      schematicOut: null,
      meta,
    });
    expect(excavation.repetition).toBe(1);
  });
});

describe("assertTexturesPresent", () => {
  it("refuses a render that drew the missing-texture checker", () => {
    expect(() =>
      assertTexturesPresent({ missingTextures: [] }, "judge sheet"),
    ).not.toThrow();
    expect(() =>
      assertTexturesPresent(
        { missingTextures: ["block/oak_planks", "block/stone"] },
        "judge sheet (micro)",
      ),
    ).toThrow(/block\/oak_planks, block\/stone/u);
  });
});
