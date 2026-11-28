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

import { createHash } from "node:crypto";
import path from "node:path";
import { run } from "../lib/run.ts";
import { preparePrettierCache } from "./prettier-cache.ts";
import {
  PRETTIER_TOOLCHAIN_FILES,
  prettierPluginNames,
  prettierToolchainChanged,
} from "./prettier/toolchain.ts";
import { assertRootCheckInputs } from "./root-check-inputs.ts";
import {
  matchShard,
  parseShardName,
  SHARD_NAMES,
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

/**
 * Tracked, regular, still-existing files matching `pathspecs`. An empty
 * pathspec list selects nothing: `git ls-files` with no pathspec lists the
 * whole repository, which turned "no changed files in this shard" into a
 * full-repository Prettier run.
 */
export async function trackedFiles(
  pathspecs: readonly string[],
  repository = REPO_ROOT,
): Promise<string[]> {
  if (pathspecs.length === 0) return [];
  const lsFiles = Bun.spawnSync(
    ["git", "ls-files", "-sz", "--", ...pathspecs],
    {
      cwd: repository,
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
      exists: await Bun.file(path.join(repository, file)).exists(),
      file,
    })),
  );
  return checks.filter(({ exists }) => exists).map(({ file }) => file);
}

const CHECK_GLOBAL_INPUTS: Record<CheckName, readonly string[]> = {
  prettier: [
    "bun.lock",
    "package.json",
    ".gitignore",
    ".prettierignore",
    ".prettierrc.json",
    "scripts/lib/run.ts",
    "scripts/ci/repo-shards.ts",
    "scripts/ci/run-shard-check.ts",
    "scripts/ci/prettier-cache.ts",
    "scripts/ci/prettier/toolchain.ts",
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

/** The file's content at `revision`, or null when it does not exist there. */
function fileAtRevision(
  repository: string,
  revision: string,
  file: string,
): string | null {
  const shown = Bun.spawnSync(["git", "show", `${revision}:${file}`], {
    cwd: repository,
  });
  return shown.exitCode === 0 ? shown.stdout.toString() : null;
}

/** Plugins the HEAD configuration loads; null when it cannot be read. */
function configuredPlugins(
  configuration: string | null,
  manifest: string | null,
): string[] | null {
  try {
    return prettierPluginNames(configuration, manifest);
  } catch (error) {
    console.error(
      `WARN: prettier could not map its plugins to bun.lock entries (${error instanceof Error ? error.message : String(error)}); checking the complete shard`,
    );
    return null;
  }
}

/** `package.json` and `bun.lock` differ between `base` and HEAD where Prettier can see. */
function prettierToolchainDiffers(
  base: string,
  changed: readonly string[],
  repository: string,
): boolean {
  if (!changed.some((file) => PRETTIER_TOOLCHAIN_FILES.includes(file))) {
    return false;
  }
  const revision = (name: string) => ({
    "bun.lock": fileAtRevision(repository, name, "bun.lock"),
    "package.json": fileAtRevision(repository, name, "package.json"),
  });
  const configuration = fileAtRevision(repository, "HEAD", ".prettierrc.json");
  const plugins = configuredPlugins(
    configuration,
    fileAtRevision(repository, "HEAD", "package.json"),
  );
  if (plugins === null) return true;
  const differs = prettierToolchainChanged(
    changed,
    revision(base),
    revision("HEAD"),
    plugins,
  );
  if (differs === null) {
    console.error(
      "WARN: prettier could not compare package.json and bun.lock; checking the complete shard",
    );
    return true;
  }
  return differs;
}

/** Files whose any change can alter how Prettier treats files outside the diff. */
function changesPrettierEverywhere(file: string): boolean {
  return (
    file === ".editorconfig" ||
    file.endsWith("/.editorconfig") ||
    file === ".gitignore" ||
    file.startsWith("patches/")
  );
}

/**
 * Whether something in the diff can change how Prettier (or another check)
 * treats files outside it, so every file in the shard must be checked.
 *
 * `package.json` and `bun.lock` are Prettier global inputs only through the
 * slices in prettier/toolchain.ts: they changed on about one commit in ten
 * without Prettier noticing, and each such commit used to force a full run.
 */
function forcesCompleteShard(
  check: CheckName,
  base: string,
  changed: readonly string[],
  repository: string,
): boolean {
  const semantic = (file: string) =>
    check === "prettier" && PRETTIER_TOOLCHAIN_FILES.includes(file);
  if (
    changed.some(
      (file) => CHECK_GLOBAL_INPUTS[check].includes(file) && !semantic(file),
    )
  ) {
    return true;
  }
  const prettierInputsChanged =
    check === "prettier" &&
    (changed.some((file) => changesPrettierEverywhere(file)) ||
      prettierToolchainDiffers(base, changed, repository));
  return (
    prettierInputsChanged ||
    (check === "line-endings" &&
      changed.some(
        (file) => file === ".gitattributes" || file.endsWith("/.gitattributes"),
      ))
  );
}

export function changedFilesForShard(
  check: CheckName,
  shard: ShardName,
  environment: Readonly<Record<string, string | undefined>> = Bun.env,
  repository = REPO_ROOT,
): string[] | null {
  const base = environment["CI_CHANGED_BASE"]?.trim();
  if (base === undefined || base === "") return null;
  for (const command of [
    ["git", "cat-file", "-e", `${base}^{commit}`],
    ["git", "merge-base", "--is-ancestor", base, "HEAD"],
  ]) {
    const validation = Bun.spawnSync(command, { cwd: repository });
    if (validation.exitCode !== 0) {
      console.error(
        `WARN: ${check}[${shard}] could not validate ${base}; checking the complete shard`,
      );
      return null;
    }
  }
  const diff = Bun.spawnSync(
    ["git", "diff", "--no-renames", "--name-only", "-z", base, "HEAD"],
    { cwd: repository },
  );
  if (diff.exitCode !== 0) return null;
  const changed = diff.stdout
    .toString()
    .split("\0")
    .filter((file) => file !== "");
  return forcesCompleteShard(check, base, changed, repository)
    ? null
    : changed.filter((file) => matchShard(file) === shard);
}

/** One Turbo hash input per shard; see prettierChangedDigest. */
export const PRETTIER_CHANGED_ENV_KEYS: Record<ShardName, string> = {
  scout: "CI_PRETTIER_SCOUT_CHANGED_SHA256",
  homelab: "CI_PRETTIER_HOMELAB_CHANGED_SHA256",
  packages: "CI_PRETTIER_PACKAGES_CHANGED_SHA256",
  root: "CI_PRETTIER_ROOT_CHANGED_SHA256",
};

/**
 * Files outside the shard whose content decides whether the shard runs in
 * full or how Prettier formats a file: the global inputs and every
 * `.editorconfig` (Prettier reads them up the tree). The scout, homelab and
 * packages tasks do not list all of these as Turbo inputs, so the digest
 * carries their blob ids.
 */
const PRETTIER_CONFIG_PATHSPECS: readonly string[] = [
  ...CHECK_GLOBAL_INPUTS.prettier.map((file) => `:(literal)${file}`),
  ":(glob)**/.editorconfig",
];

function listGit(repository: string, args: string[]): string[] {
  const result = Bun.spawnSync(["git", ...args], { cwd: repository });
  if (result.exitCode !== 0) {
    throw new Error(
      `git ${args.join(" ")} failed: ${result.stderr.toString()}`,
    );
  }
  return result.stdout
    .toString()
    .split("\0")
    .filter((entry) => entry !== "");
}

function shardIndexEntries(
  shard: ShardName,
  changed: readonly string[] | null,
  repository: string,
): { entry: string; path: string }[] {
  const selected = changed === null ? null : new Set(changed);
  const entries: { entry: string; path: string }[] = [];
  for (const entry of listGit(repository, [
    "ls-files",
    "-sz",
    "--",
    ...shardPathspecs(shard),
  ])) {
    const parsed = parseTrackedEntry(entry);
    if (parsed !== null && (selected === null || selected.has(parsed.path))) {
      entries.push({ entry, path: parsed.path });
    }
  }
  return entries;
}

/** Paths whose index entries a digest over `changed` covers. */
export function prettierDigestedFiles(
  shard: ShardName,
  changed: readonly string[] | null,
  repository = REPO_ROOT,
): string[] {
  return shardIndexEntries(shard, changed, repository).map(
    ({ path: file }) => file,
  );
}

/**
 * The content a Prettier shard check depends on, as a Turbo hash input.
 *
 * Turbo hashes the shard's files, but its input globs exclude some paths that
 * Prettier still checks (`!**\/build/**` versus the un-ignored
 * `packages/mc-harness/src/build/`), and a root `.editorconfig` can force a
 * full run without being an input of every shard task. The digest is content
 * addressed instead of relying on those globs being a perfect superset: it
 * covers the index entries (mode, blob id, path) of the files the check
 * touches, the working bytes of any that differ from the index, and the
 * config files above. When only some files are checked it also covers their
 * sorted path list; `full` covers every tracked file in the shard. It does not
 * cover the base commit, which is why identical diffs keep hitting the cache
 * after the target branch moves. `changed` comes from `changedFilesForShard`,
 * the function the check itself uses, so the hash cannot disagree with the
 * work done.
 */
export async function prettierDigestForFiles(
  shard: ShardName,
  changed: readonly string[] | null,
  repository = REPO_ROOT,
): Promise<string> {
  const selected = changed === null ? null : new Set(changed);
  const inSelection = (file: string) => selected === null || selected.has(file);
  const hash = createHash("sha256");
  const shardSpecs = [...shardPathspecs(shard)];
  for (const { entry } of shardIndexEntries(shard, changed, repository)) {
    hash.update("index\0").update(entry).update("\0");
  }
  // Index entries do not see unstaged edits, which Prettier does read.
  for (const file of listGit(repository, [
    "ls-files",
    "-mz",
    "--",
    ...shardSpecs,
  ])) {
    if (!inSelection(file)) continue;
    const input = Bun.file(path.join(repository, file));
    hash.update("worktree\0").update(JSON.stringify(file)).update("\0");
    hash.update(
      (await input.exists())
        ? createHash("sha256")
            .update(new Uint8Array(await input.arrayBuffer()))
            .digest("hex")
        : "missing",
    );
  }
  for (const entry of listGit(repository, [
    "ls-files",
    "-sz",
    "--",
    ...PRETTIER_CONFIG_PATHSPECS,
  ])) {
    hash.update("config\0").update(entry).update("\0");
  }
  if (selected !== null) {
    for (const file of [...selected].sort()) {
      hash.update("changed\0").update(JSON.stringify(file)).update("\0");
    }
  }
  return `${selected === null ? "full" : "changed"}-${hash.digest("hex")}`;
}

export async function prettierChangedDigest(
  shard: ShardName,
  environment: Readonly<Record<string, string | undefined>>,
  repository = REPO_ROOT,
): Promise<string> {
  return prettierDigestForFiles(
    shard,
    changedFilesForShard("prettier", shard, environment, repository),
    repository,
  );
}

export async function prettierChangedEnvironment(
  environment: Readonly<Record<string, string | undefined>>,
  repository = REPO_ROOT,
): Promise<Record<string, string>> {
  return Object.fromEntries(
    await Promise.all(
      SHARD_NAMES.map(
        async (shard) =>
          [
            PRETTIER_CHANGED_ENV_KEYS[shard],
            await prettierChangedDigest(shard, environment, repository),
          ] as const,
      ),
    ),
  );
}

/**
 * Under Turbo the shard digest must have been computed by scripts/verify.ts
 * from this checkout. Without it every changed list would hash identically and
 * a cached pass could replay for different work, so refuse to run.
 */
export async function assertPrettierChangedDigest(
  shard: ShardName,
  environment: Readonly<Record<string, string | undefined>> = Bun.env,
): Promise<void> {
  const turboHash = environment["TURBO_HASH"];
  if (turboHash === undefined || turboHash === "") return;
  const key = PRETTIER_CHANGED_ENV_KEYS[shard];
  const expected = environment[key];
  if (
    expected === undefined ||
    expected !== (await prettierChangedDigest(shard, environment))
  ) {
    throw new Error(
      `prettier-${shard} under Turbo requires a freshly computed ${key}. Use bun run verify, or run bun run prettier-${shard} outside Turbo.`,
    );
  }
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
    const cacheRoot = Bun.env["CI_FORMAT_CACHE_ROOT"];
    const cache =
      cacheRoot === undefined || cacheRoot.trim() === ""
        ? undefined
        : await preparePrettierCache(REPO_ROOT, cacheRoot, shard);
    try {
      if (cache !== undefined) {
        console.log(
          `CI_FORMAT_CACHE_DIAGNOSTIC ${JSON.stringify({
            schemaVersion: 1,
            shard,
            restored: cache.restored,
          })}`,
        );
      }
      for (const files_ of chunk(files, PRETTIER_CHUNK_SIZE)) {
        await runner(
          [
            "bunx",
            "--no-install",
            "prettier",
            "--check",
            "--ignore-unknown",
            ...(cache?.args ?? []),
            ...files_,
          ],
          { cwd: REPO_ROOT },
        );
      }
      await cache?.publish();
    } finally {
      await cache?.cleanup();
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
  const shard = parseShardName(shardArg);
  const check = parseCheckName(checkArg);
  const assertInputs = async () => {
    if (shard === "root") await assertRootCheckInputs();
    if (check === "prettier") await assertPrettierChangedDigest(shard);
  };
  await assertInputs();
  await runShardCheck(check, shard);
  await assertInputs();
}
