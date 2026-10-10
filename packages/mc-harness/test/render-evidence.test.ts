import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import { BlockGrid } from "@shepherdjerred/mc-build/core/grid.ts";
import { ensureAssets } from "@shepherdjerred/mc-build/render/assets.ts";
import { Renderer, encodePng } from "@shepherdjerred/mc-build/render/index.ts";
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
