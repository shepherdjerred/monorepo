import { createHash } from "node:crypto";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { BlockGrid } from "@shepherdjerred/mc-build/core/grid.ts";
import { writeSchematic } from "@shepherdjerred/mc-build/core/schem.ts";
import { gridHash } from "@shepherdjerred/mc-build/core/site.ts";
import { loadRegistry } from "@shepherdjerred/mc-build/registry/registry.ts";
import { BuildWorkspace } from "#build/workspace.ts";
import {
  absoluteSchema,
  pairPrompt,
  PairVerdictSchema,
  judgeFingerprint,
  scoreFingerprint,
  judgePair,
  judgeRenders,
  resolveRender,
  rubricAxisIds,
  RUBRICS,
  scoreAbsolute,
  scoreRender,
  type AskJudge,
  type AskScore,
  type PairVerdict,
  type SheetRenderer,
} from "#build/judge.ts";
import { JudgeRecordSchema } from "#protocol/build.ts";

const A = { data: new Uint8Array([1]), mediaType: "image/png" as const };
const B = { data: new Uint8Array([2]), mediaType: "image/png" as const };

/** A stub judge that always prefers the image whose first byte is `prefer`. */
function stubJudge(prefer: number | "first"): AskJudge {
  return (first): Promise<PairVerdict> => {
    const firstWins = prefer === "first" || first.data[0] === prefer;
    return Promise.resolve({
      winner: firstWins ? "first" : "second",
      confidence: 0.8,
      reasons: ["the winner has more depth"],
    });
  };
}

const stubScorer: AskScore = () =>
  Promise.resolve({
    axes: Object.fromEntries(rubricAxisIds("micro").map((id) => [id, 3])),
    overallAesthetic: 2,
    notes: ["flat east wall (NORMAL)"],
  });

describe("judgePair", () => {
  it("keeps a winner both orderings agree on", async () => {
    const verdict = await judgePair(A, B, stubJudge(2), "stub");
    expect(verdict.winner).toBe("b");
    expect(verdict.agreed).toBe(true);
    expect(verdict.confidence).toBeCloseTo(0.8);
    expect(verdict.reasons).toEqual([
      "(a first) the winner has more depth",
      "(b first) the winner has more depth",
    ]);
  });

  it("calls a position-biased judge a tie", async () => {
    const verdict = await judgePair(A, B, stubJudge("first"), "stub");
    expect(verdict.winner).toBe("tie");
    expect(verdict.agreed).toBe(false);
    expect(verdict.confidence).toBe(0);
  });
});

describe("scoreAbsolute", () => {
  it("totals the axes but not the aesthetic question", async () => {
    const scores = await scoreAbsolute(A, stubScorer, {
      rubric: "micro",
      model: "stub",
    });
    expect(scores.total).toBe(24);
    expect(scores.max).toBe(40);
    expect(scores.overallAesthetic).toBe(2);
  });

  it("lists functional axes before look axes and validates 0–5", () => {
    expect(rubricAxisIds("micro")[0]).toBe("lighting");
    expect(rubricAxisIds("micro").at(-1)).toBe("silhouette");
    expect(rubricAxisIds("map").at(-2)).toBe("focalPoint");
    expect(RUBRICS.map.axes).toHaveLength(8);
    const schema = absoluteSchema("map");
    expect(
      schema.safeParse({
        axes: Object.fromEntries(rubricAxisIds("map").map((id) => [id, 6])),
        overallAesthetic: 1,
        notes: ["x"],
      }).success,
    ).toBe(false);
  });
});

/** A build directory whose frozen result is a 2³ stone cube, written as `build run` would. */
async function frozenBuild(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "judge-"));
  const blocks = Buffer.alloc(8 * 4);
  for (let index = 0; index < 8; index += 1) blocks.writeUInt32LE(1, index * 4);
  await writeFile(
    path.join(dir, "expected.json"),
    JSON.stringify({
      world: "world",
      min: { x: 0, y: 0, z: 0 },
      max: { x: 1, y: 1, z: 1 },
      size: { x: 2, y: 2, z: 2 },
      palette: ["minecraft:air", "minecraft:stone"],
      blocks: blocks.toString("base64"),
      blockEntities: [],
    }),
  );
  const workspace = new BuildWorkspace(dir);
  const grid = new BlockGrid({ x: 2, y: 2, z: 2 }, "minecraft:stone");
  await workspace.writeManifest({
    version: 1,
    name: "judge",
    world: "world",
    seed: 1,
    anchor: { x: 0, y: 0, z: 0 },
    site: {
      min: { x: 0, y: 0, z: 0 },
      max: { x: 1, y: 1, z: 1 },
      siteHash: gridHash(grid),
    },
  });
  const registry = await loadRegistry();
  await workspace.writeFrozen("expected", [
    {
      at: { x: 0, y: 0, z: 0 },
      bytes: writeSchematic(grid, registry.dataVersion),
    },
  ]);
  return dir;
}

/** Stands in for the judge-sheet renderer; the bytes say which rubric was asked for. */
const stubSheet: SheetRenderer = (_grid, rubric) =>
  Promise.resolve(new Uint8Array([rubric === "micro" ? 1 : 2]));

describe("resolveRender", () => {
  it("accepts a PNG as given and renders a build directory's frozen result as a judge sheet", async () => {
    const dir = await frozenBuild();
    let rendered = 0;
    const sheet: SheetRenderer = (grid, rubric) => {
      rendered += 1;
      expect(grid.size).toEqual({ x: 2, y: 2, z: 2 });
      return stubSheet(grid, rubric);
    };
    const first = await resolveRender(dir, { rubric: "map", sheet });
    expect(path.basename(first)).toMatch(
      /^sheet-map-[0-9a-f]{12}-[0-9a-f]{12}\.png$/u,
    );
    expect(new Uint8Array(await Bun.file(first).arrayBuffer())).toEqual(
      new Uint8Array([2]),
    );
    // The same grid, rubric and pixels name the same file; it is re-rendered
    // every time, and different pixels (a changed renderer) are a new file,
    // so an older record keeps the sheet it was judged on.
    expect(await resolveRender(dir, { rubric: "map", sheet })).toBe(first);
    expect(rendered).toBe(2);
    const changed = await resolveRender(dir, {
      rubric: "map",
      sheet: () => Promise.resolve(new Uint8Array([2, 2])),
    });
    expect(changed).not.toBe(first);
    expect(new Uint8Array(await Bun.file(first).arrayBuffer())).toEqual(
      new Uint8Array([2]),
    );
    const micro = await resolveRender(dir, { rubric: "micro", sheet });
    expect(micro).not.toBe(first);
    expect(rendered).toBe(3);

    const png = path.join(dir, "any.png");
    await writeFile(png, "x");
    expect(await resolveRender(png, { rubric: "micro" })).toBe(png);
    await expect(
      resolveRender(path.join(dir, "missing"), { rubric: "micro" }),
    ).rejects.toThrow();
    const unfrozen = await mkdtemp(path.join(tmpdir(), "judge-"));
    await expect(
      resolveRender(unfrozen, { rubric: "micro", sheet }),
    ).rejects.toThrow(/build run/u);
  });

  it("fingerprints the judge per rubric, over the whole answer contract", () => {
    expect(judgeFingerprint("micro")).toMatch(/^[0-9a-f]{12}$/u);
    expect(judgeFingerprint("micro")).not.toBe(judgeFingerprint("map"));
    expect(judgeFingerprint("micro")).toBe(judgeFingerprint("micro"));
    expect(scoreFingerprint("micro")).not.toBe(scoreFingerprint("map"));
    expect(scoreFingerprint("micro")).not.toBe(judgeFingerprint("micro"));
    const legacy = createHash("sha256")
      .update(pairPrompt("micro"))
      .update(JSON.stringify(z.toJSONSchema(PairVerdictSchema)))
      .digest("hex")
      .slice(0, 12);
    expect(judgeFingerprint("micro")).not.toBe(legacy);
  });
});

describe("persisted verdicts", () => {
  it("writes pair and absolute records under a build directory's judge/", async () => {
    const dir = await frozenBuild();
    const other = path.join(dir, "other.png");
    await writeFile(other, new Uint8Array([2]));

    const verdict = await judgeRenders(
      path.relative(process.cwd(), dir),
      other,
      {
        model: "stub",
        ask: stubJudge(2),
        sheet: stubSheet,
      },
    );
    expect(verdict.winner).toBe("b");
    expect(verdict.record).not.toBeNull();
    const scores = await scoreRender(dir, {
      model: "stub",
      rubric: "micro",
      ask: stubScorer,
      sheet: stubSheet,
    });
    expect(scores.record).not.toBeNull();
    const pngOnly = await scoreRender(other, {
      model: "stub",
      rubric: "micro",
      ask: stubScorer,
    });
    expect(pngOnly.record).toBeNull();

    const names = await readdir(path.join(dir, "judge"));
    const files = names.filter((name) => name.endsWith(".json")).toSorted();
    expect(files).toHaveLength(2);
    expect(names.filter((name) => name.endsWith(".png"))).toHaveLength(2);
    expect(path.dirname(verdict.renders.b)).toBe(path.join(dir, "judge"));
    expect(verdict.renders.b).not.toBe(other);
    await writeFile(other, new Uint8Array([9]));
    expect(await Bun.file(verdict.renders.b).bytes()).toEqual(
      new Uint8Array([2]),
    );
    await rm(other);
    expect(await Bun.file(verdict.renders.b).bytes()).toEqual(
      new Uint8Array([2]),
    );
    for (const file of files) {
      const record = JudgeRecordSchema.parse(
        JSON.parse(await Bun.file(path.join(dir, "judge", file)).text()),
      );
      expect(record.model).toBe("stub");
      if (record.kind === "pair") {
        expect(record.b).toBe(verdict.renders.b);
        expect(await Bun.file(record.b).bytes()).toEqual(new Uint8Array([2]));
      }
      if (record.kind === "critique")
        throw new Error("unexpected critique record in judge test");
      // Each record names the judge that produced it, so a changed prompt
      // never passes for the one that wrote the history.
      expect(record.judge).toBe(
        record.kind === "pair"
          ? judgeFingerprint("micro")
          : scoreFingerprint("micro"),
      );
    }
  });
});

describe("build CLI loading", () => {
  it("imports the judge lazily so other commands work without the built model catalog", async () => {
    const dir = path.join(import.meta.dirname, "..", "src", "build");
    for (const name of [
      "cli.ts",
      "studio/judge-commands.ts",
      "studio/candidate-commands.ts",
    ]) {
      const source = await Bun.file(path.join(dir, name)).text();
      expect(source).not.toMatch(
        /^import (?!type )[^;]*from "(#build|(?:\.{1,2}\/)*\.{1,2})\/judge\.ts";/mu,
      );
    }
    const commands = await Bun.file(
      path.join(dir, "studio", "judge-commands.ts"),
    ).text();
    expect(commands).toContain('await import("#build/judge.ts")');
  });
});
