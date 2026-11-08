import { run } from "../lib/run.ts";
import { existingFiles } from "../misc/migration-core.ts";
import { lstat } from "node:fs/promises";

export async function formattingFiles(
  paths: readonly string[],
): Promise<string[]> {
  const existing = await existingFiles(paths);
  const checks = await Promise.all(
    existing.map(async (path) => {
      const metadata = await lstat(path);
      return { path, symbolicLink: metadata.isSymbolicLink() };
    }),
  );
  // Like the CI shard resolver, check the regular source rather than passing
  // aliases to Prettier: explicitly named symbolic links are rejected by its CLI.
  return checks
    .filter(({ symbolicLink }) => !symbolicLink)
    .map(({ path }) => path);
}

export async function checkStagedFormatting(
  paths: string[],
  runner: typeof run = run,
): Promise<void> {
  const files = await formattingFiles(paths);
  if (files.length === 0) {
    console.log("prettier-staged: no existing staged files to check");
    return;
  }
  await runner(["bunx", "prettier", "--check", ...files]);
}

if (import.meta.main) {
  await checkStagedFormatting(Bun.argv.slice(2));
}
