import { expect, test } from "vitest";
import { fileURLToPath } from "node:url";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { existingFiles } from "../misc/migration-core.ts";
import { formattingFiles } from "./prettier-staged.ts";

test("existingFiles omits missing paths while preserving input order", async () => {
  const currentFile = fileURLToPath(import.meta.url);
  expect(await existingFiles([currentFile, `${currentFile}.missing`])).toEqual([
    currentFile,
  ]);
});

test("formattingFiles checks sources and omits symlink aliases and deleted paths", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "prettier-staged-"));
  try {
    const source = path.join(directory, "schema.json");
    const alias = path.join(directory, "schema-alias.json");
    const broken = path.join(directory, "broken.json");
    const missing = path.join(directory, "deleted.json");
    await writeFile(source, "{}\n");
    await symlink(source, alias);
    await symlink(missing, broken);
    expect(await formattingFiles([alias, missing, source, broken])).toEqual([
      source,
    ]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
