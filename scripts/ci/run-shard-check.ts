/**
 * Run one repo-wide check against one path shard (see repo-shards.ts).
 *
 * The git-index-based checks (line-endings, large-files) already accept git
 * pathspecs, so they get the shard's pathspecs verbatim. Prettier needs an
 * explicit file list: tracked files are resolved through the same pathspecs,
 * with symlinks dropped (prettier errors on explicitly-passed symlinks — the
 * CLAUDE.md → AGENTS.md links; the lefthook prettier job excludes them for
 * the same reason) and deleted-but-still-tracked paths dropped like
 * prettier-staged.ts does. `--ignore-unknown` keeps parserless files (locks,
 * binaries) from erroring where `prettier --check .` would simply not have
 * traversed them.
 */

import path from "node:path";
import { run } from "../lib/run.ts";
import {
  matchShard,
  parseShardName,
  shardPathspecs,
  type ShardName,
} from "./repo-shards.ts";

// Anchor every subprocess at the repository root: the root package.json
// scripts invoke this from there, but the scripts test suite runs with
// cwd=scripts/, and git pathspecs like "." are cwd-relative.
const REPO_ROOT = path.join(import.meta.dir, "..", "..");

export const CHECK_NAMES = ["prettier", "line-endings", "large-files"] as const;
export type CheckName = (typeof CHECK_NAMES)[number];

const PRETTIER_CHUNK_SIZE = 1000;

export function parseCheckName(value: string): CheckName {
  const check = CHECK_NAMES.find((name) => name === value);
  if (check === undefined) {
    throw new Error(
      `unknown check "${value}" (expected one of: ${CHECK_NAMES.join(", ")})`,
    );
  }
  return check;
}

/** git ls-files entry: "<mode> <object> <stage>\t<path>", NUL-terminated. */
export function parseTrackedEntry(
  entry: string,
): { mode: string; path: string } | null {
  const tabIndex = entry.indexOf("\t");
  if (tabIndex === -1) return null;
  const mode = entry.slice(0, 6);
  return { mode, path: entry.slice(tabIndex + 1) };
}

export async function shardTrackedFiles(shard: ShardName): Promise<string[]> {
  return trackedFiles(shardPathspecs(shard));
}

async function trackedFiles(pathspecs: readonly string[]): Promise<string[]> {
  const lsFiles = Bun.spawnSync(
    ["git", "ls-files", "-sz", "--", ...pathspecs],
    {
      cwd: REPO_ROOT,
    },
  );
  if (lsFiles.exitCode !== 0) {
    throw new Error(`git ls-files failed: ${lsFiles.stderr.toString()}`);
  }
  const candidates: string[] = [];
  for (const entry of lsFiles.stdout.toString().split("\0")) {
    if (entry === "") continue;
    const parsed = parseTrackedEntry(entry);
    // 120000 = symlink; its blob is the target path, not formattable content.
    if (parsed === null || parsed.mode === "120000") continue;
    candidates.push(parsed.path);
  }
  const checks = await Promise.all(
    candidates.map(async (file) => ({
      exists: await Bun.file(path.join(REPO_ROOT, file)).exists(),
      file,
    })),
  );
  return checks.filter(({ exists }) => exists).map(({ file }) => file);
}

const CHECK_GLOBAL_INPUTS: Record<CheckName, readonly string[]> = {
  prettier: [
    ".prettierignore",
    ".prettierrc.json",
    "scripts/lib/run.ts",
    "scripts/ci/repo-shards.ts",
    "scripts/ci/run-shard-check.ts",
  ],
  "line-endings": [
    ".gitattributes",
    "scripts/checks/check-line-endings.ts",
    "scripts/lib/run.ts",
    "scripts/ci/repo-shards.ts",
    "scripts/ci/run-shard-check.ts",
  ],
  "large-files": [
    ".largeignore",
    "scripts/checks/check-large-files.ts",
    "scripts/lib/run.ts",
    "scripts/ci/repo-shards.ts",
    "scripts/ci/run-shard-check.ts",
  ],
};

export function changedFilesForShard(
  check: CheckName,
  shard: ShardName,
  environment: Readonly<Record<string, string | undefined>> = Bun.env,
): string[] | null {
  const base = environment["CI_CHANGED_BASE"]?.trim();
  if (base === undefined || base === "") return null;
  for (const command of [
    ["git", "cat-file", "-e", `${base}^{commit}`],
    ["git", "merge-base", "--is-ancestor", base, "HEAD"],
  ]) {
    const validation = Bun.spawnSync(command, { cwd: REPO_ROOT });
    if (validation.exitCode !== 0) {
      console.error(
        `WARN: ${check}[${shard}] could not validate ${base}; checking the complete shard`,
      );
      return null;
    }
  }
  const diff = Bun.spawnSync(
    ["git", "diff", "--no-renames", "--name-only", "-z", base, "HEAD"],
    { cwd: REPO_ROOT },
  );
  if (diff.exitCode !== 0) return null;
  const changed = diff.stdout
    .toString()
    .split("\0")
    .filter((file) => file !== "");
  if (
    changed.some((file) => CHECK_GLOBAL_INPUTS[check].includes(file)) ||
    (check === "line-endings" &&
      changed.some(
        (file) => file === ".gitattributes" || file.endsWith("/.gitattributes"),
      ))
  ) {
    return null;
  }
  return changed.filter((file) => matchShard(file) === shard);
}

export function chunk<T>(items: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

export type ShardCheckDependencies = {
  runner?: typeof run;
  fileResolver?: (
    shard: ShardName,
    changedFiles?: readonly string[],
  ) => Promise<string[]>;
  changedFileResolver?: (
    check: CheckName,
    shard: ShardName,
  ) => Promise<string[] | null> | string[] | null;
};

export async function runShardCheck(
  check: CheckName,
  shard: ShardName,
  dependencies: ShardCheckDependencies = {},
): Promise<void> {
  const runner = dependencies.runner ?? run;
  const changed = await (
    dependencies.changedFileResolver ?? changedFilesForShard
  )(check, shard);
  if (check === "prettier") {
    const fileResolver =
      dependencies.fileResolver ??
      (async (requestedShard, changedFiles) =>
        changedFiles === undefined
          ? shardTrackedFiles(requestedShard)
          : trackedFiles(changedFiles));
    const files = await fileResolver(shard, changed ?? undefined);
    if (files.length === 0) {
      console.log(`prettier[${shard}]: no tracked files to check`);
      return;
    }
    for (const files_ of chunk(files, PRETTIER_CHUNK_SIZE)) {
      await runner(
        [
          "bunx",
          "--no-install",
          "prettier",
          "--check",
          "--ignore-unknown",
          ...files_,
        ],
        { cwd: REPO_ROOT },
      );
    }
    return;
  }
  if (changed?.length === 0) {
    console.log(`${check}[${shard}]: no changed files to check`);
    return;
  }
  await runner(
    [
      "bun",
      "--no-install",
      `scripts/checks/check-${check}.ts`,
      ...(changed ?? shardPathspecs(shard)),
    ],
    { cwd: REPO_ROOT },
  );
}

if (import.meta.main) {
  const [checkArg, shardArg, ...rest] = Bun.argv.slice(2);
  if (checkArg === undefined || shardArg === undefined || rest.length > 0) {
    throw new Error("usage: run-shard-check.ts <check> <shard>");
  }
  await runShardCheck(parseCheckName(checkArg), parseShardName(shardArg));
}
