import { describe, expect, it } from "bun:test";
import {
  computeFileBlockDiff,
  extractTopLevelBlocks,
  formatBlockDiff,
  parsePatchHunks,
  type FileBlockDiff,
} from "./block-diff.ts";

describe("parsePatchHunks", () => {
  it("returns an empty array for an empty patch", () => {
    expect(parsePatchHunks("")).toEqual([]);
  });

  it("parses a single hunk with the standard header form", () => {
    const patch = `@@ -1,3 +1,4 @@\n const a = 1;\n+const b = 2;\n const c = 3;\n const d = 4;`;
    const hunks = parsePatchHunks(patch);
    expect(hunks).toHaveLength(1);
    expect(hunks[0]?.newStart).toBe(1);
    expect(hunks[0]?.newCount).toBe(4);
    expect(hunks[0]?.addedLines).toBe(1);
    expect(hunks[0]?.removedLines).toBe(0);
  });

  it("counts both + and - lines and treats the header line itself as neither", () => {
    const patch = `@@ -1,3 +1,3 @@\n-const a = 1;\n+const a = 2;\n const b = 3;\n const c = 4;`;
    const hunks = parsePatchHunks(patch);
    expect(hunks[0]?.addedLines).toBe(1);
    expect(hunks[0]?.removedLines).toBe(1);
  });

  it("handles single-line hunks without explicit counts (`@@ -3 +5 @@`)", () => {
    const patch = `@@ -3 +5 @@\n+only this`;
    const hunks = parsePatchHunks(patch);
    expect(hunks[0]?.newStart).toBe(5);
    expect(hunks[0]?.newCount).toBe(1);
    expect(hunks[0]?.addedLines).toBe(1);
  });

  it("parses multiple hunks in the same patch", () => {
    const patch = `@@ -1,2 +1,2 @@\n a\n+b\n@@ -10,1 +20,2 @@\n c\n+d`;
    const hunks = parsePatchHunks(patch);
    expect(hunks).toHaveLength(2);
    expect(hunks[0]?.newStart).toBe(1);
    expect(hunks[1]?.newStart).toBe(20);
  });

  it("ignores +++/--- file-header lines so they don't bump addedLines", () => {
    const patch = `--- a/foo.ts\n+++ b/foo.ts\n@@ -1,1 +1,2 @@\n a\n+b`;
    const hunks = parsePatchHunks(patch);
    expect(hunks[0]?.addedLines).toBe(1);
  });
});

describe("extractTopLevelBlocks", () => {
  it("extracts TS function and class declarations with their line ranges", async () => {
    const source = `function foo() {\n  return 1;\n}\n\nclass Bar {\n  baz() { return 2; }\n}\n`;
    const blocks = await extractTopLevelBlocks({
      source,
      language: "typescript",
    });
    expect(blocks).toHaveLength(2);
    const names = blocks.map((b) => b.name);
    expect(names).toContain("foo");
    expect(names).toContain("Bar");
    const bar = blocks.find((b) => b.name === "Bar");
    expect(bar?.subBlocks.map((s) => s.name)).toContain("baz");
  });

  it("extracts Rust function_item / struct_item / trait_item", async () => {
    const source = `fn alpha() { let x = 1; }\n\nstruct Beta { f: i32 }\n\ntrait Gamma { fn op(&self); }\n`;
    const blocks = await extractTopLevelBlocks({ source, language: "rust" });
    const names = blocks.map((b) => b.name);
    expect(names).toContain("alpha");
    expect(names).toContain("Beta");
    expect(names).toContain("Gamma");
  });

  it("extracts Go top-level function_declaration and method_declaration", async () => {
    const source = `package x\n\nfunc Foo() int { return 1 }\n\nfunc (r *R) Bar() {}\n`;
    const blocks = await extractTopLevelBlocks({ source, language: "go" });
    const names = blocks.map((b) => b.name);
    expect(names).toContain("Foo");
    expect(names).toContain("Bar");
  });

  it("extracts Java class_declaration with its method sub-blocks", async () => {
    const source = `class Hello {\n  void greet() {}\n  int compute(int x) { return x; }\n}\n`;
    const blocks = await extractTopLevelBlocks({ source, language: "java" });
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.name).toBe("Hello");
    const subs = blocks[0]?.subBlocks.map((s) => s.name) ?? [];
    expect(subs).toContain("greet");
    expect(subs).toContain("compute");
  });

  it("sorts blocks by ascending start line", async () => {
    const source = `class Z {}\nclass A {}\nfunction m() {}\n`;
    const blocks = await extractTopLevelBlocks({
      source,
      language: "typescript",
    });
    const starts = blocks.map((b) => b.startLine);
    const sorted = [...starts].toSorted((a, b) => a - b);
    expect(starts).toEqual(sorted);
  });
});

describe("computeFileBlockDiff", () => {
  it("maps a single-line change inside a function to that function's block", async () => {
    // foo() is on lines 1-3; the change is on line 2.
    const newSource = `function foo() {\n  return 42;\n}\n`;
    const patch = `@@ -1,3 +1,3 @@\n function foo() {\n-  return 1;\n+  return 42;\n }`;
    const diff = await computeFileBlockDiff({
      filePath: "src/a.ts",
      newSource,
      patch,
    });
    expect(diff.language).toBe("typescript");
    expect(diff.blocks).toHaveLength(1);
    expect(diff.blocks[0]?.name).toBe("foo");
    expect(diff.blocks[0]?.edit).toBe("modified");
    expect(diff.blocks[0]?.addedLines).toBe(1);
    expect(diff.blocks[0]?.removedLines).toBe(1);
    expect(diff.orphanHunks).toEqual([]);
  });

  it("classifies a brand-new function (hunk fully covers block range) as added", async () => {
    const newSource = `function added() {\n  return "new";\n}\n`;
    // Hunk spans lines 1-3 entirely with `+` lines -> block is fully inside an addition.
    const patch = `@@ -0,0 +1,3 @@\n+function added() {\n+  return "new";\n+}`;
    const diff = await computeFileBlockDiff({
      filePath: "src/a.ts",
      newSource,
      patch,
    });
    expect(diff.blocks).toHaveLength(1);
    expect(diff.blocks[0]?.edit).toBe("added");
    expect(diff.blocks[0]?.removedLines).toBe(0);
  });

  it("surfaces a modified method as a sub-block of its enclosing class", async () => {
    // Layout (1-indexed):
    //  1: class Foo {
    //  2:   bar() {
    //  3:     return 2;
    //  4:   }
    //  5:   // gap to keep bar's `}` away from baz's hunk
    //  6:   // gap
    //  7:   baz() {
    //  8:     return 3;
    //  9:   }
    // 10: }
    const newSource = `class Foo {\n  bar() {\n    return 2;\n  }\n  // gap\n  // gap\n  baz() {\n    return 3;\n  }\n}\n`;
    // Touch only the `return 3;` line on line 8 — inside baz (7-9), outside bar (2-4).
    const patch = `@@ -8,1 +8,1 @@\n-    return 0;\n+    return 3;`;
    const diff = await computeFileBlockDiff({
      filePath: "src/a.ts",
      newSource,
      patch,
    });
    expect(diff.blocks).toHaveLength(1);
    const cls = diff.blocks[0];
    expect(cls?.name).toBe("Foo");
    const subs = cls?.modifiedSubBlocks ?? [];
    expect(subs.map((s) => s.name)).toContain("baz");
    expect(subs.find((s) => s.name === "baz")?.edit).toBe("modified");
    expect(subs.find((s) => s.name === "bar")).toBeUndefined();
  });

  it("falls back to lineFallback for unsupported languages (Python)", async () => {
    const diff = await computeFileBlockDiff({
      filePath: "scripts/x.py",
      newSource: "def foo(): pass\n",
      patch: `@@ -0,0 +1,1 @@\n+def foo(): pass`,
    });
    expect(diff.language).toBeNull();
    expect(diff.blocks).toEqual([]);
    expect(diff.lineFallback).toContain("def foo(): pass");
  });

  it("returns orphanHunks for top-level changes (imports, exports)", async () => {
    // Block `foo` is at L4-6; the import on L1 is orphaned.
    const newSource = `import { X } from "y";\n\n\nfunction foo() {\n  return 1;\n}\n`;
    const patch = `@@ -1,0 +1,1 @@\n+import { X } from "y";`;
    const diff = await computeFileBlockDiff({
      filePath: "src/a.ts",
      newSource,
      patch,
    });
    expect(diff.orphanHunks).toHaveLength(1);
    // foo is unchanged, so blocks is empty.
    expect(diff.blocks).toEqual([]);
  });

  it("degrades to lineFallback when newSource exceeds the 256KB ceiling", async () => {
    const huge = "function foo() {}\n" + "// pad\n".repeat(60_000);
    const diff = await computeFileBlockDiff({
      filePath: "src/huge.ts",
      newSource: huge,
      patch: `@@ -1,1 +1,1 @@\n-old\n+new`,
    });
    expect(diff.language).toBe("typescript");
    expect(diff.blocks).toEqual([]);
    expect(diff.lineFallback).toContain("+new");
  });
});

describe("formatBlockDiff", () => {
  it("renders the raw patch for line-fallback diffs (unsupported language)", () => {
    const diff: FileBlockDiff = {
      file: "x.py",
      language: null,
      blocks: [],
      orphanHunks: [],
      lineFallback: "@@ -1 +1 @@\n-a\n+b",
    };
    const text = formatBlockDiff(diff);
    expect(text).toContain("```diff");
    expect(text).toContain("+b");
  });

  it("renders a 'no structural changes' placeholder when both lists are empty", () => {
    const diff: FileBlockDiff = {
      file: "x.ts",
      language: "typescript",
      blocks: [],
      orphanHunks: [],
      lineFallback: null,
    };
    expect(formatBlockDiff(diff)).toContain("no structural changes");
  });

  it("renders modified blocks with their sub-blocks indented underneath", () => {
    const diff: FileBlockDiff = {
      file: "x.ts",
      language: "typescript",
      blocks: [
        {
          kind: "class",
          name: "Foo",
          range: { startLine: 1, endLine: 10 },
          edit: "modified",
          addedLines: 3,
          removedLines: 1,
          modifiedSubBlocks: [
            {
              kind: "method",
              name: "baz",
              range: { startLine: 5, endLine: 8 },
              edit: "modified",
              addedLines: 2,
              removedLines: 1,
            },
          ],
        },
      ],
      orphanHunks: [],
      lineFallback: null,
    };
    const text = formatBlockDiff(diff);
    expect(text).toContain("`Foo` (class) — modified");
    expect(text).toContain("  - sub: `baz` (method) — modified");
  });

  it("renders orphan hunks under their own header", () => {
    const diff: FileBlockDiff = {
      file: "x.ts",
      language: "typescript",
      blocks: [],
      orphanHunks: [
        { newStart: 1, newCount: 1, addedLines: 1, removedLines: 0 },
      ],
      lineFallback: null,
    };
    const text = formatBlockDiff(diff);
    expect(text).toContain("Top-level changes");
    expect(text).toContain("L1-1 (+1 / -0)");
  });
});

describe("performance: 500-line PR under 500ms", () => {
  it("processes a ~500-line TS file with 50 functions in <500ms", async () => {
    // Each function below is 11 lines (header + 8 body + return + closing
    // brace) for a 550-line source — comfortably above the 500-line target.
    const LINES_PER_FN = 11;
    const FN_COUNT = 50;
    const lines: string[] = [];
    for (let i = 0; i < FN_COUNT; i += 1) {
      lines.push(`function fn${String(i)}() {`);
      for (let j = 0; j < 8; j += 1) {
        lines.push(`  const v${String(j)} = ${String(j)};`);
      }
      lines.push(`  return 0;`);
      lines.push(`}`);
    }
    const newSource = lines.join("\n");
    // Patch the 2nd line of every function so each block reads as modified.
    const patchLines: string[] = [];
    for (let i = 0; i < FN_COUNT; i += 1) {
      const newStart = i * LINES_PER_FN + 2;
      patchLines.push(`@@ -${String(newStart)},1 +${String(newStart)},1 @@`);
      patchLines.push(`-  const v0 = 0;`);
      patchLines.push(`+  const v0 = 1;`);
    }
    const patch = patchLines.join("\n");
    const start = performance.now();
    const diff = await computeFileBlockDiff({
      filePath: "src/big.ts",
      newSource,
      patch,
    });
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(500);
    expect(diff.blocks.length).toBe(FN_COUNT);
    expect(diff.blocks.every((b) => b.edit === "modified")).toBe(true);
  });
});
