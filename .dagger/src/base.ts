/**
 * Base container builder functions for Bun, Rust, and Go.
 *
 * These are plain functions (not decorated) — the @func() wrappers live in index.ts.
 */
import { dag, Container, Directory, File } from "@dagger.io/dagger";

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
  for (let i = 0; i < depNames.length; i++) {
    container = container.withDirectory(
      `/workspace/packages/${depNames[i]}`,
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
        .withExec(["bun", "install", "--frozen-lockfile"])
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
      .withExec(["bun", "install", "--frozen-lockfile"]);
  }

  container = container
    .withWorkdir(`/workspace/packages/${pkg}`)
    .withExec(["bun", "install", "--frozen-lockfile"]);

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
