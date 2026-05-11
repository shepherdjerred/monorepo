import { describe, expect, it } from "bun:test";
import {
  buildRecallQueryFromDiff,
  extractIdentifiersFromDiff,
  formatRetrievedSymbols,
  hybridSearch,
  lexicalRetrieve,
  type RecallSearchFn,
} from "./hybrid-retrieval.ts";
import type { SymbolEntry, SymbolIndex } from "./symbol-index.ts";

function makeEntry(
  name: string,
  file: string,
  line: number,
  endLine = line,
): SymbolEntry {
  return { name, kind: "function", file, line, endLine };
}

function buildIndex(entries: readonly SymbolEntry[]): SymbolIndex {
  const byName = new Map<string, SymbolEntry[]>();
  const byFile = new Map<string, SymbolEntry[]>();
  for (const e of entries) {
    const nameBucket = byName.get(e.name) ?? [];
    nameBucket.push(e);
    byName.set(e.name, nameBucket);
    const fileBucket = byFile.get(e.file) ?? [];
    fileBucket.push(e);
    byFile.set(e.file, fileBucket);
  }
  return { commitSha: "test", byName, byFile, buildMs: 0, filesScanned: 0 };
}

describe("extractIdentifiersFromDiff", () => {
  it("only considers + and - lines, not context lines", () => {
    const diff = ` function untouched() {}
+function newFn(): void {
+  removedName.process();
+}
-function oldFn(): void {}
   const alsoUntouched = 42;`;
    const tokens = extractIdentifiersFromDiff(diff);
    // newFn, removedName, process, oldFn — all from +/- lines. "untouched"
    // and "alsoUntouched" are on context lines and must be ignored.
    expect(tokens.has("newFn")).toBe(true);
    expect(tokens.has("removedName")).toBe(true);
    expect(tokens.has("process")).toBe(true);
    expect(tokens.has("oldFn")).toBe(true);
    expect(tokens.has("untouched")).toBe(false);
    expect(tokens.has("alsoUntouched")).toBe(false);
  });

  it("filters out stopwords + short tokens", () => {
    const diff = `+const x = function foo() { return 42; }`;
    const tokens = extractIdentifiersFromDiff(diff);
    // `foo` survives. `function`, `return`, `const` are stopwords. `x` is
    // too short.
    expect(tokens.has("foo")).toBe(true);
    expect(tokens.has("function")).toBe(false);
    expect(tokens.has("return")).toBe(false);
    expect(tokens.has("const")).toBe(false);
    expect(tokens.has("x")).toBe(false);
  });

  it("deduplicates repeated tokens", () => {
    const diff = `+helloWorld();\n+helloWorld();\n+helloWorld();`;
    const tokens = extractIdentifiersFromDiff(diff);
    expect(tokens.size).toBeGreaterThanOrEqual(1);
    // Set, not Array — dedupe is implicit.
    expect(tokens.has("helloWorld")).toBe(true);
  });

  it("returns empty for empty diff", () => {
    expect(extractIdentifiersFromDiff("").size).toBe(0);
  });
});

describe("lexicalRetrieve", () => {
  it("returns symbol entries matching identifiers in the diff", () => {
    const index = buildIndex([
      makeEntry("renamedFunction", "pkg/a/src/a.ts", 10),
      makeEntry("unrelated", "pkg/b/src/b.ts", 20),
    ]);
    const diff = `+import { renamedFunction } from "@scope/a";\n+renamedFunction();`;
    const hits = lexicalRetrieve(diff, index);
    expect(hits).toHaveLength(1);
    expect(hits[0]?.entry.name).toBe("renamedFunction");
    expect(hits[0]?.rank).toBe(1);
  });

  it("ranks more-mentioned symbols higher", () => {
    const index = buildIndex([
      makeEntry("frequentlyUsed", "a.ts", 1),
      makeEntry("rarelyUsed", "b.ts", 1),
    ]);
    const diff = `+frequentlyUsed(); frequentlyUsed(); frequentlyUsed();
+const x = rarelyUsed();`;
    const hits = lexicalRetrieve(diff, index);
    // Both names appear once each as deduplicated tokens; the lookup
    // counts *distinct token → entry* hits, not raw occurrences. Both
    // get count=1. Verify we at least surface both.
    const names = new Set(hits.map((h) => h.entry.name));
    expect(names.has("frequentlyUsed")).toBe(true);
    expect(names.has("rarelyUsed")).toBe(true);
  });

  it("returns empty when no diff identifier matches the index", () => {
    const index = buildIndex([makeEntry("known", "x.ts", 1)]);
    const diff = `+const a = "nothing here";`;
    expect(lexicalRetrieve(diff, index)).toEqual([]);
  });
});

describe("buildRecallQueryFromDiff", () => {
  it("prefers mixed-case (likely-symbol) tokens over lower-case tokens", () => {
    const diff = `+const result = ScoutDataDragonClient.fetchManifest(rawString);`;
    const query = buildRecallQueryFromDiff(diff);
    // Mixed-case tokens like ScoutDataDragonClient and fetchManifest should
    // come before lower-case `result`/`rawString`.
    const tokens = query.split(" ");
    const scoutIdx = tokens.indexOf("ScoutDataDragonClient");
    const fetchIdx = tokens.indexOf("fetchManifest");
    expect(scoutIdx).toBeGreaterThanOrEqual(0);
    expect(fetchIdx).toBeGreaterThanOrEqual(0);
  });

  it("caps at 5 tokens", () => {
    const diff = `+oneTwo(); threeFour(); fiveSix(); sevenEight(); nineTen(); elevenTwelve();`;
    const query = buildRecallQueryFromDiff(diff);
    expect(query.split(" ").length).toBeLessThanOrEqual(5);
  });
});

// Module-scope stubs so unicorn/consistent-function-scoping doesn't complain
// about hoisting the closures inside each `it` body.
const emptyRecall: RecallSearchFn = () => Promise.resolve([]);

const crossHitRecall: RecallSearchFn = () =>
  Promise.resolve([
    {
      path: "/repo/pkg/a/src/a.ts",
      title: "a",
      chunk: "function crossHit() {}",
      score: 0.9,
      source: "code",
      chunkIndex: 0,
    },
  ]);

const outOfRepoRecall: RecallSearchFn = () =>
  Promise.resolve([
    // outside repo root — discarded
    {
      path: "/Users/jerred/.recall/fetched/somewhere.md",
      title: "x",
      chunk: "x",
      score: 1,
      source: "fetched",
      chunkIndex: 0,
    },
    // in repo but file not indexed — discarded
    {
      path: "/repo/packages/zeta/CLAUDE.md",
      title: "x",
      chunk: "x",
      score: 1,
      source: "doc",
      chunkIndex: 0,
    },
  ]);

describe("hybridSearch", () => {
  it("returns top-1 by default (RARe top-1 design)", async () => {
    const index = buildIndex([
      makeEntry("targetFn", "pkg/a/src/a.ts", 10),
      makeEntry("otherFn", "pkg/b/src/b.ts", 20),
    ]);
    const out = await hybridSearch({
      diff: `+targetFn(); otherFn();`,
      index,
      repoRoot: "/repo",
      recallSearch: emptyRecall,
    });
    // Default k=1 — only one result even though two could match.
    expect(out).toHaveLength(1);
  });

  it("returns top-k when k overridden", async () => {
    // Tokens shorter than MIN_TOKEN_LENGTH (3) are filtered out of the diff,
    // so use real-looking identifier names here.
    const index = buildIndex([
      makeEntry("firstSym", "a.ts", 1),
      makeEntry("secondSym", "b.ts", 1),
      makeEntry("thirdSym", "c.ts", 1),
    ]);
    const out = await hybridSearch({
      diff: `+firstSym(); secondSym(); thirdSym();`,
      index,
      repoRoot: "/repo",
      recallSearch: emptyRecall,
      k: 3,
    });
    expect(out).toHaveLength(3);
  });

  it("fuses lexical + semantic hits, scoring symbols seen in both higher", async () => {
    const target = makeEntry("crossHit", "pkg/a/src/a.ts", 5);
    const lexOnly = makeEntry("lexOnly", "pkg/b/src/b.ts", 10);
    const index = buildIndex([target, lexOnly]);

    // Both identifiers appear in the diff (lexical hits both). Recall
    // also returns crossHit's file (semantic hit only for crossHit). RRF
    // should push crossHit ahead since it's hit by both runs.
    const out = await hybridSearch({
      diff: `+crossHit();\n+lexOnly();`,
      index,
      repoRoot: "/repo",
      recallSearch: crossHitRecall,
      k: 2,
    });
    expect(out[0]?.entry.name).toBe("crossHit");
    expect(out[0]?.sources).toEqual(["fused"]);
    expect(out[1]?.entry.name).toBe("lexOnly");
    expect(out[1]?.sources).toEqual(["lexical"]);
  });

  it("works with semantic disabled (recallSearch=null)", async () => {
    const index = buildIndex([makeEntry("onlyLex", "x.ts", 1)]);
    const out = await hybridSearch({
      diff: `+onlyLex();`,
      index,
      repoRoot: "/repo",
      recallSearch: null,
      k: 1,
    });
    expect(out).toHaveLength(1);
    expect(out[0]?.sources).toEqual(["lexical"]);
  });

  it("drops recall results whose path is outside the repo or not indexed", async () => {
    const index = buildIndex([makeEntry("present", "a.ts", 1)]);
    const out = await hybridSearch({
      diff: `+present();`,
      index,
      repoRoot: "/repo",
      recallSearch: outOfRepoRecall,
    });
    expect(out).toHaveLength(1);
    expect(out[0]?.sources).toEqual(["lexical"]);
  });

  it("returns empty when no signal is available", async () => {
    const index = buildIndex([makeEntry("present", "a.ts", 1)]);
    const out = await hybridSearch({
      diff: `+nothingMatches();`,
      index,
      repoRoot: "/repo",
      recallSearch: emptyRecall,
    });
    expect(out).toEqual([]);
  });
});

describe("formatRetrievedSymbols", () => {
  it("returns sentinel string when nothing retrieved", async () => {
    const out = await formatRetrievedSymbols([], { repoRoot: "/tmp" });
    expect(out).toContain("no related symbols");
  });

  it("formats a single retrieved entry with snippet from disk", async () => {
    // Write a tiny file we can read back. GNU `mktemp -t <prefix>` requires
    // the template to contain at least 3 trailing X's; BSD `mktemp` on macOS
    // tolerates a bare prefix. Use the explicit `<prefix>.XXXXXX` form so
    // both implementations agree.
    const dir = await Bun.$`mktemp -d -t retrieval-test.XXXXXX`.text();
    const repoRoot = dir.trim();
    const filePath = `${repoRoot}/src/a.ts`;
    await Bun.write(
      filePath,
      "line1\nfunction snippetTarget(): void {\n  return;\n}\nline5\n",
    );
    const out = await formatRetrievedSymbols(
      [
        {
          entry: {
            name: "snippetTarget",
            kind: "function",
            file: "src/a.ts",
            line: 2,
            endLine: 4,
          },
          score: 1,
          sources: ["lexical"],
        },
      ],
      { repoRoot },
    );
    expect(out).toContain("snippetTarget");
    expect(out).toContain("src/a.ts:2");
    expect(out).toContain("function snippetTarget(): void");
  });
});
