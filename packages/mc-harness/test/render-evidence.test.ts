import { mkdtemp, rm, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import { BlockGrid } from "@shepherdjerred/mc-build/core/grid.ts";
import { gridHash } from "@shepherdjerred/mc-build/core/site.ts";
import {
  readSchematic,
  writeSchematic,
} from "@shepherdjerred/mc-build/core/schem.ts";
import { BUILD_FILES } from "#protocol/build.ts";
import { ensureAssets } from "@shepherdjerred/mc-build/render/assets.ts";
import {
  Renderer,
  encodePng,
  withoutSky,
} from "@shepherdjerred/mc-build/render/index.ts";
import { cropGrid, cutGrid } from "@shepherdjerred/mc-build/render/cut.ts";
import { renderLooks } from "#build/helpers.ts";
import { renderBuild } from "#build/commands.ts";
import { DaemonClient } from "#build/daemon-client.ts";
import { Journal } from "#build/journal.ts";
import { readSidecar } from "#build/sidecar.ts";
import { alignedComparison } from "#build/sources.ts";
import { readLog } from "#build/build-log.ts";
import {
  readCandidate,
  listCandidates,
  saveCandidate,
} from "#build/studio/candidates.ts";
import { knockout } from "#build/studio/knockout.ts";
import { resumeState } from "#build/resume.ts";
import { clearFloorOp, flatSiteBuild } from "./fixtures/flat-site.ts";
vi.mock("@shepherdjerred/mc-build/render/assets.ts", async () => {
  const { renderAssets } = await import("./fixtures/render-assets.ts");
  return { ensureAssets: renderAssets };
});
const temp = await mkdtemp(path.join(os.tmpdir(), "mc-render-evidence-"));
afterAll(async () => {
  await rm(temp, { recursive: true, force: true });
});
function enclosedRoom(): BlockGrid {
  const whole = new BlockGrid({ x: 10, y: 10, z: 10 }, "minecraft:stone");
  for (let x = 1; x < 9; x += 1)
    for (let y = 1; y < 6; y += 1)
      for (let z = 1; z < 9; z += 1) whole.set(x, y, z, "minecraft:air");
  whole.set(3, 1, 5, "minecraft:lantern");
  return whole;
}

describe("positional region evidence", () => {
  it.each(
    (["compiled", "expected", "canvas"] as const).flatMap((source) =>
      (["light", "relief", "textured"] as const).map((mode) => ({
        source,
        mode,
      })),
    ),
  )(
    "keeps whole-site context for positional $source $mode regions",
    async ({ source, mode }) => {
      const workspace = await flatSiteBuild(
        path.join(temp, `region-${source}-${mode}`),
        "region",
      );
      const whole = enclosedRoom();
      const manifest = await workspace.manifest();
      if (manifest.site === undefined) throw new Error("missing site");
      await workspace.writeManifest({
        ...manifest,
        site: { ...manifest.site, siteHash: gridHash(whole) },
      });
      const bytes = writeSchematic(whole, 3955);
      await Bun.write(workspace.file(BUILD_FILES.siteSchematic), bytes);
      const blocks = Buffer.alloc(whole.volume * 4);
      whole.data.forEach((value, index) =>
        blocks.writeUInt32LE(value, index * 4),
      );
      const captured = {
        world: "world",
        min: manifest.site.min,
        max: manifest.site.max,
        size: whole.size,
        palette: whole.palette,
        blocks: blocks.toString("base64"),
        blockEntities: [],
      };
      await workspace.writeExpected(captured);
      await workspace.writeFrozen("expected", [
        { at: manifest.site.min, bytes },
      ]);
      await workspace.writeOplog({ version: 1, ops: [] });
      const origin = { x: 4, y: 0, z: 4 };
      const localBox = { min: origin, max: { x: 6, y: 3, z: 6 } };
      const region = {
        min: { x: 104, y: 64, z: 104 },
        max: { x: 106, y: 67, z: 106 },
      };
      const grid = cropGrid(whole, localBox);
      const client = new DaemonClient();
      const read = vi.spyOn(client, "regionRead").mockResolvedValue(captured);
      const result = await renderBuild(
        {
          client,
          journal: new Journal(workspace.file("audit")),
          log: vi.fn(),
        },
        workspace.dir,
        {
          source,
          target: "sbx-000001",
          name: "region",
          region,
          ...(mode === "textured" ? {} : { look: { mode, views: ["sheet"] } }),
        },
      );
      const renderer = new Renderer(await ensureAssets());
      const expected = await renderer.sheet(grid, {
        title: "region",
        subtitle: mode === "textured" ? "region" : `region - ${mode}`,
        mode,
        lightFrom: whole,
        lightOrigin: origin,
        cropFrom: { grid: whole, box: localBox },
      });
      const wrong = await renderer.sheet(grid, {
        title: "region",
        subtitle: mode === "textured" ? "region" : `region - ${mode}`,
        mode,
      });
      const actual = Buffer.from(await Bun.file(result.render).bytes());
      expect(actual.equals(await encodePng(expected))).toBe(true);
      expect(actual.equals(await encodePng(wrong))).toBe(false);
      expect(await readSidecar(workspace, "region")).toMatchObject({
        box: region,
        gridHash: gridHash(grid),
      });
      const saved = await readSchematic(
        await Bun.file(workspace.file("renders/region.schem")).bytes(),
      );
      expect(saved.grid.size).toEqual(grid.size);
      if (source === "canvas")
        expect(read).toHaveBeenCalledWith("sbx-000001", {
          world: "world",
          min: manifest.site.min,
          max: manifest.site.max,
        });
      const compared = await renderBuild(
        { client, journal: new Journal(workspace.file("audit")), log: vi.fn() },
        workspace.dir,
        {
          source,
          target: "sbx-000001",
          name: "compared",
          region,
          compare: "region",
          look: { mode, views: [] },
        },
      );
      const context = {
        lightFrom: whole,
        lightOrigin: origin,
        cropFrom: { grid: whole, box: localBox },
      };
      const expectedCompare = await renderer.compare(grid, grid, {
        mode,
        beforeContext: context,
        afterContext: context,
      });
      const compareFile = compared.files["compare"];
      if (compareFile === undefined) throw new Error("missing comparison");
      expect(await Bun.file(compareFile).bytes()).toEqual(
        new Uint8Array(await encodePng(expectedCompare)),
      );
      if (source === "canvas" && mode === "light") {
        const earlierSchematic = await readSchematic(bytes);
        const earlierWhole = earlierSchematic.grid;
        whole.set(3, 1, 5, "minecraft:air");
        whole.data.forEach((value, index) =>
          blocks.writeUInt32LE(value, index * 4),
        );
        read.mockResolvedValue({
          ...captured,
          palette: whole.palette,
          blocks: blocks.toString("base64"),
        });
        const changed = await renderBuild(
          {
            client,
            journal: new Journal(workspace.file("audit")),
            log: vi.fn(),
          },
          workspace.dir,
          {
            source,
            target: "sbx-000001",
            name: "outside-changed",
            region,
            compare: "region",
            look: { mode, views: [] },
          },
        );
        const historical = {
          lightFrom: earlierWhole,
          lightOrigin: origin,
          cropFrom: { grid: earlierWhole, box: localBox },
        };
        const expectedHistory = await renderer.compare(grid, grid, {
          mode,
          beforeContext: historical,
          afterContext: context,
        });
        const wrongHistory = await renderer.compare(grid, grid, {
          mode,
          beforeContext: context,
          afterContext: context,
        });
        const changedFile = changed.files["compare"];
        if (changedFile === undefined)
          throw new Error("missing changed comparison");
        const changedBytes = Buffer.from(await Bun.file(changedFile).bytes());
        expect(changedBytes.equals(await encodePng(expectedHistory))).toBe(
          true,
        );
        expect(changedBytes.equals(await encodePng(wrongHistory))).toBe(false);
      }
    },
    60_000,
  );
});

describe("archived regional comparison context", () => {
  it("aligns a smaller region within archived surroundings", async () => {
    const workspace = await flatSiteBuild(
      path.join(temp, "context-subregion"),
      "subregion",
    );
    await workspace.writeOplog({ version: 1, ops: [] });
    const whole = enclosedRoom();
    const originalHash = gridHash(whole);
    const origin = { x: 2, y: 0, z: 2 };
    const selected = cropGrid(whole, {
      min: origin,
      max: { x: 7, y: 5, z: 7 },
    });
    await renderLooks(workspace, selected, "before", {
      source: "compiled",
      views: [],
      box: { min: { x: 102, y: 64, z: 102 }, max: { x: 107, y: 69, z: 107 } },
      regionContext: { grid: whole, origin },
    });
    whole.set(3, 1, 5, "minecraft:air");
    const earlier = await alignedComparison(workspace, "before", {
      min: { x: 104, y: 65, z: 104 },
      max: { x: 106, y: 67, z: 106 },
    });
    expect(earlier.context.origin).toEqual({ x: 4, y: 1, z: 4 });
    expect(gridHash(earlier.context.grid)).toBe(originalHash);
    expect(gridHash(earlier.grid)).toBe(
      gridHash(
        cropGrid(earlier.context.grid, {
          min: earlier.context.origin,
          max: { x: 6, y: 3, z: 6 },
        }),
      ),
    );
  });
  it.each(["missing", "hash", "origin", "region", "legacy", "escape"])(
    "rejects %s context before writing comparison evidence",
    async (failure) => {
      const workspace = await flatSiteBuild(
        path.join(temp, `context-${failure}`),
        "context",
      );
      await workspace.writeOplog({ version: 1, ops: [] });
      const whole = new BlockGrid({ x: 10, y: 10, z: 10 }, "minecraft:stone");
      const origin = { x: 2, y: 2, z: 2 };
      const grid = cropGrid(whole, { min: origin, max: { x: 4, y: 4, z: 4 } });
      const box = {
        min: { x: 102, y: 66, z: 102 },
        max: { x: 104, y: 68, z: 104 },
      };
      await renderLooks(workspace, grid, "before", {
        source: "compiled",
        views: [],
        box,
        regionContext: { grid: whole, origin },
      });
      const sidecar = await readSidecar(workspace, "before");
      const file = workspace.file("renders/context/before.schem");
      switch (failure) {
        case "missing":
          await rm(file);
          break;
        case "hash":
          await Bun.write(
            file,
            writeSchematic(new BlockGrid(whole.size), 3955),
          );
          break;
        case "origin":
          await Bun.write(
            workspace.file("renders/before.json"),
            JSON.stringify({
              ...sidecar,
              context: {
                gridHash: gridHash(whole),
                origin: { x: 9, y: 9, z: 9 },
              },
            }),
          );
          break;
        case "region":
          whole.set(2, 2, 2, "minecraft:air");
          await Bun.write(file, writeSchematic(whole, 3955));
          await Bun.write(
            workspace.file("renders/before.json"),
            JSON.stringify({
              ...sidecar,
              context: { gridHash: gridHash(whole), origin },
            }),
          );
          break;
        case "legacy": {
          const { context: _context, ...legacy } = sidecar;
          await Bun.write(
            workspace.file("renders/before.json"),
            JSON.stringify(legacy),
          );
          break;
        }
        case "escape": {
          const outside = path.join(temp, "outside.schem");
          await Bun.write(outside, writeSchematic(whole, 3955));
          await rm(file);
          await symlink(outside, file);
          break;
        }
        default:
          throw new Error("unknown fixture");
      }
      await expect(
        alignedComparison(workspace, "before", box),
      ).rejects.toThrow();
      const journal = await readLog(workspace.dir);
      await expect(
        renderBuild(
          {
            client: new DaemonClient(),
            journal: new Journal(workspace.file("audit")),
            log: vi.fn(),
          },
          workspace.dir,
          {
            source: "compiled",
            name: "after",
            region: box,
            compare: "before",
            look: { views: [] },
          },
        ),
      ).rejects.toThrow();
      expect(
        await Bun.file(workspace.file("renders/after.json")).exists(),
      ).toBe(false);
      expect(await readLog(workspace.dir)).toEqual(journal);
    },
  );
});

describe("render and candidate evidence", () => {
  it("ignores ordinary files while retaining candidate directory validation", async () => {
    const workspace = await flatSiteBuild(
      path.join(temp, "stray-candidate-files"),
      "stray",
    );
    await workspace.writeOplog({ version: 1, ops: [] });
    await saveCandidate(workspace.dir, "valid");
    await Bun.write(workspace.file("candidates/.DS_Store"), "finder metadata");
    await Bun.write(workspace.file("candidates/notes.txt"), "notes");
    const candidates = await listCandidates(workspace.dir);
    expect(candidates.map(({ name }) => name)).toEqual(["valid"]);
    await Bun.write(workspace.file("candidates/broken/oplog.json"), "{}");
    await expect(listCandidates(workspace.dir)).rejects.toThrow();
  });
  it.each(["value", "relief", "light"] as const)(
    "frames explicitly requested %s hero views without empty headroom",
    async (mode) => {
      const workspace = await flatSiteBuild(
        path.join(temp, `hero-${mode}`),
        `hero-${mode}`,
      );
      await workspace.writeOplog({ version: 1, ops: [] });
      const whole = new BlockGrid({ x: 10, y: 128, z: 10 });
      for (let x = 0; x < 10; x += 1)
        for (let z = 0; z < 10; z += 1) {
          whole.set(x, 0, z, "minecraft:stone");
          whole.set(x, 4, z, "minecraft:oak_planks");
        }
      whole.set(5, 1, 5, "minecraft:lantern[hanging=false,waterlogged=false]");
      const result = await renderLooks(workspace, whole, "hero", {
        source: "compiled",
        mode,
        views: ["hero"],
      });
      const renderer = new Renderer(await ensureAssets());
      const expected = await renderer.view(
        withoutSky(whole),
        "iso-front-right",
        1400,
        { mode, lightFrom: whole },
      );
      const wrong = await renderer.view(whole, "iso-front-right", 1400, {
        mode,
        lightFrom: whole,
      });
      const file = result["hero"];
      if (file === undefined) throw new Error("missing hero");
      const actual = Buffer.from(await Bun.file(file).arrayBuffer());
      expect(actual.equals(await encodePng(expected))).toBe(true);
      expect(actual.equals(await encodePng(wrong))).toBe(false);
    },
    60_000,
  );

  it("defaults knockout to the current capture while retaining historical candidates", async () => {
    const workspace = await flatSiteBuild(
      path.join(temp, "knockout-current"),
      "knockout-current",
    );
    await workspace.writeOplog({ version: 1, ops: [] });
    await saveCandidate(workspace.dir, "old");
    const manifest = await workspace.manifest();
    if (manifest.site === undefined) throw new Error("missing site");
    const site = await readSchematic(
      await Bun.file(workspace.file(BUILD_FILES.siteSchematic)).bytes(),
    );
    site.grid.set(0, 1, 0, "minecraft:stone");
    await Bun.write(
      workspace.file(BUILD_FILES.siteSchematic),
      writeSchematic(site.grid, site.dataVersion),
    );
    await workspace.writeManifest({
      ...manifest,
      site: { ...manifest.site, siteHash: gridHash(site.grid) },
    });
    await saveCandidate(workspace.dir, "current");
    await workspace.writeOplog({ version: 1, ops: [clearFloorOp(1)] });
    await saveCandidate(workspace.dir, "challenger");
    const ask = vi.fn(() =>
      Promise.resolve({
        winner: "first" as const,
        confidence: 1,
        reasons: ["equal fixture"],
      }),
    );
    const result = await knockout(workspace.dir, {
      rubric: "micro",
      model: "stub",
      ask,
    });
    expect(result.bouts).toHaveLength(1);
    const [bout] = result.bouts;
    if (bout === undefined) throw new Error("missing bout");
    expect(
      [bout.incumbent, bout.challenger].toSorted((a, b) => a.localeCompare(b)),
    ).toEqual(["challenger", "current"]);
    expect(ask).toHaveBeenCalledTimes(2);
    const listed = await listCandidates(workspace.dir);
    expect(listed.map(({ name }) => name)).toContain("old");
    await expect(readCandidate(workspace.dir, "old")).rejects.toThrow(
      /different capture/u,
    );
  }, 60_000);

  it("keeps an outside lamp when cropping and cutting a light view", async () => {
    const workspace = await flatSiteBuild(
      path.join(temp, "crop-whole-light"),
      "crop-whole-light",
    );
    await workspace.writeOplog({ version: 1, ops: [] });
    const whole = new BlockGrid({ x: 36, y: 5, z: 36 }, "minecraft:stone");
    for (let x = 1; x < 35; x += 1)
      for (let y = 1; y < 4; y += 1)
        for (let z = 1; z < 35; z += 1) whole.set(x, y, z, "minecraft:air");
    whole.set(11, 1, 18, "minecraft:lantern");
    const result = await renderLooks(workspace, whole, "crop", {
      source: "compiled",
      mode: "light",
      crop: "centre",
      floor: 0,
      section: 20,
      views: ["sheet"],
    });
    const crop = cropGrid(whole, {
      min: { x: 12, y: 0, z: 12 },
      max: { x: 23, y: 4, z: 23 },
    });
    const cut = cutGrid(crop, { belowY: 0, behindZ: 8 });
    const renderer = new Renderer(await ensureAssets());
    const expected = await renderer.sheet(cut, {
      title: "crop",
      subtitle: "crop - light",
      mode: "light",
      lightFrom: whole,
      lightOrigin: { x: 12, y: 0, z: 12 },
      cropFrom: {
        grid: cutGrid(whole, { belowY: 0, behindZ: 20 }),
        box: { min: { x: 12, y: 0, z: 12 }, max: { x: 23, y: 4, z: 23 } },
      },
    });
    const wrong = await renderer.sheet(cut, {
      title: "crop",
      subtitle: "crop - light",
      mode: "light",
      lightFrom: crop,
    });
    const file = result["sheet"];
    if (file === undefined) throw new Error("missing sheet");
    const actual = Buffer.from(await Bun.file(file).arrayBuffer());
    expect(actual.equals(await encodePng(expected))).toBe(true);
    expect(actual.equals(await encodePng(wrong))).toBe(false);
  }, 60_000);

  it("rejects candidate names that disagree with their directory before side effects", async () => {
    const workspace = await flatSiteBuild(
      path.join(temp, "candidate-name-mismatch"),
      "candidate-name-mismatch",
    );
    await workspace.writeOplog({ version: 1, ops: [] });
    const candidate = await saveCandidate(workspace.dir, "foo");
    await saveCandidate(workspace.dir, "bar");
    const file = workspace.file("candidates/foo/candidate.json");
    await Bun.write(file, JSON.stringify({ ...candidate, name: "bar" }));
    const journal = await readLog(workspace.dir);
    const ask = vi.fn(() => Promise.reject(new Error("unexpected judge call")));
    await expect(readCandidate(workspace.dir, "foo")).rejects.toThrow(
      /contains name "bar"/u,
    );
    await expect(listCandidates(workspace.dir)).rejects.toThrow(
      /contains name "bar"/u,
    );
    await expect(resumeState(workspace.dir)).rejects.toThrow(
      /contains name "bar"/u,
    );
    await expect(
      knockout(workspace.dir, { rubric: "micro", model: "stub", ask }),
    ).rejects.toThrow(/contains name "bar"/u);
    expect(ask).not.toHaveBeenCalled();
    expect(await readLog(workspace.dir)).toEqual(journal);
    expect(await Bun.file(file).json()).toEqual({ ...candidate, name: "bar" });
  });
});

describe("comparison mode evidence", () => {
  it.each(["value", "normal", "squint", "relief", "light"] as const)(
    "preserves requested %s in CLI comparison output",
    async (mode) => {
      const workspace = await flatSiteBuild(
        path.join(temp, `compare-${mode}`),
        `compare-${mode}`,
      );
      await workspace.writeOplog({ version: 1, ops: [] });
      const grid = new BlockGrid({ x: 5, y: 5, z: 5 }, "minecraft:stone");
      for (let x = 1; x < 4; x += 1)
        for (let y = 1; y < 4; y += 1)
          for (let z = 1; z < 4; z += 1) grid.set(x, y, z, "minecraft:air");
      const files = await renderLooks(workspace, grid, "look", {
        source: "compiled",
        mode,
        views: [],
        floor: 2,
        compareWith: grid,
      });
      const file = files["compare"];
      if (file === undefined) throw new Error("missing comparison");
      const renderer = new Renderer(await ensureAssets());
      const section = cutGrid(grid, { belowY: 2 });
      const context = { lightFrom: grid, lightOrigin: { x: 0, y: 0, z: 0 } };
      const expected = await renderer.compare(section, section, {
        mode,
        beforeContext: context,
        afterContext: context,
      });
      const textured = await renderer.compare(section, section, {
        beforeContext: context,
        afterContext: context,
      });
      const actual = Buffer.from(await Bun.file(file).bytes());
      expect(actual.equals(await encodePng(expected))).toBe(true);
      expect(actual.equals(await encodePng(textured))).toBe(false);
    },
    60_000,
  );
});
