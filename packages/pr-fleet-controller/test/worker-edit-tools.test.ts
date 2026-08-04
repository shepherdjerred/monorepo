import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  applyStrReplace,
  writeWorktreeFile,
} from "@shepherdjerred/pr-fleet-controller/src/worker-file-edits.ts";

let worktree: string;

beforeEach(async () => {
  worktree = await mkdtemp(path.join(tmpdir(), "pr-fleet-edit-"));
});

afterEach(async () => {
  await rm(worktree, { recursive: true, force: true });
});

describe("applyStrReplace", () => {
  test("replaces a unique substring in place", async () => {
    await writeFile(
      path.join(worktree, "a.ts"),
      "const x = 1;\nconst y = 2;\n",
    );
    const result = await applyStrReplace(worktree, {
      path: "a.ts",
      old_string: "const x = 1;",
      new_string: "const x = 99;",
      replace_all: false,
    });
    expect(result).toEqual({ path: "a.ts", replacements: 1 });
    expect(await readFile(path.join(worktree, "a.ts"), "utf8")).toBe(
      "const x = 99;\nconst y = 2;\n",
    );
  });

  test("treats new_string literally (no $ replacement patterns)", async () => {
    await writeFile(path.join(worktree, "a.ts"), "const price = OLD;\n");
    await applyStrReplace(worktree, {
      path: "a.ts",
      old_string: "OLD",
      new_string: "$1$&cost",
      replace_all: false,
    });
    expect(await readFile(path.join(worktree, "a.ts"), "utf8")).toBe(
      "const price = $1$&cost;\n",
    );
  });

  test("replaces every occurrence with replace_all", async () => {
    await writeFile(path.join(worktree, "a.ts"), "a a a\n");
    const result = await applyStrReplace(worktree, {
      path: "a.ts",
      old_string: "a",
      new_string: "b",
      replace_all: true,
    });
    expect(result).toEqual({ path: "a.ts", replacements: 3 });
    expect(await readFile(path.join(worktree, "a.ts"), "utf8")).toBe("b b b\n");
  });

  test("rejects a non-unique old_string without replace_all", async () => {
    await writeFile(path.join(worktree, "a.ts"), "a a\n");
    await expect(
      applyStrReplace(worktree, {
        path: "a.ts",
        old_string: "a",
        new_string: "b",
        replace_all: false,
      }),
    ).rejects.toThrow(/occurs 2 times/);
    // Left untouched on rejection.
    expect(await readFile(path.join(worktree, "a.ts"), "utf8")).toBe("a a\n");
  });

  test("rejects an old_string that is not present", async () => {
    await writeFile(path.join(worktree, "a.ts"), "hello\n");
    await expect(
      applyStrReplace(worktree, {
        path: "a.ts",
        old_string: "goodbye",
        new_string: "x",
        replace_all: false,
      }),
    ).rejects.toThrow(/not found/);
  });

  test("rejects when old_string and new_string are identical", async () => {
    await writeFile(path.join(worktree, "a.ts"), "same\n");
    await expect(
      applyStrReplace(worktree, {
        path: "a.ts",
        old_string: "same",
        new_string: "same",
        replace_all: false,
      }),
    ).rejects.toThrow(/identical/);
  });

  test("rejects editing a file that does not exist", async () => {
    await expect(
      applyStrReplace(worktree, {
        path: "missing.ts",
        old_string: "x",
        new_string: "y",
        replace_all: false,
      }),
    ).rejects.toThrow(/does not exist/);
  });

  test("refuses a path that escapes the worktree", async () => {
    await expect(
      applyStrReplace(worktree, {
        path: "../escape.ts",
        old_string: "x",
        new_string: "y",
        replace_all: false,
      }),
    ).rejects.toThrow(/Unsafe worktree path/);
  });
});

describe("writeWorktreeFile", () => {
  test("creates a new file", async () => {
    const result = await writeWorktreeFile(worktree, {
      path: "new.ts",
      content: "export const z = 3;\n",
    });
    expect(result.path).toBe("new.ts");
    expect(result.bytes).toBeGreaterThan(0);
    expect(await readFile(path.join(worktree, "new.ts"), "utf8")).toBe(
      "export const z = 3;\n",
    );
  });

  test("overwrites an existing file", async () => {
    await writeFile(path.join(worktree, "e.ts"), "old\n");
    await writeWorktreeFile(worktree, { path: "e.ts", content: "new\n" });
    expect(await readFile(path.join(worktree, "e.ts"), "utf8")).toBe("new\n");
  });

  test("refuses an absolute path outside the worktree", async () => {
    await expect(
      writeWorktreeFile(worktree, { path: "/etc/x", content: "y" }),
    ).rejects.toThrow(/Unsafe worktree path/);
  });
});
