import { describe, expect, test } from "vitest";
import {
  buildBaseline,
  compareToBaseline,
  countByPair,
  evaluateBaseline,
  pairKey,
  parseReport,
  type Baseline,
  type Clone,
} from "./jscpd-check.ts";

type CloneOverrides = {
  firstRange?: string;
  secondRange?: string;
  tokens?: number;
};

function clone(
  firstFile: string,
  secondFile: string,
  overrides: CloneOverrides = {},
): Clone {
  return {
    pair: pairKey(firstFile, secondFile),
    tokens: overrides.tokens ?? 100,
    firstFile,
    firstRange: overrides.firstRange ?? "1-10",
    secondFile,
    secondRange: overrides.secondRange ?? "20-30",
  };
}

function baseline(
  pairs: Record<string, { clones: number; tokens: number }>,
): Baseline {
  return { pairs };
}

describe("pairKey", () => {
  test("is order-insensitive (sorted pair of paths)", () => {
    expect(pairKey("b.ts", "a.ts")).toBe("a.ts|b.ts");
    expect(pairKey("a.ts", "b.ts")).toBe("a.ts|b.ts");
  });
});

describe("parseReport", () => {
  test("relativizes absolute paths against the repo root and keys sorted pairs", () => {
    const report = {
      duplicates: [
        {
          tokens: 134,
          firstFile: {
            name: "/repo/packages/b/src/x.ts",
            startLoc: { line: 5, column: 1 },
            endLoc: { line: 25, column: 9 },
          },
          secondFile: {
            name: "/repo/packages/a/src/y.ts",
            startLoc: { line: 40, column: 2 },
            endLoc: { line: 60, column: 3 },
          },
        },
      ],
    };

    expect(parseReport(report, "/repo")).toEqual([
      {
        pair: "packages/a/src/y.ts|packages/b/src/x.ts",
        tokens: 134,
        firstFile: "packages/b/src/x.ts",
        firstRange: "5-25",
        secondFile: "packages/a/src/y.ts",
        secondRange: "40-60",
      },
    ]);
  });

  test("rejects a report without a duplicates array", () => {
    expect(() => parseReport({ statistics: {} }, "/repo")).toThrow();
  });
});

describe("compareToBaseline", () => {
  test("passes when current clones exactly match the baseline", () => {
    const clones = [clone("a.ts", "b.ts"), clone("a.ts", "b.ts")];
    expect(
      compareToBaseline(
        clones,
        baseline({ "a.ts|b.ts": { clones: 2, tokens: 200 } }),
      ),
    ).toEqual([]);
  });

  test("fails on a brand-new pair and names the file:line ranges and repo totals", () => {
    const clones = [
      clone("a.ts", "b.ts"),
      clone("c.ts", "d.ts", { firstRange: "3-9", secondRange: "7-13" }),
    ];
    const failures = compareToBaseline(
      clones,
      baseline({ "a.ts|b.ts": { clones: 1, tokens: 100 } }),
    );

    expect(failures[0]).toContain("new duplication between c.ts and d.ts");
    expect(failures[1]).toContain("c.ts:3-9");
    expect(failures[1]).toContain("d.ts:7-13");
    expect(failures[2]).toContain(
      "Repository totals: 2 clones (+1 vs baseline 1), 200 tokens (+100 vs baseline 100).",
    );
  });

  test("fails when an existing pair gains clones", () => {
    const clones = [clone("a.ts", "b.ts"), clone("a.ts", "b.ts")];
    const failures = compareToBaseline(
      clones,
      baseline({ "a.ts|b.ts": { clones: 1, tokens: 100 } }),
    );

    expect(failures[0]).toContain(
      "duplication increased for a.ts and b.ts (2 > 1 clones allowed)",
    );
    expect(failures.at(-1)).toContain(
      "Repository totals: 2 clones (+1 vs baseline 1)",
    );
  });

  test("fails on a count decrease and demands a baseline --update", () => {
    const failures = compareToBaseline(
      [clone("a.ts", "b.ts")],
      baseline({ "a.ts|b.ts": { clones: 2, tokens: 200 } }),
    );

    expect(failures).toHaveLength(2);
    expect(failures[0]).toContain("has 1 clone (100 tokens) but 2 allowed");
    expect(failures[0]).toContain("bun run jscpd --update");
    expect(failures[1]).toContain(
      "Repository totals: 1 clones (-1 vs baseline 2), 100 tokens (-100 vs baseline 200).",
    );
  });

  test("fails when a baselined pair disappears entirely", () => {
    const failures = compareToBaseline(
      [],
      baseline({ "a.ts|b.ts": { clones: 1, tokens: 100 } }),
    );

    expect(failures).toHaveLength(2);
    expect(failures[0]).toContain("has 0 clones (0 tokens) but 1 allowed");
    expect(failures[0]).toContain("bun run jscpd --update");
  });

  test("labels zero-net paired increase and decrease as likely clone re-attribution", () => {
    const pinned = baseline({
      "a.ts|a.ts": { clones: 2, tokens: 200 },
      "a.ts|b.ts": { clones: 1, tokens: 100 },
    });
    const reattributed = [
      clone("a.ts", "a.ts", { tokens: 100 }),
      clone("a.ts", "b.ts", { tokens: 100 }),
      clone("a.ts", "b.ts", { tokens: 100 }),
    ];

    const evaluation = evaluateBaseline(reattributed, pinned);
    expect(evaluation.likelyReattribution).toBe(true);
    expect(evaluation.baselineTotals).toEqual({ clones: 3, tokens: 300 });
    expect(evaluation.currentTotals).toEqual({ clones: 3, tokens: 300 });

    const text = evaluation.failures.join("\n");
    expect(text).toContain(
      "Repository totals: 3 clones (+0 vs baseline 3), 300 tokens (+0 vs baseline 300).",
    );
    expect(text).toContain("Likely clone re-attribution");
    expect(text).toContain(
      "update the drifted pair entries (`clones` and `tokens` together) in .jscpd-baseline.json",
    );
    expect(text).not.toContain("bun run jscpd --update");
  });

  test("does not label genuine net-new duplication as re-attribution even when another pair shrank", () => {
    const pinned = baseline({
      "a.ts|a.ts": { clones: 2, tokens: 200 },
      "a.ts|b.ts": { clones: 1, tokens: 100 },
    });
    const netIncrease = [
      clone("a.ts", "a.ts", { tokens: 100 }),
      clone("a.ts", "b.ts", { tokens: 100 }),
      clone("a.ts", "b.ts", { tokens: 100 }),
      clone("c.ts", "d.ts", { tokens: 150 }),
    ];

    const evaluation = evaluateBaseline(netIncrease, pinned);
    expect(evaluation.likelyReattribution).toBe(false);
    expect(evaluation.failures.join("\n")).toContain(
      "Repository totals: 4 clones (+1 vs baseline 3), 450 tokens (+150 vs baseline 300).",
    );
    expect(evaluation.failures.join("\n")).not.toContain(
      "Likely clone re-attribution",
    );
  });
});

describe("buildBaseline (--update)", () => {
  test("rewrites the baseline from the current scan with sorted keys", () => {
    const clones = [
      clone("z.ts", "y.ts"),
      clone("a.ts", "b.ts"),
      clone("a.ts", "b.ts"),
    ];
    const rebuilt = buildBaseline(clones);

    expect(Object.keys(rebuilt.pairs)).toEqual(["a.ts|b.ts", "y.ts|z.ts"]);
    expect(rebuilt.pairs).toEqual({
      "a.ts|b.ts": { clones: 2, tokens: 200 },
      "y.ts|z.ts": { clones: 1, tokens: 100 },
    });
    expect(rebuilt).toEqual({
      pairs: {
        "a.ts|b.ts": { clones: 2, tokens: 200 },
        "y.ts|z.ts": { clones: 1, tokens: 100 },
      },
    });

    // The rewritten baseline is exactly what a subsequent check passes on.
    expect(compareToBaseline(clones, rebuilt)).toEqual([]);
    expect(countByPair(clones).size).toBe(2);
  });
});

describe("duplicated size ratchet", () => {
  test("fails when one clone grows even though the count is unchanged", () => {
    // The exact hole a count-only baseline leaves: same pair, same single
    // clone, 70 tokens of duplication becomes 700.
    const before = [clone("a.ts", "b.ts", { tokens: 70 })];
    const grown = [
      clone("a.ts", "b.ts", {
        firstRange: "1-70",
        secondRange: "20-90",
        tokens: 700,
      }),
    ];
    const pinned = buildBaseline(before);

    expect(compareToBaseline(before, pinned)).toEqual([]);

    const failures = compareToBaseline(grown, pinned);
    expect(failures[0]).toContain(
      "duplicated size grew for a.ts and b.ts (700 > 70 tokens allowed)",
    );
  });

  test("fails when duplicated size shrinks, demanding a baseline update", () => {
    const pinned = baseline({ "a.ts|b.ts": { clones: 1, tokens: 700 } });
    const failures = compareToBaseline(
      [clone("a.ts", "b.ts", { tokens: 70 })],
      pinned,
    );

    expect(failures).toHaveLength(2);
    expect(failures[0]).toContain("has 70 duplicated tokens but 700 allowed");
    expect(failures[0]).toContain("bun run jscpd --update");
  });
});
