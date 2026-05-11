import { describe, expect, it } from "bun:test";
import {
  PASSES_PER_SPECIALIST,
  permuteFiles,
  type SliceableFileDiff,
} from "./diff-slicing.ts";

const FILES: SliceableFileDiff[] = [
  { path: "a.ts" },
  { path: "b.ts" },
  { path: "c.ts" },
  { path: "d.ts" },
  { path: "e.ts" },
];

describe("permuteFiles", () => {
  it("returns the input order unchanged for passId=0 (identity)", () => {
    const out = permuteFiles({
      files: FILES,
      specialistId: "correctness",
      passId: 0,
    });
    expect(out.map((f) => f.path)).toEqual([
      "a.ts",
      "b.ts",
      "c.ts",
      "d.ts",
      "e.ts",
    ]);
  });

  it("produces a stable permutation for the same (specialistId, passId)", () => {
    const first = permuteFiles({
      files: FILES,
      specialistId: "security",
      passId: 1,
    });
    const second = permuteFiles({
      files: FILES,
      specialistId: "security",
      passId: 1,
    });
    expect(first.map((f) => f.path)).toEqual(second.map((f) => f.path));
  });

  it("produces different permutations for different passIds within one specialist", () => {
    const p1 = permuteFiles({
      files: FILES,
      specialistId: "correctness",
      passId: 1,
    });
    const p2 = permuteFiles({
      files: FILES,
      specialistId: "correctness",
      passId: 2,
    });
    expect(p1.map((f) => f.path)).not.toEqual(p2.map((f) => f.path));
  });

  it("produces different permutations for different specialists at the same passId", () => {
    const correctness = permuteFiles({
      files: FILES,
      specialistId: "correctness",
      passId: 1,
    });
    const security = permuteFiles({
      files: FILES,
      specialistId: "security",
      passId: 1,
    });
    expect(correctness.map((f) => f.path)).not.toEqual(
      security.map((f) => f.path),
    );
  });

  it("returns a copy — does not mutate the input array", () => {
    const input = [...FILES];
    permuteFiles({ files: input, specialistId: "perf", passId: 2 });
    expect(input.map((f) => f.path)).toEqual([
      "a.ts",
      "b.ts",
      "c.ts",
      "d.ts",
      "e.ts",
    ]);
  });

  it("preserves the set of files (only the order changes)", () => {
    const out = permuteFiles({
      files: FILES,
      specialistId: "convention",
      passId: 2,
    });
    expect(out.length).toBe(FILES.length);
    expect(new Set(out.map((f) => f.path))).toEqual(
      new Set(FILES.map((f) => f.path)),
    );
  });

  it("handles empty input", () => {
    const out = permuteFiles({
      files: [],
      specialistId: "deps",
      passId: 5,
    });
    expect(out).toEqual([]);
  });

  it("handles a single-element input deterministically", () => {
    const out = permuteFiles({
      files: [{ path: "only.ts" }],
      specialistId: "deps",
      passId: 7,
    });
    expect(out.map((f) => f.path)).toEqual(["only.ts"]);
  });

  it("preserves generic type fields (not just path)", () => {
    type Rich = SliceableFileDiff & { extra: number };
    const rich: Rich[] = [
      { path: "a.ts", extra: 1 },
      { path: "b.ts", extra: 2 },
      { path: "c.ts", extra: 3 },
    ];
    const out = permuteFiles({
      files: rich,
      specialistId: "correctness",
      passId: 1,
    });
    expect(out.every((f) => typeof f.extra === "number")).toBe(true);
  });
});

describe("PASSES_PER_SPECIALIST", () => {
  it("matches the plan's N=3 randomized passes", () => {
    expect(PASSES_PER_SPECIALIST).toBe(3);
  });
});
