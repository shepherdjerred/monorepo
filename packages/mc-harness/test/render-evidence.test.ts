import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import { BlockGrid } from "@shepherdjerred/mc-build/core/grid.ts";
import { ensureAssets } from "@shepherdjerred/mc-build/render/assets.ts";
import {
  Renderer,
  encodePng,
  withoutSky,
} from "@shepherdjerred/mc-build/render/index.ts";
import { cropGrid, cutGrid } from "@shepherdjerred/mc-build/render/cut.ts";
import { renderLooks } from "#build/helpers.ts";
import { readLog } from "#build/build-log.ts";
import {
  readCandidate,
  listCandidates,
  saveCandidate,
} from "#build/studio/candidates.ts";
import { knockout } from "#build/studio/knockout.ts";
import { resumeState } from "#build/resume.ts";
import { flatSiteBuild } from "./fixtures/flat-site.ts";
const temp = await mkdtemp(path.join(os.tmpdir(), "mc-render-evidence-"));
afterAll(async () => {
  await rm(temp, { recursive: true, force: true });
});
describe("render and candidate evidence", () => {
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
    await workspace.writeManifest({
      ...manifest,
      site: { ...manifest.site, siteHash: "new" },
    });
    await saveCandidate(workspace.dir, "current");
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
