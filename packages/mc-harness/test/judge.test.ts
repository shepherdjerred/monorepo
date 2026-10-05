import { mkdir, mkdtemp, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  judgePair,
  resolveRender,
  type AskJudge,
  type DimensionScores,
  type ModelVerdict,
} from "#build/judge.ts";

const A = { data: new Uint8Array([1]), mediaType: "image/png" as const };
const B = { data: new Uint8Array([2]), mediaType: "image/png" as const };

function scores(value: 0 | 1 | 2): DimensionScores {
  return {
    silhouette: value,
    depth: value,
    palette: value,
    texture: value,
    proportion: value,
    detail: value,
    siteFit: value,
    lighting: value,
  };
}

/** A stub judge that always prefers the image whose first byte is `prefer`. */
function stubJudge(prefer: number | "first"): AskJudge {
  return (first): Promise<ModelVerdict> => {
    const firstWins = prefer === "first" || first.data[0] === prefer;
    return Promise.resolve({
      winner: firstWins ? "first" : "second",
      confidence: 0.8,
      first: scores(firstWins ? 2 : 1),
      second: scores(firstWins ? 1 : 2),
      critique: ["the winner has more depth"],
    });
  };
}

describe("judgePair", () => {
  it("keeps a winner both orderings agree on", async () => {
    const verdict = await judgePair(A, B, stubJudge(2), "stub");
    expect(verdict.winner).toBe("b");
    expect(verdict.agreed).toBe(true);
    expect(verdict.confidence).toBeCloseTo(0.8);
    expect(verdict.totals).toEqual({ a: 8, b: 16 });
    expect(verdict.critique).toHaveLength(2);
  });

  it("calls a position-biased judge a tie", async () => {
    const verdict = await judgePair(A, B, stubJudge("first"), "stub");
    expect(verdict.winner).toBe("tie");
    expect(verdict.agreed).toBe(false);
    expect(verdict.confidence).toBe(0);
  });
});

describe("resolveRender", () => {
  it("accepts a PNG and picks a build directory's newest render", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "judge-"));
    const renders = path.join(dir, "renders");
    await mkdir(renders);
    const older = path.join(renders, "site.png");
    const newer = path.join(renders, "iter-2.png");
    await writeFile(older, "x");
    await writeFile(newer, "y");
    await utimes(older, new Date(1000), new Date(1000));
    await utimes(newer, new Date(2000), new Date(2000));
    expect(await resolveRender(dir)).toBe(newer);
    expect(await resolveRender(older)).toBe(older);
    await expect(resolveRender(path.join(dir, "missing"))).rejects.toThrow();
  });
});

describe("build CLI loading", () => {
  it("imports the judge lazily so other commands work without the built model catalog", async () => {
    const source = await Bun.file(
      path.join(import.meta.dir, "..", "src", "build", "cli.ts"),
    ).text();
    expect(source).not.toMatch(/^import (?!type )[^;]*from "\.\/judge\.ts";/mu);
    expect(source).toContain('await import("./judge.ts")');
  });
});
