import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  applyStrReplace,
  containedPath,
  writeWorktreeFile,
} from "@shepherdjerred/pr-fleet-controller/src/worker-file-edits.ts";

let worktree: string;

beforeEach(async () => {
  worktree = await mkdtemp(path.join(tmpdir(), "pr-fleet-edit-"));
});

afterEach(async () => {
  await rm(worktree, { recursive: true, force: true });
});

describe("containedPath", () => {
  test("accepts the worktree root and existing directories", async () => {
    await mkdir(path.join(worktree, "packages"));
    const canonical = await realpath(worktree);
    expect(await containedPath(worktree, ".")).toBe(canonical);
    expect(await containedPath(worktree, "packages")).toBe(
      path.join(canonical, "packages"),
    );
  });

  test("accepts missing nested search paths beneath an existing ancestor", async () => {
    const canonical = await realpath(worktree);
    expect(await containedPath(worktree, "missing/nested/path")).toBe(
      path.join(canonical, "missing", "nested", "path"),
    );
  });
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

  test("refuses a path reaching into Git metadata", async () => {
    for (const gitPath of [".git", ".git/config", ".git/hooks/pre-commit"]) {
      await expect(
        applyStrReplace(worktree, {
          path: gitPath,
          old_string: "x",
          new_string: "y",
          replace_all: false,
        }),
      ).rejects.toThrow(/Git metadata path/);
    }
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

  test("refuses writing into the Git directory", async () => {
    await expect(
      writeWorktreeFile(worktree, { path: ".git/config", content: "y" }),
    ).rejects.toThrow(/Git metadata path/);
  });

  test("refuses a dangling symlink pointing outside the worktree", async () => {
    // The link target does not exist, so exists() is false and only the in-tree
    // parent would be canonicalized; without the no-follow lstat guard, Bun.write
    // would follow the link and create a file at the external target.
    const outside = path.join(
      tmpdir(),
      `pr-fleet-escape-${String(Date.now())}.txt`,
    );
    await symlink(outside, path.join(worktree, "dangling"));
    await expect(
      writeWorktreeFile(worktree, { path: "dangling", content: "escaped" }),
    ).rejects.toThrow(/dangling symlink/);
    expect(await Bun.file(outside).exists()).toBe(false);
  });

  test("allows editing through a safe in-tree symlink", async () => {
    // A tracked symlink whose real target is a normal in-tree file (like this
    // repo's CLAUDE.md -> AGENTS.md) must remain editable: the canonical
    // containment check resolves the real target and confirms it is in-tree.
    await writeFile(path.join(worktree, "AGENTS.md"), "# real\n");
    await symlink(
      path.join(worktree, "AGENTS.md"),
      path.join(worktree, "CLAUDE.md"),
    );
    await writeWorktreeFile(worktree, {
      path: "CLAUDE.md",
      content: "# edited\n",
    });
    // The write followed the link and updated the real target.
    expect(await readFile(path.join(worktree, "AGENTS.md"), "utf8")).toBe(
      "# edited\n",
    );
  });

  test("refuses a symlink that resolves into the Git directory", async () => {
    // A tracked symlink whose real target is `.git` (or a path inside it) passes
    // the raw-segment check under its innocuous link name; the canonical-path
    // guard must still reject it before Bun.write follows it.
    await mkdir(path.join(worktree, ".git"));
    await writeFile(path.join(worktree, ".git", "config"), "[core]\n");
    await symlink(path.join(worktree, ".git"), path.join(worktree, "gitlink"));
    await expect(
      writeWorktreeFile(worktree, {
        path: "gitlink/config",
        content: "pwned",
      }),
    ).rejects.toThrow(/Git metadata path/);
    // The real config file is untouched.
    expect(await readFile(path.join(worktree, ".git", "config"), "utf8")).toBe(
      "[core]\n",
    );
  });
});
