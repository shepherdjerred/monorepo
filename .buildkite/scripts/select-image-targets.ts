#!/usr/bin/env bun

/**
 * Select the image targets whose owned workspace closure changed.
 *
 * This intentionally does not call Turbo or require node_modules. Image
 * selection happens before the expensive toolchain/install/build work, and a
 * selector failure is handled by bake-images.ts by building every target.
 */

import {
  manifestChangeIsGlobal,
  parseLockfile,
  closureFingerprint,
  closurePackageIds,
  patchedDependencyKey,
} from "./select-image-targets-lockfile.ts";
import type {
  FilePair,
  LockfilePair,
} from "./select-image-targets-lockfile.ts";

import {
  loadWorkspaces,
  dependencyClosure,
  targetClosureDirs,
} from "./select-image-targets-workspaces.ts";
import type { WorkspacePackage } from "./select-image-targets-workspaces.ts";
import {
  ALL_IMAGE_TARGETS,
  APPLICATION_IMAGE_TARGETS,
  IMAGE_TARGET_OWNERS,
} from "./image-targets.ts";

// Paths whose change means "build everything", unconditionally. Deliberately
// NOT here, because their changes are attributed per image instead (each with
// fail-open to ALL on any parse surprise):
// - bun.lock — closure resolution fingerprints (below).
// - package.json / scripts/package.json — content-aware: a delta confined to
//   devDependencies/scripts is repo tooling that ships in no image; the
//   accompanying bun.lock change is attributed by the fingerprints. Any other
//   key (workspaces, overrides, patchedDependencies, trustedDependencies, …)
//   still selects ALL.
// - patches/ — each patch file maps to one dependency via the manifest's
//   patchedDependencies; only images whose closure contains that dependency
//   are selected.
// - .buildkite/ — only the files that shape image builds/selection are
//   global; other CI scripts don't change image content.
const GLOBAL_IMAGE_INPUTS = [
  // Bake defines the Dockerfile, context, arguments, cache, and output tags
  // for every application and infrastructure image.
  "docker-bake.hcl",
  // Selector and orchestration corrections must reconcile every target once:
  // a previously omitted content change can already be inside the last-green
  // base, so testing the new selector alone cannot repair that latent drift.
  ".buildkite/pipeline.yml",
  ".buildkite/scripts/bake-images.ts",
  ".buildkite/scripts/bake-retry.ts",
  ".buildkite/scripts/buildkit-env.ts",
  ".buildkite/scripts/image-targets.ts",
  ".buildkite/scripts/migration-core.ts",
  ".buildkite/scripts/select-image-targets.ts",
  ".buildkite/scripts/select-image-targets-lockfile.ts",
  ".buildkite/scripts/select-image-targets-workspaces.ts",
];

// These files shape every application solve, but none of the self-contained
// infrastructure image contexts. Keep them separate from GLOBAL_IMAGE_INPUTS
// so a harness or root workspace-config edit does not rebuild infra.
const SHARED_APPLICATION_IMAGE_INPUTS = [
  ".buildkite/application-image-smoke.Dockerfile",
  ".buildkite/scripts/application-image-runtime.ts",
  ".buildkite/scripts/smoke-app-in-image.ts",
  ".dockerignore",
  "bunfig.toml",
  "tsconfig.base.json",
];

const TARGET_PATH_PREFIXES: Readonly<Record<string, readonly string[]>> = {
  "scout-for-lol": [
    "packages/scout-for-lol/scripts/contract-hash.ts",
    "packages/scout-for-lol/tsconfig.base.json",
  ],
  // The evals image build copies packages/scout-for-lol/tsconfig.base.json and
  // its runtime tsconfig extends it, but that file sits above every workspace
  // package dir, so the closure walk never attributes it. Rebuild scout-evals
  // when it changes so the image never pins stale compiler configuration.
  "scout-evals": ["packages/scout-for-lol/tsconfig.base.json"],
  // Temporal compiles toolkit into the worker image as an embedded CLI, but
  // toolkit is deliberately not a runtime workspace dependency.
  "temporal-worker": ["packages/toolkit/"],
  "discord-plays-pokemon": ["packages/discord-plays-pokemon/"],
  "discord-plays-mario-kart": ["packages/discord-plays-mario-kart/"],
  infra: [
    "packages/homelab/images/",
    "packages/homelab/scripts/smoke-images.ts",
    "packages/homelab/src/cdk8s/scripts/generate-caddyfile.ts",
    "packages/homelab/src/cdk8s/src/misc/common.ts",
    "packages/homelab/src/cdk8s/src/misc/s3-static-site.ts",
    "packages/homelab/src/cdk8s/src/resources/s3-static-sites/sites.ts",
  ],
};

function pathMatchesPrefix(path: string, prefix: string): boolean {
  return prefix.endsWith("/") ? path.startsWith(prefix) : path === prefix;
}

/** Optional changed-file contents the selector attributes precisely. */
export type SelectorInputs = {
  lockfiles?: LockfilePair;
  rootPackageJson?: FilePair;
  scriptsPackageJson?: FilePair;
};

function lockfileChangedTargets(
  lockfiles: LockfilePair,
  packages: ReadonlyMap<string, WorkspacePackage>,
): Set<string> {
  if (lockfiles.base === null) throw new Error("base lockfile unavailable");
  const base = parseLockfile(lockfiles.base);
  const head = parseLockfile(lockfiles.head);
  const changed = new Set<string>();
  for (const [target, owner] of Object.entries(IMAGE_TARGET_OWNERS)) {
    const closureDirs = targetClosureDirs(target, owner, packages);
    const baseFp = closureFingerprint(closureDirs, base);
    const headFp = closureFingerprint(closureDirs, head);
    if (baseFp === null || headFp === null || baseFp !== headFp) {
      changed.add(target);
    }
  }
  return changed;
}

/**
 * Why each target was (or every target had to be) selected. The reasons are a
 * byproduct of the selection walk itself — this report is the ONLY place they
 * survive; stdout stays the bare target array for the shell consumers.
 */
export type SelectionReport = {
  /** Git ref the diff was computed against (null when unknown to the caller). */
  base: string | null;
  changedPaths: string[];
  /** "all" = a fail-open or global input forced every target. */
  mode: "selected" | "all";
  /** Set exactly when mode === "all": the single reason everything rebuilds. */
  globalReason: string | null;
  /** Per-target reasons; in "all" mode every target carries the global reason. */
  targets: Record<string, string[]>;
};

export type SelectionResult = {
  targets: string[];
  report: SelectionReport;
};

function allTargetsResult(
  changedPaths: readonly string[],
  globalReason: string,
): SelectionResult {
  return {
    targets: [...ALL_IMAGE_TARGETS],
    report: {
      base: null,
      changedPaths: [...changedPaths],
      mode: "all",
      globalReason,
      targets: Object.fromEntries(
        ALL_IMAGE_TARGETS.map((target) => [target, [globalReason]]),
      ),
    },
  };
}

function addReason(
  reasons: Map<string, string[]>,
  target: string,
  reason: string,
): void {
  const existing = reasons.get(target);
  if (existing === undefined) {
    reasons.set(target, [reason]);
  } else if (!existing.includes(reason)) {
    existing.push(reason);
  }
}

function globalInputReason(changedPaths: readonly string[]): string | null {
  for (const path of changedPaths) {
    const prefix = GLOBAL_IMAGE_INPUTS.find((candidate) =>
      pathMatchesPrefix(path, candidate),
    );
    if (prefix !== undefined) {
      return `global image input changed: ${path} (matches ${prefix})`;
    }
  }
  return null;
}

// Root manifests: global unless the delta is confined to attributable keys
// (repo tooling). The accompanying bun.lock change — if any — is attributed
// by the closure fingerprints; the root workspace is in no image closure, so
// a pure tooling bump correctly selects nothing. A missing pair fails open.
function manifestGlobalReason(
  changedPaths: readonly string[],
  inputs?: SelectorInputs,
): string | null {
  const manifestPairs: readonly (readonly [string, FilePair | undefined])[] = [
    ["package.json", inputs?.rootPackageJson],
    ["scripts/package.json", inputs?.scriptsPackageJson],
  ];
  for (const [path, pair] of manifestPairs) {
    if (!changedPaths.includes(path)) continue;
    if (pair === undefined) {
      return `${path} changed but base/head contents were unavailable (fail-open)`;
    }
    if (manifestChangeIsGlobal(pair)) {
      return `${path} changed outside attributable keys (devDependencies/scripts)`;
    }
  }
  return null;
}

function addClosureReasons(
  changedPaths: readonly string[],
  packages: ReadonlyMap<string, WorkspacePackage>,
  reasons: Map<string, string[]>,
): void {
  for (const [target, owner] of Object.entries(IMAGE_TARGET_OWNERS)) {
    const closure = dependencyClosure(owner, packages);
    const dirs = [...closure].map((name) => {
      const pkg = packages.get(name);
      if (pkg === undefined) {
        throw new Error(
          `workspace disappeared while selecting images: ${name}`,
        );
      }
      return pkg.dir;
    });
    for (const path of changedPaths) {
      const dir = dirs.find((candidate) => path.startsWith(candidate));
      if (dir !== undefined) {
        addReason(reasons, target, `workspace closure: ${path} under ${dir}`);
      }
    }
  }
}

function addPrefixReasons(
  changedPaths: readonly string[],
  reasons: Map<string, string[]>,
): void {
  for (const [target, prefixes] of Object.entries(TARGET_PATH_PREFIXES)) {
    for (const path of changedPaths) {
      const prefix = prefixes.find((candidate) =>
        pathMatchesPrefix(path, candidate),
      );
      if (prefix !== undefined) {
        addReason(
          reasons,
          target,
          `configured extra input: ${path} (matches ${prefix})`,
        );
      }
    }
  }
}

function addSharedApplicationReasons(
  changedPaths: readonly string[],
  reasons: Map<string, string[]>,
): void {
  for (const path of changedPaths) {
    const input = SHARED_APPLICATION_IMAGE_INPUTS.find((candidate) =>
      pathMatchesPrefix(path, candidate),
    );
    if (input === undefined) continue;
    for (const target of APPLICATION_IMAGE_TARGETS) {
      addReason(
        reasons,
        target,
        `shared application image input: ${path} (matches ${input})`,
      );
    }
  }
}

// Attribute each changed patch file to the images whose closure contains the
// patched dependency, via the HEAD manifest + HEAD lockfile (a patch-content
// edit doesn't touch bun.lock, so this reads HEAD state directly). Throws on
// any surprise; the orchestrator fails OPEN to every target.
async function addPatchReasons(options: {
  patchPaths: readonly string[];
  repoRoot: string;
  packages: ReadonlyMap<string, WorkspacePackage>;
  reasons: Map<string, string[]>;
  inputs: SelectorInputs | undefined;
}): Promise<void> {
  const { patchPaths, repoRoot, packages, reasons, inputs } = options;
  const manifestHead =
    inputs?.rootPackageJson?.head ??
    (await Bun.file(`${repoRoot}/package.json`).text());
  const lockHead =
    inputs?.lockfiles?.head ?? (await Bun.file(`${repoRoot}/bun.lock`).text());
  const lock = parseLockfile(lockHead);
  const closureIds = new Map<string, Set<string>>();
  for (const [target, owner] of Object.entries(IMAGE_TARGET_OWNERS)) {
    const dirs = targetClosureDirs(target, owner, packages);
    const ids = closurePackageIds(dirs, lock);
    if (ids === null) {
      throw new Error(`closure dirs missing from lockfile for ${target}`);
    }
    closureIds.set(target, ids);
  }
  for (const path of patchPaths) {
    const key = patchedDependencyKey(path, manifestHead);
    if (key === null) {
      throw new Error(`no patchedDependencies entry for ${path}`);
    }
    for (const [target, ids] of closureIds) {
      if (ids.has(key)) {
        addReason(
          reasons,
          target,
          `patched dependency ${key} (${path}) in closure`,
        );
      }
    }
  }
}

// Attribute the lockfile diff to image closures via resolved-dependency
// fingerprints. Throws on any surprise (schema drift, unreadable base,
// resolution miss); the orchestrator fails OPEN to every target — selection
// can only save work, never omit a required image.
function addLockfileReasons(
  packages: ReadonlyMap<string, WorkspacePackage>,
  reasons: Map<string, string[]>,
  inputs?: SelectorInputs,
): void {
  if (inputs?.lockfiles === undefined) {
    throw new Error("bun.lock changed but no lockfile contents provided");
  }
  for (const target of lockfileChangedTargets(inputs.lockfiles, packages)) {
    addReason(
      reasons,
      target,
      "resolved dependency closure changed in bun.lock",
    );
  }
}

function selectedResult(
  changedPaths: readonly string[],
  reasons: ReadonlyMap<string, string[]>,
): SelectionResult {
  const targets = [...reasons.keys()].sort();
  return {
    targets,
    report: {
      base: null,
      changedPaths: [...changedPaths],
      mode: "selected",
      globalReason: null,
      targets: Object.fromEntries(
        targets.map((target) => {
          const targetReasons = reasons.get(target);
          if (targetReasons === undefined) {
            throw new Error(`missing reasons for selected target ${target}`);
          }
          return [target, targetReasons];
        }),
      ),
    },
  };
}

function failOpenMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function selectImageTargetsWithReasons(
  changedPaths: readonly string[],
  repoRoot = process.cwd(),
  inputs?: SelectorInputs,
): Promise<SelectionResult> {
  const globalReason = globalInputReason(changedPaths);
  if (globalReason !== null) {
    return allTargetsResult(changedPaths, globalReason);
  }

  const manifestReason = manifestGlobalReason(changedPaths, inputs);
  if (manifestReason !== null) {
    return allTargetsResult(changedPaths, manifestReason);
  }

  const packages = await loadWorkspaces(repoRoot);
  const reasons = new Map<string, string[]>();
  addClosureReasons(changedPaths, packages, reasons);
  addPrefixReasons(changedPaths, reasons);
  addSharedApplicationReasons(changedPaths, reasons);

  const patchPaths = changedPaths.filter((path) => path.startsWith("patches/"));
  if (patchPaths.length > 0) {
    try {
      await addPatchReasons({
        patchPaths,
        repoRoot,
        packages,
        reasons,
        inputs,
      });
    } catch (error) {
      const message = failOpenMessage(error);
      console.error(
        `select-image-targets: patch attribution failed (${message}); selecting ALL targets`,
      );
      return allTargetsResult(
        changedPaths,
        `patch attribution failed (${message}); fail-open`,
      );
    }
  }

  if (changedPaths.includes("bun.lock")) {
    try {
      addLockfileReasons(packages, reasons, inputs);
    } catch (error) {
      const message = failOpenMessage(error);
      console.error(
        `select-image-targets: lockfile attribution failed (${message}); selecting ALL targets`,
      );
      return allTargetsResult(
        changedPaths,
        `lockfile attribution failed (${message}); fail-open`,
      );
    }
  }

  return selectedResult(changedPaths, reasons);
}

export async function selectImageTargets(
  changedPaths: readonly string[],
  repoRoot = process.cwd(),
  inputs?: SelectorInputs,
): Promise<string[]> {
  const { targets } = await selectImageTargetsWithReasons(
    changedPaths,
    repoRoot,
    inputs,
  );
  return targets;
}

export async function changedPathsSince(
  base: string,
  repoRoot = process.cwd(),
): Promise<string[]> {
  const proc = Bun.spawn(
    ["git", "diff", "--no-renames", "--name-only", "-z", base, "HEAD"],
    {
      cwd: repoRoot,
      stdout: "pipe",
      stderr: "inherit",
    },
  );
  const stdout = await new Response(proc.stdout).text();
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    throw new Error(`git diff failed with exit code ${exitCode.toString()}`);
  }
  return stdout.split("\0").filter((path) => path.length > 0);
}

async function baseFile(
  base: string,
  path: string,
  repoRoot = process.cwd(),
): Promise<string | null> {
  const proc = Bun.spawn(["git", "show", `${base}:${path}`], {
    cwd: repoRoot,
    stdout: "pipe",
    stderr: "inherit",
  });
  const stdout = await new Response(proc.stdout).text();
  const exitCode = await proc.exited;
  if (exitCode !== 0) return null;
  return stdout;
}

async function changedFilePair(base: string, path: string): Promise<FilePair> {
  return {
    base: await baseFile(base, path),
    head: await Bun.file(path).text(),
  };
}

async function main(): Promise<void> {
  const baseFlag = Bun.argv.indexOf("--base");
  const base = baseFlag === -1 ? undefined : Bun.argv[baseFlag + 1];
  if (base === undefined || base === "") {
    console.error(
      "Usage: select-image-targets.ts --base <git-ref> [--reasons-out <file>]",
    );
    process.exit(2);
  }
  // Justification side channel: stdout is a strict one-line JSON-array
  // contract (bake-images.ts jq-validates it; ci-changed.ts string-compares
  // it), so the per-target reasons report goes to a file instead.
  const reasonsFlag = Bun.argv.indexOf("--reasons-out");
  const reasonsOut = reasonsFlag === -1 ? undefined : Bun.argv[reasonsFlag + 1];
  if (reasonsFlag !== -1 && (reasonsOut === undefined || reasonsOut === "")) {
    console.error("--reasons-out requires a file path");
    process.exit(2);
  }
  const changedPaths = await changedPathsSince(base);
  const inputs: SelectorInputs = {};
  if (changedPaths.includes("bun.lock")) {
    inputs.lockfiles = await changedFilePair(base, "bun.lock");
  }
  if (changedPaths.includes("package.json")) {
    inputs.rootPackageJson = await changedFilePair(base, "package.json");
  }
  if (changedPaths.includes("scripts/package.json")) {
    inputs.scriptsPackageJson = await changedFilePair(
      base,
      "scripts/package.json",
    );
  }
  const { targets, report } = await selectImageTargetsWithReasons(
    changedPaths,
    process.cwd(),
    inputs,
  );
  if (reasonsOut !== undefined) {
    await Bun.write(reasonsOut, JSON.stringify({ ...report, base }, null, 2));
  }
  console.log(JSON.stringify(targets));
}

if (import.meta.main) {
  await main();
}
