import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  deleteFile,
  isVaultMarkdownPath,
  listMarkdownFiles,
  readFileSnapshot,
  writeFileAtomic,
} from "../engine/vault-files.ts";

async function makeVault(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "tn-vault-files-"));
}

describe("listMarkdownFiles", () => {
  test("walks recursively, returns sorted vault-relative POSIX paths", async () => {
    const vault = await makeVault();
    await mkdir(path.join(vault, "TaskNotes/nested"), { recursive: true });
    await writeFile(path.join(vault, "root.md"), "a");
    await writeFile(path.join(vault, "TaskNotes/b.md"), "b");
    await writeFile(path.join(vault, "TaskNotes/nested/c.md"), "c");
    await writeFile(path.join(vault, "TaskNotes/not-markdown.txt"), "x");

    expect(await listMarkdownFiles(vault)).toEqual([
      "TaskNotes/b.md",
      "TaskNotes/nested/c.md",
      "root.md",
    ]);
  });

  test("skips dot- and underscore-prefixed directories", async () => {
    const vault = await makeVault();
    await mkdir(path.join(vault, ".obsidian/plugins"), { recursive: true });
    await mkdir(path.join(vault, "_templates"), { recursive: true });
    await writeFile(path.join(vault, ".obsidian/plugins/x.md"), "x");
    await writeFile(path.join(vault, "_templates/t.md"), "t");
    await writeFile(path.join(vault, "real.md"), "r");

    expect(await listMarkdownFiles(vault)).toEqual(["real.md"]);
  });

  test("throws on a missing root instead of returning an empty list", async () => {
    await expect(
      listMarkdownFiles("/nonexistent/vault/root"),
    ).rejects.toThrow();
  });
});

describe("isVaultMarkdownPath (shared by the watcher and the full rescan)", () => {
  test("accepts .md files whose ancestor directories are all visible", () => {
    expect(isVaultMarkdownPath("root.md")).toBe(true);
    expect(isVaultMarkdownPath("TaskNotes/nested/c.md")).toBe(true);
  });

  test("rejects non-.md files", () => {
    expect(isVaultMarkdownPath("TaskNotes/not-markdown.txt")).toBe(false);
    expect(isVaultMarkdownPath("README")).toBe(false);
  });

  test("rejects files under a dot/underscore directory at ANY depth", () => {
    // The watcher's old first-character check let these through even though
    // the full rescan skips them — the mismatch this predicate closes.
    expect(isVaultMarkdownPath(".obsidian/plugins/x.md")).toBe(false);
    expect(isVaultMarkdownPath("_templates/t.md")).toBe(false);
    expect(isVaultMarkdownPath("notes/.obsidian/x.md")).toBe(false);
    expect(isVaultMarkdownPath("a/b/_archive/c.md")).toBe(false);
  });

  test("agrees with listMarkdownFiles over a mixed vault", async () => {
    const vault = await makeVault();
    await mkdir(path.join(vault, "notes/.obsidian"), { recursive: true });
    await mkdir(path.join(vault, "a/_archive"), { recursive: true });
    await writeFile(path.join(vault, "keep.md"), "k");
    await writeFile(path.join(vault, "notes/.obsidian/hidden.md"), "h");
    await writeFile(path.join(vault, "a/_archive/old.md"), "o");

    const listed = await listMarkdownFiles(vault);
    expect(listed).toEqual(["keep.md"]);
    for (const rel of [
      "keep.md",
      "notes/.obsidian/hidden.md",
      "a/_archive/old.md",
    ]) {
      expect(isVaultMarkdownPath(rel)).toBe(listed.includes(rel));
    }
  });
});

describe("readFileSnapshot", () => {
  test("returns text + mtime for an existing file, null for a vanished one", async () => {
    const vault = await makeVault();
    const target = path.join(vault, "a.md");
    await writeFile(target, "hello");
    const snapshot = await readFileSnapshot(target);
    expect(snapshot?.text).toBe("hello");
    expect(snapshot !== null && snapshot.mtimeMs > 0).toBe(true);
    expect(await readFileSnapshot(path.join(vault, "gone.md"))).toBeNull();
  });
});

describe("writeFileAtomic / deleteFile", () => {
  test("writes through a temp file, creates parent dirs, leaves no litter", async () => {
    const vault = await makeVault();
    const target = path.join(vault, "new/dir/task.md");
    await writeFileAtomic(target, "body");
    expect(await Bun.file(target).text()).toBe("body");
    const entries = await readdir(path.dirname(target));
    expect(entries).toEqual(["task.md"]); // no .tmp remnants

    await deleteFile(target);
    expect(await readFileSnapshot(target)).toBeNull();
    await deleteFile(target); // second delete is a no-op, not an error
  });
});
