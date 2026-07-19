import { describe, expect, it } from "bun:test";
import {
  extractIdentifiersFromDiff,
  formatRetrievedSymbols,
  lexicalRetrieve,
  retrieveSymbols,
} from "./symbol-retrieval.ts";
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
    expect(hits[0]?.score).toBe(1);
  });

  it("scores symbols hit by more distinct identifiers higher", () => {
    // Register the same entry under two names (an alias) so two distinct
    // diff tokens resolve to it — that's what pushes count above 1.
    const shared = makeEntry("handleThing", "a.ts", 1);
    const index = buildIndex([shared, makeEntry("minorFn", "b.ts", 1)]);
    index.byName.set("thingHandler", [shared]);
    const diff = `+handleThing(); thingHandler(); minorFn();`;
    const hits = lexicalRetrieve(diff, index);
    expect(hits[0]?.entry.name).toBe("handleThing");
    expect(hits[0]?.score).toBe(2);
    expect(hits[1]?.entry.name).toBe("minorFn");
    expect(hits[1]?.score).toBe(1);
  });

  it("returns empty when no diff identifier matches the index", () => {
    const index = buildIndex([makeEntry("known", "x.ts", 1)]);
    const diff = `+const a = "nothing here";`;
    expect(lexicalRetrieve(diff, index)).toEqual([]);
  });
});

describe("retrieveSymbols", () => {
  it("returns top-1 by default (RARe top-1 design)", () => {
    const index = buildIndex([
      makeEntry("targetFn", "pkg/a/src/a.ts", 10),
      makeEntry("otherFn", "pkg/b/src/b.ts", 20),
    ]);
    const out = retrieveSymbols({
      diff: `+targetFn(); otherFn();`,
      index,
    });
    // Default k=1 — only one result even though two could match.
    expect(out).toHaveLength(1);
  });

  it("returns top-k when k overridden", () => {
    // Tokens shorter than MIN_TOKEN_LENGTH (3) are filtered out of the diff,
    // so use real-looking identifier names here.
    const index = buildIndex([
      makeEntry("firstSym", "a.ts", 1),
      makeEntry("secondSym", "b.ts", 1),
      makeEntry("thirdSym", "c.ts", 1),
    ]);
    const out = retrieveSymbols({
      diff: `+firstSym(); secondSym(); thirdSym();`,
      index,
      k: 3,
    });
    expect(out).toHaveLength(3);
  });

  it("returns empty when no signal is available", () => {
    const index = buildIndex([makeEntry("present", "a.ts", 1)]);
    const out = retrieveSymbols({
      diff: `+nothingMatches();`,
      index,
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
        },
      ],
      { repoRoot },
    );
    expect(out).toContain("snippetTarget");
    expect(out).toContain("src/a.ts:2");
    expect(out).toContain("function snippetTarget(): void");
  });
});
