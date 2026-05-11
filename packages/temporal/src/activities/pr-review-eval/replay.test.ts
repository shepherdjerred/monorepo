import { describe, expect, it } from "bun:test";
import { parseUnifiedDiff } from "./replay.ts";

describe("parseUnifiedDiff", () => {
  it("parses a single-file modification diff", () => {
    const diff = [
      "diff --git a/src/foo.ts b/src/foo.ts",
      "index 1234..5678 100644",
      "--- a/src/foo.ts",
      "+++ b/src/foo.ts",
      "@@ -10,3 +10,4 @@",
      " context line",
      "-removed line",
      "+added line A",
      "+added line B",
      "",
    ].join("\n");
    const files = parseUnifiedDiff(diff);
    expect(files).toHaveLength(1);
    const file = files[0];
    expect(file?.path).toBe("src/foo.ts");
    expect(file?.status).toBe("modified");
    expect(file?.additions).toBe(2);
    expect(file?.deletions).toBe(1);
  });

  it("parses multi-file diffs by splitting on `diff --git`", () => {
    const diff = [
      "diff --git a/a.ts b/a.ts",
      "index 1..2 100644",
      "--- a/a.ts",
      "+++ b/a.ts",
      "@@ -1 +1 @@",
      "-old",
      "+new",
      "diff --git a/b.ts b/b.ts",
      "index 3..4 100644",
      "--- a/b.ts",
      "+++ b/b.ts",
      "@@ -1 +1 @@",
      "-old2",
      "+new2",
      "",
    ].join("\n");
    const files = parseUnifiedDiff(diff);
    expect(files).toHaveLength(2);
    expect(files.map((f) => f.path).toSorted()).toEqual(["a.ts", "b.ts"]);
  });

  it("detects added files via 'new file mode' header", () => {
    const diff = [
      "diff --git a/src/new.ts b/src/new.ts",
      "new file mode 100644",
      "index 0000..abcd",
      "--- /dev/null",
      "+++ b/src/new.ts",
      "@@ -0,0 +1,2 @@",
      "+line 1",
      "+line 2",
      "",
    ].join("\n");
    const files = parseUnifiedDiff(diff);
    expect(files[0]?.status).toBe("added");
  });

  it("detects removed files via 'deleted file mode' header", () => {
    const diff = [
      "diff --git a/src/gone.ts b/src/gone.ts",
      "deleted file mode 100644",
      "index abcd..0000",
      "--- a/src/gone.ts",
      "+++ /dev/null",
      "@@ -1,2 +0,0 @@",
      "-line 1",
      "-line 2",
      "",
    ].join("\n");
    const files = parseUnifiedDiff(diff);
    expect(files[0]?.status).toBe("removed");
  });

  it("ignores `---` and `+++` header lines when counting additions/deletions", () => {
    const diff = [
      "diff --git a/x.ts b/x.ts",
      "index 1..2 100644",
      "--- a/x.ts",
      "+++ b/x.ts",
      "@@ -1 +1 @@",
      "-old",
      "+new",
      "",
    ].join("\n");
    const files = parseUnifiedDiff(diff);
    // 1 addition, 1 deletion — NOT 2 each (which would include the
    // +++/--- header lines).
    expect(files[0]?.additions).toBe(1);
    expect(files[0]?.deletions).toBe(1);
  });

  it("returns empty array on empty input", () => {
    expect(parseUnifiedDiff("")).toEqual([]);
  });
});
