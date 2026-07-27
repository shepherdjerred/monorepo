import { runAllowExit } from "./lib/run.ts";

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

export function parseConflictIgnore(source: string): string[] {
  return source
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("#"));
}

export async function checkMergeConflicts(): Promise<void> {
  const ignoreFile = Bun.file(".conflictignore");
  const exclusions = (await ignoreFile.exists())
    ? parseConflictIgnore(await ignoreFile.text()).map(
        (path) => `:(exclude)${path}`,
      )
    : [];
  const result = await runAllowExit(
    [
      "git",
      "grep",
      "-l",
      "-e",
      `${"<".repeat(7)} `,
      "-e",
      `${">".repeat(7)} `,
      "--",
      ...SOURCE_PATHS,
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
  await checkMergeConflicts();
}
