import { describe, expect, test } from "vitest";

import {
  budgetOf,
  CEILING,
  directoryOf,
  findErrors,
  findWarnings,
  isCountedPath,
  reportedDirectories,
  tallyDirectories,
  TARGET,
  WARN_THRESHOLD,
} from "./check-directory-file-counts.ts";

/** `n` distinct paths directly inside `directory`. */
function filesIn(directory: string, count: number, suffix = ".ts"): string[] {
  return Array.from(
    { length: count },
    (_, index) => `${directory}/module-${index.toString()}${suffix}`,
  );
}

describe("the ratchet", () => {
  test("never sits below the permanent target", () => {
    expect(CEILING).toBeGreaterThanOrEqual(TARGET);
  });

  test("the advisory threshold is below the permanent target", () => {
    expect(WARN_THRESHOLD).toBeLessThan(TARGET);
  });
});

describe("isCountedPath", () => {
  test("counts every code extension in scope", () => {
    for (const extension of [
      "ts",
      "tsx",
      "js",
      "jsx",
      "mjs",
      "cjs",
      "rs",
      "go",
      "py",
      "swift",
      "cs",
      "astro",
    ]) {
      expect(isCountedPath(`packages/x/src/a.${extension}`)).toBe(true);
    }
  });

  test("ignores non-code files", () => {
    expect(isCountedPath("packages/x/src/data.json")).toBe(false);
    expect(isCountedPath("packages/x/README.md")).toBe(false);
    expect(isCountedPath("packages/x/run.sh")).toBe(false);
    expect(isCountedPath("packages/streambot/test/fixtures/a.dopus")).toBe(
      false,
    );
  });

  test("excludes sandbox, which is marked do-not-modify", () => {
    expect(isCountedPath("sandbox/archive/glance/a.ts")).toBe(false);
    expect(isCountedPath("sandbox/poc/b.ts")).toBe(false);
  });

  test("does not mistake a directory named sandbox elsewhere for the root one", () => {
    expect(isCountedPath("packages/x/sandbox/a.ts")).toBe(true);
  });

  test("is not fooled by an extension appearing mid-path", () => {
    expect(isCountedPath("packages/x.ts/notes.md")).toBe(false);
  });
});

describe("budgetOf", () => {
  test("routes colocated tests to the test budget", () => {
    expect(budgetOf("src/betting/settle.test.ts")).toBe("test");
    expect(budgetOf("src/betting/settle.spec.tsx")).toBe("test");
  });

  test("routes everything else to the source budget", () => {
    expect(budgetOf("src/betting/settle.ts")).toBe("source");
  });

  test("does not treat an integration test as a source file", () => {
    // `.integration.test.ts` still ends in `.test.ts`.
    expect(budgetOf("src/betting/settle.integration.test.ts")).toBe("test");
  });

  test("does not misread a module whose name merely contains 'test'", () => {
    expect(budgetOf("src/betting/test-fixtures.ts")).toBe("source");
    expect(budgetOf("src/betting/latest.ts")).toBe("source");
  });
});

describe("directoryOf", () => {
  test("returns the immediate parent", () => {
    expect(directoryOf("packages/x/src/a.ts")).toBe("packages/x/src");
  });

  test("maps repository-root files to '.'", () => {
    expect(directoryOf("eslint.config.ts")).toBe(".");
  });
});

describe("tallyDirectories", () => {
  test("keeps the two budgets independent", () => {
    const tallies = tallyDirectories([
      ...filesIn("src/betting", 30),
      ...filesIn("src/betting", 40, ".test.ts"),
    ]);
    expect(tallies.get("src/betting")).toEqual({
      directory: "src/betting",
      source: 30,
      test: 40,
    });
  });

  test("counts direct children only, not descendants", () => {
    const tallies = tallyDirectories([
      "src/betting/a.ts",
      "src/betting/dares/b.ts",
      "src/betting/dares/c.ts",
    ]);
    expect(tallies.get("src/betting")?.source).toBe(1);
    expect(tallies.get("src/betting/dares")?.source).toBe(2);
  });

  test("omits directories holding no code files", () => {
    expect(tallyDirectories(["docs/guide.md"]).size).toBe(0);
  });
});

describe("findErrors", () => {
  test("fails a directory over the ceiling", () => {
    const tallies = tallyDirectories(filesIn("src/betting", CEILING + 1));
    expect(findErrors(tallies.values())).toEqual([
      { directory: "src/betting", budget: "source", count: CEILING + 1 },
    ]);
  });

  test("passes a directory exactly at the ceiling", () => {
    const tallies = tallyDirectories(filesIn("src/betting", CEILING));
    expect(findErrors(tallies.values())).toEqual([]);
  });

  test("fails on the test budget alone", () => {
    const tallies = tallyDirectories([
      ...filesIn("test", 2),
      ...filesIn("test", CEILING + 1, ".test.ts"),
    ]);
    expect(findErrors(tallies.values())).toEqual([
      { directory: "test", budget: "test", count: CEILING + 1 },
    ]);
  });

  test("a directory at the ceiling in both budgets still passes", () => {
    const tallies = tallyDirectories([
      ...filesIn("src/betting", CEILING),
      ...filesIn("src/betting", CEILING, ".test.ts"),
    ]);
    expect(findErrors(tallies.values())).toEqual([]);
  });

  test("reports the worst offender first", () => {
    const tallies = tallyDirectories([
      ...filesIn("src/small", CEILING + 1),
      ...filesIn("src/big", CEILING + 90),
    ]);
    expect(findErrors(tallies.values()).map((v) => v.directory)).toEqual([
      "src/big",
      "src/small",
    ]);
  });

  test("honours an explicit lower ceiling, which is how the ratchet tightens", () => {
    const tallies = tallyDirectories(filesIn("src/betting", TARGET + 1));
    expect(findErrors(tallies.values(), TARGET)).toHaveLength(1);
    expect(findErrors(tallies.values(), TARGET + 1)).toEqual([]);
  });
});

describe("findWarnings", () => {
  test("advises above the threshold but below the ceiling", () => {
    const tallies = tallyDirectories(filesIn("src/x", WARN_THRESHOLD + 1));
    expect(findWarnings(tallies.values())).toEqual([
      {
        directory: "src/x",
        budget: "source",
        count: WARN_THRESHOLD + 1,
      },
    ]);
  });

  test("stays silent at the threshold", () => {
    const tallies = tallyDirectories(filesIn("src/x", WARN_THRESHOLD));
    expect(findWarnings(tallies.values())).toEqual([]);
  });

  test("does not also warn about something already erroring", () => {
    const tallies = tallyDirectories(filesIn("src/x", CEILING + 1));
    expect(findWarnings(tallies.values())).toEqual([]);
    expect(findErrors(tallies.values())).toHaveLength(1);
  });
});

describe("reportedDirectories — staged-file scoping", () => {
  test("returns undefined for a full-repository run", () => {
    expect(reportedDirectories(undefined)).toBeUndefined();
    expect(reportedDirectories([])).toBeUndefined();
  });

  test("selects the directories the staged files live in", () => {
    expect([
      ...(reportedDirectories([
        "src/betting/a.ts",
        "src/betting/b.ts",
        "src/reports/c.ts",
      ]) ?? []),
    ]).toEqual(["src/betting", "src/reports"]);
  });

  test("ignores staged files that carry no budget", () => {
    expect([...(reportedDirectories(["docs/guide.md"]) ?? [])]).toEqual([]);
  });

  /**
   * The defect this check exists to avoid: scoping by staged files must select
   * directories, never supply the counts. Counting the staged files themselves
   * would report `1` for a single file added to an over-limit directory.
   */
  test("staging one file into an over-limit directory still fails", () => {
    const staged = ["src/betting/newly-added.ts"];
    const selected = reportedDirectories(staged);
    expect(selected?.has("src/betting")).toBe(true);

    // Counts come from the directory's full contents, not from `staged`.
    const wholeRepository = [
      ...filesIn("src/betting", CEILING + 1),
      ...staged,
      ...filesIn("src/elsewhere", 3),
    ];
    const tallies = [...tallyDirectories(wholeRepository).values()].filter(
      (tally) => selected?.has(tally.directory) ?? true,
    );

    expect(findErrors(tallies)).toHaveLength(1);
    // Had the counts come from `staged`, this would have been 1 and passed.
    expect(findErrors(tallies)[0]?.count).toBeGreaterThan(CEILING);
  });

  test("an unrelated over-limit directory is not reported in staged mode", () => {
    const selected = reportedDirectories(["src/elsewhere/a.ts"]);
    const tallies = [
      ...tallyDirectories([
        ...filesIn("src/betting", CEILING + 1),
        ...filesIn("src/elsewhere", 3),
      ]).values(),
    ].filter((tally) => selected?.has(tally.directory) ?? true);

    expect(findErrors(tallies)).toEqual([]);
  });
});
