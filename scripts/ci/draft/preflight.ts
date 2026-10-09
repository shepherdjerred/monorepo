import { lstat } from "node:fs/promises";
import { check, getFileInfo, resolveConfig } from "prettier";
import { run } from "../../lib/run.ts";
import { checkMergeConflicts } from "../../checks/check-merge-conflicts.ts";

export function parseChangedPaths(output: string): string[] {
  return output.split("\0").filter((file) => file !== "");
}

export function needsLockfileCheck(files: readonly string[]): boolean {
  return files.some(
    (file) =>
      file === "bun.lock" ||
      file === "package.json" ||
      file.endsWith("/package.json"),
  );
}

export async function checkDraftFormatting(
  files: readonly string[],
): Promise<void> {
  const unformatted: string[] = [];
  for (const file of files) {
    const status = await lstat(file);
    if (!status.isFile()) continue;
    const info = await getFileInfo(file, { ignorePath: ".prettierignore" });
    if (info.ignored || info.inferredParser === null) continue;
    const options = await resolveConfig(file, { editorconfig: true });
    let formatted: boolean;
    try {
      formatted = await check(await Bun.file(file).text(), {
        ...options,
        filepath: file,
      });
    } catch {
      // Parser errors can include source snippets. Report the file only.
      throw new Error(`Could not check formatting: ${file}`);
    }
    if (!formatted) unformatted.push(file);
  }
  if (unformatted.length > 0)
    throw new Error(`Formatting required:\n${unformatted.join("\n")}`);
}

export async function draftPreflight(base: string): Promise<void> {
  if (!/^[a-f\d]{40}$/u.test(base))
    throw new Error("Draft preflight requires a full merge-base commit");
  await run(["git", "merge-base", "--is-ancestor", base, "HEAD"]);
  // Scan the full proposed history, including credentials later removed from
  // the final tree. Redaction applies before any scanner output reaches logs.
  await run([
    "gitleaks",
    "git",
    "--redact",
    "--no-banner",
    `--log-opts=${base}..HEAD`,
  ]);
  const changed = await run(
    ["git", "diff", "--name-only", "--diff-filter=ACMRT", "-z", base, "HEAD"],
    {
      capture: true,
      echoCapturedStdout: false,
    },
  );
  const files = parseChangedPaths(changed.stdout);
  if (needsLockfileCheck(files)) {
    await run([
      "bun",
      "install",
      "--frozen-lockfile",
      "--dry-run",
      "--ignore-scripts",
    ]);
  }
  if (files.length > 0) await checkMergeConflicts(files);
  await checkDraftFormatting(files);
  console.log(
    `Draft preflight passed for ${files.length.toString()} changed files; full verification runs when ready for review.`,
  );
}

if (import.meta.main) {
  const base = Bun.argv[2];
  if (base === undefined) throw new Error("Draft merge base is required");
  await draftPreflight(base);
}
