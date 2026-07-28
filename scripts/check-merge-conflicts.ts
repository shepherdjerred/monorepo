import { runAllowExit } from "./lib/run.ts";
import {
  existingFiles,
  isMergeConflictCandidate,
  parseConflictIgnore,
} from "./migration-core.ts";

const SOURCE_PATHS = [
  "*.ts",
  "*.tsx",
  "*.rs",
  "*.json",
  "*.yaml",
  "*.yml",
  "*.md",
  "*.sh",
  "*.astro",
  "*.toml",
];

export async function checkMergeConflicts(
  requestedPaths?: readonly string[],
): Promise<void> {
  const ignoreFile = Bun.file(".conflictignore");
  const exclusions = (await ignoreFile.exists())
    ? parseConflictIgnore(await ignoreFile.text()).map(
        (path) => `:(exclude)${path}`,
      )
    : [];
  const paths =
    requestedPaths === undefined || requestedPaths.length === 0
      ? SOURCE_PATHS
      : await existingFiles(
          requestedPaths.filter((path) => isMergeConflictCandidate(path)),
        );
  if (paths.length === 0) {
    console.log("check-merge-conflicts: no staged source files to check");
    return;
  }
  const result = await runAllowExit(
    [
      "git",
      "grep",
      "--cached",
      "-l",
      "-e",
      `${"<".repeat(7)} `,
      "-e",
      `${">".repeat(7)} `,
      "--",
      ...paths,
      ...exclusions,
    ],
    { capture: true, secret: true },
  );
  if (result.exitCode > 1) {
    throw new Error(`git grep failed with exit ${result.exitCode.toString()}`);
  }
  if (result.exitCode === 0 && result.stdout.trim() !== "") {
    throw new Error(`Merge conflict markers found:\n${result.stdout.trim()}`);
  }
}

if (import.meta.main) {
  const requestedPaths = Bun.argv.slice(2);
  await checkMergeConflicts(
    requestedPaths.length === 0 ? undefined : requestedPaths,
  );
}
