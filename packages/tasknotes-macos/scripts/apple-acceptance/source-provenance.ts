import assert from "node:assert/strict";
import path from "node:path";

export type SourceFingerprints = Record<string, string>;
export function requireStableSources(
  before: SourceFingerprints,
  after: SourceFingerprints,
): void {
  assert.equal(
    JSON.stringify(before),
    JSON.stringify(after),
    "Apple/core/fixture inputs changed while building native E2E artifacts",
  );
}

/** One Apple inventory, shared by both native runners without a reverse workspace edge. */
export async function sourceFingerprints(
  workspace: string,
  git: (argv: string[]) => Promise<string>,
): Promise<SourceFingerprints> {
  const output = await git([
    "git",
    "ls-files",
    "-z",
    "--cached",
    "--others",
    "--exclude-standard",
    "--",
    "packages/tasks-for-obsidian/ios",
    "packages/tasks-for-obsidian/scripts",
    "packages/tasks-for-obsidian/package.json",
    "packages/tasknotes-macos",
    "packages/tasknotes-core",
    "packages/tasknotes-fixtures",
    "bun.lock",
    "package.json",
    ".mise.toml",
  ]);
  const files = [...new Set(output.split("\0").filter(Boolean))].sort();
  assert.ok(
    files.length > 0 && files.length <= 20_000,
    "Unexpected native source input inventory",
  );
  const fingerprints: SourceFingerprints = {};
  for (const file of files) {
    assert.ok(
      !path.isAbsolute(file) && !file.split("/").includes(".."),
      "Native source input escaped the workspace",
    );
    const source = Bun.file(path.join(workspace, file));
    fingerprints[file] = (await source.exists())
      ? new Bun.CryptoHasher("sha256")
          .update(await source.bytes())
          .digest("hex")
      : "deleted";
  }
  return fingerprints;
}
