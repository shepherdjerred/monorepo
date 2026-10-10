import { cp, mkdtemp, rm, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import { BlockGrid } from "@shepherdjerred/mc-build/core/grid.ts";
import { writeSchematic } from "@shepherdjerred/mc-build/core/schem.ts";
import { loadRegistry } from "@shepherdjerred/mc-build/registry/registry.ts";
import { appendLog, readLog } from "#build/build-log.ts";
import { renderBuild } from "#build/commands.ts";
import { DaemonClient } from "#build/daemon-client.ts";
import { Journal } from "#build/journal.ts";
import {
  candidateGrid,
  candidateScore,
  listCandidates,
  pickCandidate,
  saveCandidate,
} from "#build/studio/candidates.ts";
import {
  BY_EYE,
  critiqueBuild,
  lowestAxis,
  parseByEye,
  renderCritique,
  type AskCode,
} from "#build/studio/critique.ts";
import { renderLooks, renderGrid } from "#build/helpers.ts";
import { rubricAxisIds, type AskJudge, type AskScore } from "#build/judge.ts";
import { knockout } from "#build/studio/knockout.ts";
import { renderResume, resumeState } from "#build/resume.ts";
import { createScratch } from "#build/scratch.ts";
import {
  checkName,
  allSidecars,
  latestRenderName,
  producingProgram,
  programSnapshot,
  readSidecar,
} from "#build/sidecar.ts";
import { alignedRender, compiledGrid, cropToBox } from "#build/sources.ts";
import { BuildWorkspace } from "#build/workspace.ts";
import { flatSiteBuild } from "./fixtures/flat-site.ts";
import { BUILD_FILES, JudgeRecordSchema, type Op } from "#protocol/build.ts";

const temp = await mkdtemp(path.join(os.tmpdir(), "mc-harness-candidates-"));
afterAll(async () => {
  await rm(temp, { recursive: true, force: true });
});

/** A flat-site build with an empty program and no ops yet. */
async function makeBuild(name: string): Promise<BuildWorkspace> {
  const workspace = await flatSiteBuild(path.join(temp, name), name);
  await Bun.write(
    workspace.file(BUILD_FILES.program),
    "export default (() => {}) satisfies unknown;\n",
  );
  await workspace.writeOplog({ version: 1, ops: [] });
  return workspace;
}

/** Appends a paste op of a `width`-wide stone slab so each version compiles to a different grid. */
async function pastePart(
  workspace: BuildWorkspace,
  width: number,
  digest = "abc",
): Promise<void> {
  const registry = await loadRegistry();
  const part = new BlockGrid({ x: width, y: 2, z: 2 });
  for (let x = 0; x < width; x += 1) {
    part.set(x, 0, 0, "minecraft:stone");
    part.set(x, 1, 1, "minecraft:oak_planks");
  }
  const file = path.join(
    BUILD_FILES.schematicsDir,
    `part-${width.toString()}.schem`,
  );
  await Bun.write(
    workspace.file(file),
    writeSchematic(part, registry.dataVersion),
  );
  await workspace.writeOplog({
    version: 1,
    ops: [
      {
        kind: "paste",
        world: "world",
        schematic: file,
        at: { x: 102, y: 65, z: 102 },
        rotate: 0,
        ignoreAir: true,
        source: `program:${digest}`,
      },
    ],
  });
  // What `compile` keeps beside its output: the program text that produced it.
  await cp(
    workspace.file(BUILD_FILES.program),
    workspace.file(programSnapshot(digest)),
  );
}

async function opsOf(workspace: BuildWorkspace): Promise<readonly Op[]> {
  const oplog = await workspace.oplog();
  return oplog.ops;
}

async function programOf(
  workspace: BuildWorkspace,
  name: string,
): Promise<string | null> {
  const sidecar = await readSidecar(workspace, name);
  return sidecar.program;
}

function renderProgramText(
  workspace: BuildWorkspace,
  name: string,
): Promise<string> {
  return Bun.file(workspace.file(`renders/${name}.build.ts`)).text();
}

/** Appends a hand-made copy of the first op, so no single compile produced the log any more. */
async function addManualOp(workspace: BuildWorkspace): Promise<void> {
  const oplog = await workspace.oplog();
  const [first] = oplog.ops;
  if (first === undefined) throw new Error("fixture wrote no ops");
  await workspace.writeOplog({
    ...oplog,
    ops: [...oplog.ops, { ...first, source: "manual" }],
  });
}

const scorer =
  (depth: number): AskScore =>
  () =>
    Promise.resolve({
      axes: Object.fromEntries(
        rubricAxisIds("micro").map((id) => [id, id === "depth" ? depth : 3]),
      ),
      overallAesthetic: 2,
      notes: ["flat east wall (NORMAL)", "no eaves (HERO)"],
    });

const reviewer: AskCode = (input) =>
  Promise.resolve({
    suggestions: [
      {
        axis: input.lowest,
        change: "inset the windows by one block",
        where: "walls()",
      },
      {
        axis: "detail",
        change: "add a chimney on the north gable",
        where: "roof()",
      },
    ],
  });

describe("render evidence integrity", () => {
  it("refuses changed schematic evidence before scoring or recording", async () => {
    const workspace = await makeBuild("corrupt-evidence");
    await pastePart(workspace, 3);
    const { grid } = await compiledGrid(workspace, await workspace.manifest());
    await renderLooks(workspace, grid, "original", { source: "compiled" });
    const before = await readSidecar(workspace, "original");
    grid.set(0, 1, 0, "minecraft:stone");
    const registry = await loadRegistry();
    await Bun.write(
      workspace.file("renders/original.schem"),
      writeSchematic(grid, registry.dataVersion),
    );
    let calls = 0;
    await expect(
      critiqueBuild(workspace.dir, {
        render: "original",
        rubric: "micro",
        model: "stub",
        ask: (image) => {
          calls += 1;
          return scorer(1)(image);
        },
        askCode: () => {
          calls += 1;
          throw new Error("unexpected code call");
        },
      }),
    ).rejects.toThrow(/does not match sidecar/u);
    expect(calls).toBe(0);
    expect(await readLog(workspace.dir)).toEqual([]);
    expect(await readSidecar(workspace, "original")).toEqual(before);
    expect(
      await readdir(workspace.file(BUILD_FILES.judgeDir)).catch(() => []),
    ).toEqual([]);
  });

  it("refuses malformed sidecars instead of selecting an older render", async () => {
    const workspace = await makeBuild("corrupt-sidecar");
    expect(await allSidecars(workspace)).toEqual([]);
    await pastePart(workspace, 3);
    const { grid } = await compiledGrid(workspace, await workspace.manifest());
    await renderLooks(workspace, grid, "old", { source: "compiled" });
    const broken = workspace.file("renders/new.json");
    await Bun.write(broken, JSON.stringify({ name: "new", at: "2099-01-01" }));
    await expect(latestRenderName(workspace, [])).rejects.toThrow(
      /invalid render sidecar.*new.json/u,
    );
    await Bun.write(broken, "{");
    await expect(allSidecars(workspace)).rejects.toThrow(
      /invalid render sidecar.*new.json/u,
    );
    await rm(workspace.file(BUILD_FILES.rendersDir), { recursive: true });
    await Bun.write(workspace.file(BUILD_FILES.rendersDir), "not a directory");
    await expect(allSidecars(workspace)).rejects.toThrow(/ENOTDIR/u);
  });

  it("refuses missing textures without recording a successful render", async () => {
    const workspace = await makeBuild("missing-textures");
    const bad = new BlockGrid(
      { x: 2, y: 2, z: 2 },
      "minecraft:nonexistent_texture_test",
    );
    await expect(
      renderLooks(workspace, bad, "bad", { source: "compiled" }),
    ).rejects.toThrow(/textures missing/u);
    await expect(renderGrid(workspace, bad, "plain", "plain")).rejects.toThrow(
      /textures missing/u,
    );
    expect(await allSidecars(workspace)).toEqual([]);
    expect(await readLog(workspace.dir)).toEqual([]);
    expect(await Bun.file(workspace.file("renders/bad.png")).exists()).toBe(
      false,
    );
    const good = new BlockGrid(bad.size, "minecraft:stone");
    await expect(
      renderLooks(workspace, good, "comparison", {
        source: "compiled",
        compareWith: bad,
      }),
    ).rejects.toThrow(/textures missing/u);
    expect(
      await Bun.file(workspace.file("renders/comparison.png")).exists(),
    ).toBe(false);
  });

  it.each(["compiled", "expected", "plain"] as const)(
    "preserves existing render artifacts when %s program evidence is missing",
    async (kind) => {
      const workspace = await makeBuild(`missing-render-${kind}`);
      await pastePart(workspace, 2);
      const initial = await compiledGrid(workspace, await workspace.manifest());
      await renderLooks(workspace, initial.grid, "kept", {
        source: "compiled",
        views: ["sheet"],
      });
      await appendLog(workspace.dir, {
        kind: "run",
        target: "canvas",
        ops: 1,
        program: programSnapshot("abc"),
      });
      await pastePart(workspace, 4, "def");
      await rm(
        workspace.file(programSnapshot(kind === "expected" ? "abc" : "def")),
      );
      const changed = await compiledGrid(workspace, await workspace.manifest());
      const files = ["png", "schem", "json", "build.ts"].map((suffix) =>
        Bun.file(workspace.file(`renders/kept.${suffix}`)),
      );
      const before = await Promise.all(files.map((file) => file.bytes()));
      const journal = await readLog(workspace.dir);
      const attempt =
        kind === "plain"
          ? renderBuild(
              {
                client: new DaemonClient(),
                journal: new Journal(workspace.file("audit")),
                log: vi.fn(),
              },
              workspace.dir,
              { source: "compiled", name: "kept" },
            )
          : renderLooks(workspace, changed.grid, "kept", {
              source: kind,
              views: ["sheet"],
            });
      await expect(attempt).rejects.toThrow(
        /missing producing program snapshot|ENOENT/u,
      );
      expect(await Promise.all(files.map((file) => file.bytes()))).toEqual(
        before,
      );
      expect(await readLog(workspace.dir)).toEqual(journal);
    },
  );

  it("preserves a saved candidate and working program when its compile snapshot is missing", async () => {
    const workspace = await makeBuild("missing-snapshot");
    await pastePart(workspace, 3);
    await saveCandidate(workspace.dir, "safe");
    const info = workspace.file("candidates/safe/candidate.json");
    const before = await Bun.file(info).text();
    await Bun.write(
      workspace.file(BUILD_FILES.program),
      "// current working program\n",
    );
    await rm(workspace.file(programSnapshot("abc")));
    await expect(
      producingProgram(workspace, await opsOf(workspace)),
    ).rejects.toThrow(/missing producing program snapshot/u);
    await expect(
      saveCandidate(workspace.dir, "safe", { force: true }),
    ).rejects.toThrow(/missing producing program snapshot/u);
    expect(await Bun.file(info).text()).toBe(before);
    expect(
      await Bun.file(workspace.file(BUILD_FILES.program)).text(),
    ).toContain("current working program");
    await pickCandidate(workspace.dir, "safe");
    expect(
      await Bun.file(workspace.file(BUILD_FILES.program)).text(),
    ).toContain("satisfies unknown");
  });
});

describe("critique", () => {
  it("scores the latest render blind, reviews the program, and records all of it", async () => {
    const workspace = await makeBuild("critique");
    await pastePart(workspace, 3);
    const { grid } = await compiledGrid(workspace, await workspace.manifest());
    await renderLooks(workspace, grid, "iter-1", { source: "compiled" });
    const result = await critiqueBuild(workspace.dir, {
      rubric: "micro",
      model: "stub",
      ask: scorer(1),
      askCode: reviewer,
    });
    expect(result.render).toBe("iter-1");
    expect(result.lowest).toBe("depth");
    expect(result.scores.total).toBe(3 * 7 + 1);
    expect(result.reviewedProgram).toBe(true);
    expect(result.suggestions[0]?.axis).toBe("depth");
    expect(await Bun.file(workspace.file(result.sheet)).exists()).toBe(true);
    const record = JudgeRecordSchema.parse(
      await Bun.file(workspace.file(result.record)).json(),
    );
    expect(record.kind).toBe("critique");
    const sidecar = await readSidecar(workspace, "iter-1");
    expect(sidecar.scores?.total).toBe(result.scores.total);
    expect(sidecar.source).toBe("compiled");
    expect(sidecar.files["sheet"]).toBe("renders/iter-1.png");
    const journal = await readLog(workspace.dir);
    expect(journal.map((entry) => entry.kind)).toEqual(["critique"]);
    const text = renderCritique(result);
    expect(text).toContain("lowest: depth (1)");
    expect(text).toContain("1. [depth] inset the windows");

    // A critique of an earlier render belongs to that render's iteration and
    // reviews the program that produced it, not the current build.ts.
    await appendLog(workspace.dir, {
      kind: "render",
      name: "iter-1",
      source: "compiled",
      files: [],
    });
    await renderLooks(workspace, grid, "iter-2", { source: "compiled" });
    await appendLog(workspace.dir, {
      kind: "render",
      name: "iter-2",
      source: "compiled",
      files: [],
    });
    await Bun.write(
      workspace.file(BUILD_FILES.program),
      "// changed since iter-1\n",
    );
    let reviewed = "";
    const again = await critiqueBuild(workspace.dir, {
      render: "iter-1",
      rubric: "micro",
      model: "stub",
      ask: scorer(1),
      askCode: (input) => {
        reviewed = input.program;
        return reviewer(input);
      },
    });
    expect(again.iteration).toBe(1);
    expect(reviewed).toContain("satisfies unknown");
    expect(reviewed).not.toContain("changed since");
  }, 60_000);

  it("skips the code stage when asked, and refuses it without a program", async () => {
    const workspace = await makeBuild("critique-visual");
    await pastePart(workspace, 2);
    const { grid } = await compiledGrid(workspace, await workspace.manifest());
    await renderLooks(workspace, grid, "look", { source: "compiled" });
    const visual = await critiqueBuild(workspace.dir, {
      rubric: "micro",
      model: "stub",
      stage: "visual",
      ask: scorer(4),
      askCode: () => Promise.reject(new Error("must not be called")),
    });
    expect(visual.reviewedProgram).toBe(false);
    expect(visual.suggestions).toEqual([]);
    // A render whose ops were not all produced by one compile (a manual op
    // added by hand) has no program for the code stage to review.
    await addManualOp(workspace);
    await renderLooks(workspace, grid, "bare", { source: "compiled" });
    await expect(
      critiqueBuild(workspace.dir, {
        render: "bare",
        rubric: "micro",
        model: "stub",
        stage: "code",
        ask: scorer(4),
      }),
    ).rejects.toThrow(/made without a build.ts/u);
  }, 60_000);

  it("gives a candidate the latest critique of its grid, not the newest render's", async () => {
    const workspace = await makeBuild("critique-latest");
    await pastePart(workspace, 3);
    const { grid } = await compiledGrid(workspace, await workspace.manifest());
    await renderLooks(workspace, grid, "first", { source: "compiled" });
    await renderLooks(workspace, grid, "second", { source: "compiled" });
    // The newer render is critiqued first, then the older one again: the
    // candidate carries the later opinion (22), not the newer sidecar's (25).
    await critiqueBuild(workspace.dir, {
      render: "second",
      rubric: "micro",
      model: "stub",
      stage: "visual",
      ask: scorer(4),
    });
    await critiqueBuild(workspace.dir, {
      render: "first",
      rubric: "micro",
      model: "stub",
      stage: "visual",
      ask: scorer(1),
    });
    const saved = await saveCandidate(workspace.dir, "same");
    expect(saved.score).toEqual({ rubric: "micro", total: 3 * 7 + 1 });
    expect(await candidateScore(workspace.dir, "same", "micro")).toBe(
      3 * 7 + 1,
    );
    // A critique on the other rubric is a different number, never this one.
    expect(await candidateScore(workspace.dir, "same", "map")).toBeNull();
    await critiqueBuild(workspace.dir, {
      render: "first",
      rubric: "map",
      model: "stub",
      stage: "visual",
      ask: () =>
        Promise.resolve({
          axes: Object.fromEntries(rubricAxisIds("map").map((id) => [id, 5])),
          overallAesthetic: 5,
          notes: [],
        }),
    });
    expect(await candidateScore(workspace.dir, "same", "map")).toBe(
      5 * rubricAxisIds("map").length,
    );
    expect(await candidateScore(workspace.dir, "same", "micro")).toBe(
      3 * 7 + 1,
    );
    // Re-rendering under a reused name does not hand the old critique to the new grid.
    await pastePart(workspace, 5);
    const changed = await compiledGrid(workspace, await workspace.manifest());
    await renderLooks(workspace, changed.grid, "first", { source: "compiled" });
    const other = await saveCandidate(workspace.dir, "other");
    expect(other.gridHash).not.toBe(saved.gridHash);
    expect(other.score).toBeNull();
    const journal = await readLog(workspace.dir);
    const critiques = journal.filter((entry) => entry.kind === "critique");
    expect(
      critiques.map((entry) =>
        entry.kind === "critique" ? entry.gridHash : null,
      ),
    ).toEqual([saved.gridHash, saved.gridHash, saved.gridHash]);
  }, 120_000);

  it("compares the same cut and crop the other looks show", async () => {
    const workspace = await makeBuild("compare-cut");
    await pastePart(workspace, 3);
    const { grid } = await compiledGrid(workspace, await workspace.manifest());
    const before = new BlockGrid(grid.size);
    const whole = await renderLooks(workspace, grid, "whole", {
      source: "compiled",
      views: ["sheet"],
      compareWith: before,
    });
    const cut = await renderLooks(workspace, grid, "cut", {
      source: "compiled",
      views: ["sheet"],
      compareWith: before,
      floor: 0,
    });
    // A crop with a cut in light mode is lit by the crop before the cut.
    const litCrop = await renderLooks(workspace, grid, "lit-crop", {
      source: "compiled",
      views: ["sheet"],
      mode: "light",
      crop: "centre",
      floor: 0,
    });
    expect(litCrop["sheet"]).toBeDefined();
    const wholeCompare = whole["compare"];
    const cutCompare = cut["compare"];
    expect(wholeCompare !== undefined && cutCompare !== undefined).toBe(true);
    if (wholeCompare !== undefined && cutCompare !== undefined) {
      // The floor cut removes the plank course, so the comparison shows less
      // change than the whole-grid one (which it used to be identical to).
      const [a, b] = await Promise.all([
        Bun.file(wholeCompare).arrayBuffer(),
        Bun.file(cutCompare).arrayBuffer(),
      ]);
      expect(Buffer.from(a).equals(Buffer.from(b))).toBe(false);
    }
  }, 120_000);

  it("keeps render and candidate names inside the build directory", async () => {
    const workspace = await makeBuild("names");
    expect(checkName("render", "v1")).toBe("v1");
    for (const bad of ["../build", "a/b", "V1", "", "x".repeat(33)]) {
      expect(() => checkName("render", bad)).toThrow(/render names are/u);
    }
    await expect(readSidecar(workspace, "../build")).rejects.toThrow(
      /render names are/u,
    );
    await expect(saveCandidate(workspace.dir, "../x")).rejects.toThrow(
      /candidate names are/u,
    );
  });
});

describe("by-eye critique and compare alignment", () => {
  it("records a by-eye critique without a model, in the same shape", async () => {
    const workspace = await makeBuild("critique-by-eye");
    await pastePart(workspace, 3);
    const { grid } = await compiledGrid(workspace, await workspace.manifest());
    await renderLooks(workspace, grid, "look", { source: "compiled" });
    const scores = rubricAxisIds("micro")
      .map((id) => `${id}=${id === "depth" ? "1" : "3"}`)
      .join(",");
    const byEye = parseByEye("micro", `${scores},aesthetic=2`, [
      "flat east wall",
      " ",
    ]);
    expect(byEye.notes).toEqual(["flat east wall"]);
    const result = await critiqueBuild(workspace.dir, {
      rubric: "micro",
      model: "unused",
      byEye,
      ask: () => Promise.reject(new Error("must not ask a model")),
      askCode: () => Promise.reject(new Error("must not review code")),
    });
    expect(result.scores.model).toBe(BY_EYE);
    expect(result.scores.total).toBe(3 * 7 + 1);
    expect(result.lowest).toBe("depth");
    expect(result.reviewedProgram).toBe(false);
    const record = JudgeRecordSchema.parse(
      await Bun.file(workspace.file(result.record)).json(),
    );
    expect(record.model).toBe(BY_EYE);
    const journal = await readLog(workspace.dir);
    expect(journal.at(-1)?.kind).toBe("critique");
    expect(renderCritique(result)).toContain("flat east wall");
    await expect(
      critiqueBuild(workspace.dir, {
        rubric: "micro",
        model: "unused",
        byEye,
        stage: "code",
      }),
    ).rejects.toThrow(/no code stage/u);
    expect(() => parseByEye("micro", "depth=9", [])).toThrow(/axis=0\.\.5/u);
    expect(() => parseByEye("micro", "depth=3,aesthetic=2", [])).toThrow(
      /missing/u,
    );
    expect(() => parseByEye("micro", `${scores},aesthetic=2,x=1`, [])).toThrow(
      /unknown x/u,
    );
  }, 60_000);

  it("records the program that produced the ops, not the file as edited since", async () => {
    const workspace = await makeBuild("provenance");
    await pastePart(workspace, 3);
    await Bun.write(
      workspace.file(BUILD_FILES.program),
      "// edited after compile\n",
    );
    const { grid } = await compiledGrid(workspace, await workspace.manifest());
    await renderLooks(workspace, grid, "after-edit", {
      source: "compiled",
      views: ["sheet"],
    });
    const sidecar = await readSidecar(workspace, "after-edit");
    expect(sidecar.program).toBe("renders/after-edit.build.ts");
    const kept = await Bun.file(
      workspace.file("renders/after-edit.build.ts"),
    ).text();
    expect(kept).toContain("satisfies unknown");
    expect(kept).not.toContain("edited after compile");
    // A manual op means no single program produced the grid.
    await addManualOp(workspace);
    await renderLooks(workspace, grid, "mixed", {
      source: "compiled",
      views: ["sheet"],
    });
    const mixed = await readSidecar(workspace, "mixed");
    expect(mixed.program).toBeNull();
  }, 60_000);

  it("binds canvas and expected renders to the program that ran, not the one compiled since", async () => {
    const workspace = await makeBuild("ran-provenance");
    await pastePart(workspace, 3);
    const ranOps = await opsOf(workspace);
    const ran = await producingProgram(workspace, ranOps);
    if (ran === null) throw new Error("expected one program behind the ops");
    const { grid } = await compiledGrid(workspace, await workspace.manifest());
    const look = (name: string, source: "canvas" | "expected" | "compiled") =>
      renderLooks(workspace, grid, name, { source, views: ["sheet"] });
    // Nothing has run yet: the canvas and the frozen result are not this program's.
    await look("unrun", "expected");
    expect(await programOf(workspace, "unrun")).toBeNull();
    await appendLog(workspace.dir, {
      kind: "run",
      target: "canvas",
      ops: ranOps.length,
      program: ran,
    });
    await look("ran", "canvas");
    expect(await programOf(workspace, "ran")).toBe("renders/ran.build.ts");
    // Compile again without running: the frozen result is still the run's
    // program, the canvas may have moved on, the compiled grid is the new one.
    await Bun.write(workspace.file(BUILD_FILES.program), "// second program\n");
    await pastePart(workspace, 5, "def");
    expect(await producingProgram(workspace, await opsOf(workspace))).toBe(
      programSnapshot("def"),
    );
    await look("frozen", "expected");
    expect(await programOf(workspace, "frozen")).toBe(
      "renders/frozen.build.ts",
    );
    expect(await renderProgramText(workspace, "frozen")).not.toContain(
      "second program",
    );
    await look("moved", "canvas");
    expect(await programOf(workspace, "moved")).toBeNull();
    await look("recompiled", "compiled");
    expect(await renderProgramText(workspace, "recompiled")).toContain(
      "second program",
    );
  }, 60_000);

  it("cuts a site-sized grid to a district for any source", () => {
    const site = {
      min: { x: 100, y: 64, z: 100 },
      max: { x: 109, y: 73, z: 109 },
    };
    const grid = new BlockGrid({ x: 10, y: 10, z: 10 });
    grid.set(4, 2, 6, "minecraft:stone");
    expect(cropToBox(grid, site, site)).toBe(grid);
    const district = cropToBox(grid, site, {
      min: { x: 103, y: 64, z: 105 },
      max: { x: 106, y: 67, z: 108 },
    });
    expect(district.size).toEqual({ x: 4, y: 4, z: 4 });
    expect(district.get(1, 2, 1)).toBe("minecraft:stone");
  });

  it("aligns an earlier render to the region being compared", async () => {
    const workspace = await makeBuild("compare-region");
    await pastePart(workspace, 3);
    const { grid } = await compiledGrid(workspace, await workspace.manifest());
    const site = {
      min: { x: 100, y: 64, z: 100 },
      max: { x: 109, y: 73, z: 109 },
    };
    await renderLooks(workspace, grid, "whole", {
      source: "compiled",
      views: ["sheet"],
      box: site,
    });
    await renderLooks(workspace, grid, "unplaced", {
      source: "compiled",
      views: ["sheet"],
    });
    const same = await alignedRender(workspace, "whole", site);
    expect(same.size).toEqual(grid.size);
    const part = {
      min: { x: 102, y: 64, z: 102 },
      max: { x: 105, y: 67, z: 105 },
    };
    const cut = await alignedRender(workspace, "whole", part);
    expect(cut.size).toEqual({ x: 4, y: 4, z: 4 });
    expect(cut.get(0, 1, 0)).toBe(grid.get(2, 1, 2));
    await expect(
      alignedRender(workspace, "whole", {
        min: { x: 98, y: 64, z: 100 },
        max: { x: 105, y: 67, z: 105 },
      }),
    ).rejects.toThrow(/covers/u);
    await expect(alignedRender(workspace, "unplaced", site)).rejects.toThrow(
      /does not record the region/u,
    );
  }, 60_000);

  it("names the first lowest axis in rubric order", () => {
    const axes = Object.fromEntries(
      rubricAxisIds("micro").map((id) => [id, 3]),
    );
    expect(lowestAxis("micro", { ...axes, siteFit: 2, depth: 2 })).toBe(
      "siteFit",
    );
    // A missing axis counts as 0, so an empty answer points at the first axis.
    expect(lowestAxis("map", {})).toBe(rubricAxisIds("map")[0]);
  });
});

/** A judge that prefers the image with more pixels of content (the wider slab compresses larger). */
const prefersWide: AskJudge = (first, second) =>
  Promise.resolve({
    winner: first.data.length >= second.data.length ? "first" : "second",
    confidence: 0.9,
    reasons: ["more relief"],
  });

/** A position-biased judge: whichever image comes first wins, so the swap makes it a tie. */
const biased: AskJudge = () =>
  Promise.resolve({ winner: "first", confidence: 0.7, reasons: ["position"] });

describe("candidate capture and judgment evidence", () => {
  it.each(["contents", "placement", "world"])(
    "rejects a candidate after capture %s changes before side effects",
    async (change) => {
      const workspace = await makeBuild(`capture-${change}`);
      await pastePart(workspace, 2);
      await saveCandidate(workspace.dir, "old");
      const manifest = await workspace.manifest();
      if (manifest.site === undefined) throw new Error("fixture has no site");
      await workspace.writeManifest({
        ...manifest,
        world: change === "world" ? "another-world" : manifest.world,
        site: {
          ...manifest.site,
          siteHash: change === "contents" ? "new-site" : manifest.site.siteHash,
          min: {
            ...manifest.site.min,
            x: manifest.site.min.x + (change === "placement" ? 1 : 0),
          },
        },
      });
      const before = await readLog(workspace.dir);
      const ops = await workspace.oplog();
      const program = await Bun.file(
        workspace.file(BUILD_FILES.program),
      ).text();
      await expect(pickCandidate(workspace.dir, "old")).rejects.toThrow(
        /different capture/u,
      );
      const ask = vi.fn(prefersWide);
      await expect(
        knockout(workspace.dir, { rubric: "micro", model: "stub", ask }),
      ).rejects.toThrow(/different capture/u);
      expect(ask).not.toHaveBeenCalled();
      expect(await readLog(workspace.dir)).toEqual(before);
      expect(await workspace.oplog()).toEqual(ops);
      expect(await Bun.file(workspace.file(BUILD_FILES.program)).text()).toBe(
        program,
      );
    },
  );

  it("preserves the exact knockout inputs after replacing a losing candidate", async () => {
    const workspace = await makeBuild("knockout-archive");
    await pastePart(workspace, 2);
    await saveCandidate(workspace.dir, "narrow");
    await pastePart(workspace, 6);
    await saveCandidate(workspace.dir, "wide");
    const inputs: Uint8Array[] = [];
    const ask: AskJudge = (first, second) => {
      if (inputs.length === 0)
        inputs.push(new Uint8Array(first.data), new Uint8Array(second.data));
      return prefersWide(first, second);
    };
    const result = await knockout(workspace.dir, {
      rubric: "micro",
      model: "stub",
      ask,
    });
    const record = JudgeRecordSchema.parse(
      await Bun.file(
        workspace.file(result.bouts[0]?.record ?? "missing-record"),
      ).json(),
    );
    if (record.kind !== "pair") throw new Error("expected pair record");
    await pastePart(workspace, 4);
    await saveCandidate(workspace.dir, "narrow", { force: true });
    for (const [index, file] of [record.a, record.b].entries()) {
      expect(file).toMatch(/candidate-.*-[a-f0-9]{64}\.png$/u);
      expect(new Uint8Array(await Bun.file(file).arrayBuffer())).toEqual(
        inputs[index],
      );
    }
  });
});

describe("candidates and knockout", () => {
  it("rejects repeated challengers before judging or changing the record", async () => {
    const workspace = await makeBuild("knockout-duplicates");
    await pastePart(workspace, 2);
    await saveCandidate(workspace.dir, "a");
    await pastePart(workspace, 4);
    await saveCandidate(workspace.dir, "b");
    const before = await readLog(workspace.dir);
    const manifest = await workspace.manifest();
    const ask = vi.fn(prefersWide);
    await expect(
      knockout(workspace.dir, {
        among: ["a", "b", "b"],
        rubric: "micro",
        model: "stub",
        ask,
      }),
    ).rejects.toThrow(/names must be unique/u);
    expect(ask).not.toHaveBeenCalled();
    expect(await readLog(workspace.dir)).toEqual(before);
    expect(await workspace.manifest()).toEqual(manifest);
  });
  it("saves versions, lets a blind judge pick, and restores the winner", async () => {
    const workspace = await makeBuild("knockout");
    await pastePart(workspace, 2);
    // The live build.ts is edited after the compile the ops came from: the
    // candidate keeps the compiled text, not the edit.
    await Bun.write(
      workspace.file(BUILD_FILES.program),
      "// edited after compile\n",
    );
    const narrow = await saveCandidate(workspace.dir, "narrow");
    expect(narrow.blocks).toBe(100 + 4);
    expect(narrow.program).toBe(true);
    const kept = await Bun.file(
      workspace.file("candidates/narrow/build.ts"),
    ).text();
    expect(kept).toContain("satisfies unknown");
    expect(kept).not.toContain("edited after compile");
    await pastePart(workspace, 6);
    const wide = await saveCandidate(workspace.dir, "wide");
    expect(wide.gridHash).not.toBe(narrow.gridHash);
    await expect(saveCandidate(workspace.dir, "wide")).rejects.toThrow(
      /--force/u,
    );
    // An op with no offline result cannot be part of a candidate: the
    // compiled grid would be judged in place of the real build.
    const oplog = await workspace.oplog();
    await workspace.writeOplog({
      ...oplog,
      ops: [
        ...oplog.ops,
        {
          kind: "we",
          world: "world",
          command: "//walls stone",
          source: "manual",
        },
      ],
    });
    await expect(saveCandidate(workspace.dir, "walled")).rejects.toThrow(
      /no offline result/u,
    );
    await workspace.writeOplog(oplog);
    const saved = await listCandidates(workspace.dir);
    expect(saved.map((c) => [c.name, c.best])).toEqual([
      ["narrow", false],
      ["wide", false],
    ]);

    const result = await knockout(workspace.dir, {
      rubric: "micro",
      model: "stub",
      ask: prefersWide,
    });
    expect(result.bouts).toHaveLength(1);
    expect(result.bouts[0]?.incumbent).toBe("narrow");
    expect(result.bouts[0]?.winner).toBe("challenger");
    expect(result.best).toBe("wide");
    const manifest = await workspace.manifest();
    expect(manifest.best?.candidate).toBe("wide");
    expect(manifest.best?.gridHash).toBe(wide.gridHash);
    // The incumbent cannot be replaced in place, even with --force.
    await expect(
      saveCandidate(workspace.dir, "wide", { force: true }),
    ).rejects.toThrow(/incumbent/u);
    const journal = await readLog(workspace.dir);
    expect(journal.map((entry) => entry.kind)).toEqual([
      "candidate",
      "candidate",
      "accept",
      "reject",
    ]);
    const accept = journal[2];
    expect(
      accept?.kind === "accept"
        ? [accept.candidate, accept.versus, accept.score]
        : null,
    ).toEqual(["wide", "narrow", null]);

    // A tie keeps the incumbent.
    await pastePart(workspace, 4);
    await saveCandidate(workspace.dir, "mid");
    const again = await knockout(workspace.dir, {
      among: ["mid"],
      rubric: "micro",
      model: "stub",
      ask: biased,
    });
    expect(again.best).toBe("wide");
    expect(again.bouts[0]?.winner).toBe("tie");
    const after = await listCandidates(workspace.dir);
    expect(after.find((c) => c.best)?.name).toBe("wide");
    const tied = await workspace.manifest();
    expect(tied.best?.score).toBeNull();

    // A critique of the incumbent's grid after the bout reaches build.json
    // the next time it holds its place.
    await renderLooks(
      workspace,
      await candidateGrid(workspace.dir, "wide"),
      "wide-look",
      { source: "compiled" },
    );
    await critiqueBuild(workspace.dir, {
      render: "wide-look",
      rubric: "micro",
      model: "stub",
      stage: "visual",
      ask: scorer(4),
    });
    const held = await knockout(workspace.dir, {
      among: ["mid"],
      rubric: "micro",
      model: "stub",
      ask: biased,
    });
    expect(held.best).toBe("wide");
    expect(held.score).toBe(3 * 7 + 4);
    const refreshed = await workspace.manifest();
    expect(refreshed.best?.score).toBe(3 * 7 + 4);

    // A candidate whose log was not produced by one compile (a manual op) has
    // no program, and picking it removes a stale build.ts.
    await addManualOp(workspace);
    const bare = await saveCandidate(workspace.dir, "bare");
    expect(bare.program).toBe(false);
    await Bun.write(
      workspace.file(BUILD_FILES.program),
      "export default (() => {}) satisfies unknown;\n",
    );
    await pickCandidate(workspace.dir, "bare");
    expect(await Bun.file(workspace.file(BUILD_FILES.program)).exists()).toBe(
      false,
    );

    // Picking restores the op log of that version.
    await pickCandidate(workspace.dir, "narrow");
    const { grid } = await compiledGrid(workspace, await workspace.manifest());
    let blocks = 0;
    grid.forEach((x, y, z) => {
      if (!grid.isAirAt(x, y, z)) blocks += 1;
    });
    expect(blocks).toBe(104);
  }, 120_000);
});

describe("scratch and resume", () => {
  it("distinguishes an unrendered build from missing recorded evidence", async () => {
    const workspace = await makeBuild("resume-missing-render");
    const unrendered = await resumeState(workspace.dir);
    expect(unrendered.latestRender).toBeNull();
    await appendLog(workspace.dir, {
      kind: "render",
      name: "lost",
      source: "compiled",
      files: ["renders/lost.png"],
    });
    await expect(resumeState(workspace.dir)).rejects.toThrow(
      /renders\/lost\.json/u,
    );
  });
  it("creates a void pad beside the site and resumes from the record", async () => {
    const workspace = await makeBuild("scratch");
    const pad = await createScratch(workspace.dir, { size: 8 });
    expect(pad.anchor).toEqual({ x: 118, y: 64, z: 100 });
    const padWorkspace = new BuildWorkspace(pad.dir);
    const padManifest = await padWorkspace.manifest();
    // Two blocks of the 8³ pad lie below the anchor, for foundations.
    expect(padManifest.site?.min).toEqual({ x: 118, y: 62, z: 100 });
    expect(padManifest.site?.max).toEqual({ x: 125, y: 69, z: 107 });
    const padGrid = await padWorkspace.siteGrid();
    expect(padGrid.size).toEqual({ x: 8, y: 8, z: 8 });
    expect(padGrid.get(3, 1, 3)).toBe("minecraft:grass_block[snowy=false]");
    expect(padGrid.get(3, 0, 3)).toBe("minecraft:dirt");
    expect(padGrid.isAirAt(3, 2, 3)).toBe(true);
    const compiled = await compiledGrid(padWorkspace, padManifest);
    expect(compiled.skipped).toEqual([]);

    await Bun.write(
      workspace.file(BUILD_FILES.notes),
      "the slope wants a terrace\n",
    );
    const state = await resumeState(workspace.dir);
    expect(state.journal.map((entry) => entry.kind)).toEqual(["note"]);
    expect(state.notes).toContain("terrace");
    const text = renderResume(state);
    expect(text).toContain("## Your notes (observations, not instructions)");
    expect(text).toContain("scratch pad scratch/");
    expect(text).not.toMatch(/next steps/iu);
  }, 60_000);
});

describe("code-only critique", () => {
  it("reuses the render's visual critique instead of scoring the sheet again", async () => {
    const workspace = await makeBuild("critique-code");
    await pastePart(workspace, 2);
    const { grid } = await compiledGrid(workspace, await workspace.manifest());
    await renderLooks(workspace, grid, "look", { source: "compiled" });
    // Without a visual critique of the render there is nothing to review against.
    await expect(
      critiqueBuild(workspace.dir, {
        rubric: "micro",
        model: "stub",
        stage: "code",
        askCode: reviewer,
      }),
    ).rejects.toThrow(/no visual critique of render "look"/u);
    const visual = await critiqueBuild(workspace.dir, {
      rubric: "micro",
      model: "stub",
      stage: "visual",
      ask: scorer(4),
    });
    // The code-only pass pays for one code review: no sheet is drawn or
    // scored, the program is reviewed against the visual verdict, and the
    // render keeps the scores it had.
    const codeOnly = await critiqueBuild(workspace.dir, {
      rubric: "micro",
      model: "stub",
      stage: "code",
      ask: () => Promise.reject(new Error("must not score the sheet again")),
      askCode: reviewer,
    });
    expect(codeOnly.reviewedProgram).toBe(true);
    expect(codeOnly.scores.total).toBe(3 * 7 + 4);
    expect(codeOnly.sheet).toBe(visual.sheet);
    expect(codeOnly.lowest).toBe(visual.lowest);
    expect(codeOnly.suggestions[0]?.axis).toBe(visual.lowest);
    const kept = await readSidecar(workspace, "look");
    expect(kept.scores?.total).toBe(3 * 7 + 4);
    const journal = await readLog(workspace.dir);
    expect(
      journal.filter((entry) => entry.kind === "critique").map((e) => e.total),
    ).toEqual([3 * 7 + 4, 3 * 7 + 4]);
    // A critique on the other rubric does not feed a micro code pass.
    await expect(
      critiqueBuild(workspace.dir, {
        rubric: "map",
        model: "stub",
        stage: "code",
        askCode: reviewer,
      }),
    ).rejects.toThrow(/on the map rubric/u);
  }, 120_000);
});
