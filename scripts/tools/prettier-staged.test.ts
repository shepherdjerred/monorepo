import { expect, test, vi } from "vitest";
import { fileURLToPath } from "node:url";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { existingFiles } from "../misc/migration-core.ts";
import { checkStagedFormatting, formattingFiles } from "./prettier-staged.ts";

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

test("checkStagedFormatting does not invoke a tool for deleted staged files", async () => {
  const runner = vi.fn(async () => ({ stdout: "", stderr: "", exitCode: 0 }));
  const messages: unknown[][] = [];
  const message = vi.spyOn(console, "log").mockImplementation((...values) => {
    messages.push(values);
  });
  try {
    await checkStagedFormatting(
      [`${fileURLToPath(import.meta.url)}.deleted`],
      runner,
    );
    expect(runner).not.toHaveBeenCalled();
    expect(message).toHaveBeenCalledWith(
      "prettier-staged: no existing staged files to check",
    );
    expect(messages).toEqual([
      ["prettier-staged: no existing staged files to check"],
    ]);
  } finally {
    message.mockRestore();
  }
});

test("checkStagedFormatting forwards regular sources in order and preserves tool failures", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "prettier-staged-run-"));
  try {
    const first = path.join(directory, "first.ts");
    const second = path.join(directory, "second.ts");
    const alias = path.join(directory, "alias.ts");
    await writeFile(first, "export const first = 1;\n");
    await writeFile(second, "export const second = 2;\n");
    await symlink(first, alias);
    const runner = vi.fn(async () => ({ stdout: "", stderr: "", exitCode: 0 }));
    await checkStagedFormatting(
      [second, alias, `${first}.deleted`, first],
      runner,
    );
    expect(runner).toHaveBeenCalledExactlyOnceWith([
      "bunx",
      "prettier",
      "--check",
      second,
      first,
    ]);
    const failure = new Error("Prettier rejected the source");
    runner.mockRejectedValueOnce(failure);
    await expect(checkStagedFormatting([first], runner)).rejects.toBe(failure);
    expect(runner).toHaveBeenLastCalledWith([
      "bunx",
      "prettier",
      "--check",
      first,
    ]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
