import { expect, test } from "vitest";
import { mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  checkDraftFormatting,
  draftPreflight,
  needsLockfileCheck,
  parseChangedPaths,
} from "./preflight.ts";

test("changed paths preserve spaces and lockfile checks cover nested workspaces", () => {
  expect(parseChangedPaths("a file.ts\0packages/new/package.json\0")).toEqual([
    "a file.ts",
    "packages/new/package.json",
  ]);
  for (const file of [
    "bun.lock",
    "package.json",
    "packages/new/package.json",
  ]) {
    expect(needsLockfileCheck([file])).toBe(true);
  }
  expect(needsLockfileCheck(["package.json.backup", "src/test.ts"])).toBe(
    false,
  );
});

test("draft preflight rejects missing ancestry input before invoking any tool", async () => {
  await expect(draftPreflight("origin/main")).rejects.toThrow(
    "full merge-base commit",
  );
  await expect(draftPreflight("-option")).rejects.toThrow(
    "full merge-base commit",
  );
});

test("format checks detect changes without rewriting files or following symlinks", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "draft-format-"));
  const file = path.join(directory, "input.json");
  const link = path.join(directory, "linked.json");
  try {
    const bad = '{"value":1}';
    await Bun.write(file, bad);
    await expect(checkDraftFormatting([file])).rejects.toThrow(
      "Formatting required",
    );
    expect(await Bun.file(file).text()).toBe(bad);
    await symlink(file, link);
    await expect(checkDraftFormatting([link])).resolves.toBeUndefined();
    await Bun.write(file, '{ "value": 1 }\n');
    await expect(checkDraftFormatting([file])).resolves.toBeUndefined();
    await Bun.write(file, "{invalid");
    await expect(checkDraftFormatting([file])).rejects.toThrow(
      `Could not check formatting: ${file}`,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
