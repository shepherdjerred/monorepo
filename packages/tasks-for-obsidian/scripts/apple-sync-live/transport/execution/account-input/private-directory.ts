import assert from "node:assert/strict";
import { lstat, mkdir, realpath } from "node:fs/promises";

export async function ownedDirectory(directory: string, create = false) {
  if (create) await mkdir(directory, { recursive: true, mode: 0o700 });
  const stat = await lstat(directory);
  assert.ok(
    stat.isDirectory() &&
      !stat.isSymbolicLink() &&
      stat.uid === process.getuid?.(),
  );
  assert.equal(stat.mode & 0o777, 0o700);
  assert.equal(await realpath(directory), directory);
}
