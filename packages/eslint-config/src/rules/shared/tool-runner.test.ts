import { describe, expect, it } from "bun:test";
import { resolve } from "node:path";
import { parseKnipOutput } from "./tool-runner.ts";

const ROOT = "/repo";

/**
 * Knip 6's `--reporter json` shape. This is the exact structure the
 * knip-unused rule depends on: a top-level `issues` array of per-file rows,
 * where an UNUSED FILE is a row whose per-issue `files` array is non-empty
 * (knip 6 dropped the old top-level `files` array), and unused exports live
 * in the per-row `exports` array. These fixtures pin the shape so a knip
 * upgrade that changes it fails loudly here instead of silently disabling
 * the rule (which is what happened with the knip 5 → 6 upgrade).
 */
function knip6Json(issues: unknown[]): string {
  return JSON.stringify({ issues });
}

describe("parseKnipOutput (knip 6 shape)", () => {
  it("treats a row with a non-empty files array as an unused file", () => {
    const output = knip6Json([
      {
        file: "packages/temporal/src/shared/json.ts",
        exports: [],
        files: [{ name: "packages/temporal/src/shared/json.ts" }],
      },
    ]);

    const results = parseKnipOutput(output, ROOT);
    const entry = results.get(
      resolve(ROOT, "packages/temporal/src/shared/json.ts"),
    );

    expect(entry).toBeDefined();
    expect(entry?.isUnusedFile).toBe(true);
    expect(entry?.unusedExports).toEqual([]);
  });

  it("collects unused exports with their locations", () => {
    const output = knip6Json([
      {
        file: "packages/temporal/src/a.ts",
        files: [],
        exports: [
          { name: "deadExport", line: 12, col: 3, pos: 100 },
          { name: "otherDead", line: 20, col: 1, pos: 200 },
        ],
      },
    ]);

    const results = parseKnipOutput(output, ROOT);
    const entry = results.get(resolve(ROOT, "packages/temporal/src/a.ts"));

    expect(entry?.isUnusedFile).toBe(false);
    expect(entry?.unusedExports).toEqual([
      { symbol: "deadExport", line: 12, col: 3 },
      { symbol: "otherDead", line: 20, col: 1 },
    ]);
  });

  it("resolves file paths relative to the given base path", () => {
    const output = knip6Json([
      {
        file: "packages/scout-for-lol/packages/app/src/x.ts",
        files: [],
        exports: [{ name: "unusedThing", line: 1, col: 1, pos: 0 }],
      },
    ]);

    const results = parseKnipOutput(output, ROOT);

    expect([...results.keys()]).toEqual([
      resolve(ROOT, "packages/scout-for-lol/packages/app/src/x.ts"),
    ]);
  });

  it("returns an empty map when there are no issues", () => {
    expect(parseKnipOutput(knip6Json([]), ROOT).size).toBe(0);
  });

  it("returns an empty map for the pre-6 shape (top-level files, no issues)", () => {
    // Regression guard: the knip 5 shape had a top-level `files` array and no
    // `issues`. The old parser threw on knip 6 because it iterated a missing
    // top-level `files`; the new parser must degrade to "no findings" for any
    // shape it doesn't recognize rather than throwing.
    const legacy = JSON.stringify({ files: ["a.ts", "b.ts"] });
    expect(parseKnipOutput(legacy, ROOT).size).toBe(0);
  });

  it("ignores malformed export entries but keeps well-formed ones", () => {
    const output = knip6Json([
      {
        file: "packages/temporal/src/b.ts",
        files: [],
        exports: [
          { name: "good", line: 5, col: 2, pos: 0 },
          { line: 9, col: 1 },
          "not-an-object",
          null,
        ],
      },
    ]);

    const results = parseKnipOutput(output, ROOT);
    const entry = results.get(resolve(ROOT, "packages/temporal/src/b.ts"));

    expect(entry?.unusedExports).toEqual([{ symbol: "good", line: 5, col: 2 }]);
  });

  it("merges rows that share the same file (unused file + exports)", () => {
    const output = knip6Json([
      {
        file: "packages/temporal/src/c.ts",
        files: [],
        exports: [{ name: "e1", line: 1, col: 1, pos: 0 }],
      },
      {
        file: "packages/temporal/src/c.ts",
        files: [{ name: "packages/temporal/src/c.ts" }],
        exports: [{ name: "e2", line: 2, col: 1, pos: 0 }],
      },
    ]);

    const results = parseKnipOutput(output, ROOT);
    const entry = results.get(resolve(ROOT, "packages/temporal/src/c.ts"));

    expect(entry?.isUnusedFile).toBe(true);
    expect(entry?.unusedExports).toEqual([
      { symbol: "e1", line: 1, col: 1 },
      { symbol: "e2", line: 2, col: 1 },
    ]);
  });
});
