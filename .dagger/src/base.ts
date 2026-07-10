/**
 * Base container builder functions for Bun, Rust, and Go.
 *
 * These are plain functions (not decorated) — the @func() wrappers live in index.ts.
 */
import type { Container, Directory, File } from "@dagger.io/dagger";
import { dag } from "@dagger.io/dagger";

import {
  BUN_IMAGE,
  RUST_IMAGE,
  GO_IMAGE,
  SOURCE_EXCLUDES,
  BUN_CACHE,
  CARGO_REGISTRY,
  CARGO_TARGET,
  GO_MOD,
  GO_BUILD,
} from "./constants";

import { BUILD_TIME_DEPS } from "./deps";

/**
 * `bun install --frozen-lockfile` wrapped in a 3-attempt retry. Four recurring
 * flakes motivate this:
 *   - Intermittent EEXIST on `file:` symlink creation when many nested workspace
 *     members reference the same local dep (build-discord-plays-pokemon, #4336).
 *   - Re-running install in a child workdir of a workspace that already linked
 *     the same `file:` dep at the root level — bun then tries to re-link an
 *     already-linked path and fails with EEXIST (`pkg-check` for
 *     discord-plays-pokemon hit this on 4398 even though 4393 of the same branch
 *     passed; deterministic-on-its-own, races against itself across siblings).
 *   - Transient npm-CDN tarball-extract failures (build-temporal-worker, #4336
 *     hit `Fail extracting tarball for "firebase"`).
 *   - Postinstall network flakes — e.g. `@lng2004/node-datachannel`'s
 *     `prebuild-install` timing out and falling back to a `npm`-driven source
 *     build that can't run (no npm in oven/bun image), exit 127 (#4359 main).
 * Retry is safe under the hoisted linker: `bun install --frozen-lockfile`
 * converges when re-run on a partial node_modules (it completes missing
 * entries from the shared install cache). Do NOT add cleanup (rm -rf
 * node_modules) between attempts: it was tried on 2026-07-04 and removed —
 * when an install runs in a workspace *member* dir, the cleanup deletes
 * state the retry does not rebuild (build 5029 produced a dpmk image missing
 * its file: deps; only the smoke test caught it). The isolated-linker EEXIST
 * that made retries replay a poisoned tree is instead fixed at the root by
 * the `linker = "hoisted"` bunfig pins in the nested-workspace packages.
 * Join with newlines, not "; " — busybox sh rejects `do ;` / `then ;` / `done ;`.
 */
export const BUN_INSTALL_WITH_RETRY = [
  "i=1",
  "while [ $i -le 3 ]; do",
  "  if bun install --frozen-lockfile; then exit 0; fi",
  // Skip the sleep + "retrying" log on the final attempt — no retry follows.
  "  if [ $i -lt 3 ]; then",
  '    echo "bun install failed (attempt $i/3), retrying in $((i*5))s..." >&2',
  "    sleep $((i*5))",
  "  fi",
  "  i=$((i+1))",
  "done",
  "exit 1",
].join("\n");

/**
 * Bun container with dependencies installed from individual directory params.
 * Each directory is passed separately for optimal Dagger caching.
 */
export function bunBaseContainer(
  pkgDir: Directory,
  pkg: string,
  depNames: string[] = [],
  depDirs: Directory[] = [],
  tsconfig: File | null = null,
  extraAptPackages: string[] = [],
): Container {
  let container = dag
    .container()
    .from(BUN_IMAGE)
    .withExec(["apt-get", "update", "-qq"])
    .withExec([
      "apt-get",
      "install",
      "-y",
      "-qq",
      "--no-install-recommends",
      "ca-certificates",
      "zstd",
      "python3",
      "python3-setuptools",
      "make",
      "g++",
      ...extraAptPackages,
    ])

    .withMountedCache("/root/.bun/install/cache", dag.cacheVolume(BUN_CACHE))
    .withWorkdir(`/workspace/packages/${pkg}`)
    .withDirectory(`/workspace/packages/${pkg}`, pkgDir, {
      exclude: SOURCE_EXCLUDES,
    });

  // Mount deps at correct relative paths for file: protocol resolution
  for (const [i, depName] of depNames.entries()) {
    container = container.withDirectory(
      `/workspace/packages/${depName}`,
      depDirs[i],
      { exclude: SOURCE_EXCLUDES },
    );
  }

  if (tsconfig != null) {
    container = container.withFile("/workspace/tsconfig.base.json", tsconfig);
  }

  // Install and build deps first so dist/ exists before target's install resolves file: refs
  for (const dep of BUILD_TIME_DEPS) {
    if (depNames.includes(dep)) {
      container = container
        .withWorkdir(`/workspace/packages/${dep}`)
        .withExec(["sh", "-c", BUN_INSTALL_WITH_RETRY])
        .withExec(["bun", "run", "build"]);
    }
  }
  // Non-build deps (e.g. @shepherdjerred/home-assistant) still need their own
  // node_modules so imports inside the dep (like zod) resolve when the target
  // compiles against it. Keep this loop separate from BUILD_TIME_DEPS so the
  // layer hashes for BUILD_TIME_DEPS-only consumers are unchanged and their
  // Dagger cache stays warm.
  for (const dep of depNames) {
    if (BUILD_TIME_DEPS.includes(dep)) {
      continue;
    }
    container = container
      .withWorkdir(`/workspace/packages/${dep}`)
      .withExec(["sh", "-c", BUN_INSTALL_WITH_RETRY]);
  }

  container = container
    .withWorkdir(`/workspace/packages/${pkg}`)
    .withExec(["sh", "-c", BUN_INSTALL_WITH_RETRY]);

  return container;
}

/**
 * Rust container with cargo caches and system deps (clang, openssl).
 */
export function rustBaseContainer(pkgDir: Directory): Container {
  return dag
    .container()
    .from(RUST_IMAGE)
    .withExec(["dpkg", "--add-architecture", "arm64"])
    .withExec(["apt-get", "update", "-qq"])
    .withExec([
      "apt-get",
      "install",
      "-y",
      "-qq",
      "clang",
      "libclang-dev",
      "pkg-config",
      "libssl-dev",
      "libssl-dev:arm64",
      "mold",
      "gcc-aarch64-linux-gnu",
    ])
    .withMountedCache(
      "/usr/local/cargo/registry",
      dag.cacheVolume(CARGO_REGISTRY),
    )
    .withMountedCache("/usr/local/cargo/git", dag.cacheVolume("cargo-git"))
    .withMountedCache("/workspace/target", dag.cacheVolume(CARGO_TARGET))
    .withWorkdir("/workspace")
    .withDirectory("/workspace", pkgDir, {
      exclude: ["target", "node_modules", ".git"],
    });
}

/**
 * Go container with module caches mounted.
 */
export function goBaseContainer(pkgDir: Directory): Container {
  return dag
    .container()
    .from(GO_IMAGE)
    .withMountedCache("/go/pkg/mod", dag.cacheVolume(GO_MOD))
    .withMountedCache("/root/.cache/go-build", dag.cacheVolume(GO_BUILD))
    .withWorkdir("/workspace")
    .withDirectory("/workspace", pkgDir, { exclude: [".git"] });
}
