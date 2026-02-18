/**
 * Shared monorepo workspace setup for oven/bun:*-debian based containers.
 *
 * Used by both index.ts (main CI) and birmel.ts (birmel CI + image publishing).
 * Consolidates the common patterns: base container setup, workspace dependency
 * installation with 4-phase layer ordering, and mount/copy abstraction.
 */
import type { Container, Directory } from "@dagger.io/dagger";
import { dag } from "@dagger.io/dagger";
import versions from "./lib-versions.ts";

const BUN_VERSION = versions.bun;
const PLAYWRIGHT_VERSION = versions.playwright;

/**
 * Configuration for the base bun-debian container.
 */
export type BaseContainerConfig = {
  /** Extra APT packages to install beyond python3 (e.g., ["ffmpeg", "make", "g++"]) */
  extraAptPackages?: string[];
  /** Extra setup steps applied after APT install but before caches */
  postAptSetup?: (container: Container) => Container;
};

/**
 * Creates a base oven/bun container with system dependencies and caching.
 * LAYER ORDERING: System deps and caches are set up BEFORE any source files.
 *
 * Includes: APT caching, python3, bun cache, playwright + chromium,
 * eslint cache, and TypeScript build cache.
 *
 * @param config Optional configuration for extra packages and setup steps
 * @returns A configured base container
 */
export function getBaseBunDebianContainer(
  config?: BaseContainerConfig,
): Container {
  const aptPackages = ["python3", ...(config?.extraAptPackages ?? [])];

  let container = dag
    .container()
    .from(`oven/bun:${BUN_VERSION}-debian`)
    // Cache APT packages (version in key for invalidation on upgrade)
    .withMountedCache(
      "/var/cache/apt",
      dag.cacheVolume(`apt-cache-bun-${BUN_VERSION}-debian`),
    )
    .withMountedCache(
      "/var/lib/apt",
      dag.cacheVolume(`apt-lib-bun-${BUN_VERSION}-debian`),
    )
    .withExec(["apt-get", "update"])
    .withExec(["apt-get", "install", "-y", ...aptPackages]);

  // Apply post-APT setup (e.g., install gh CLI, Claude CLI)
  if (config?.postAptSetup) {
    container = config.postAptSetup(container);
  }

  return (
    container
      // Cache Bun packages
      .withMountedCache(
        "/root/.bun/install/cache",
        dag.cacheVolume("bun-cache"),
      )
      // Cache Playwright browsers (version in key for invalidation)
      .withMountedCache(
        "/root/.cache/ms-playwright",
        dag.cacheVolume(`playwright-browsers-${PLAYWRIGHT_VERSION}`),
      )
      // Install Playwright Chromium and dependencies for browser automation
      .withExec(["bunx", "playwright", "install", "--with-deps", "chromium"])
      // Cache ESLint (incremental linting)
      .withMountedCache(
        "/workspace/.eslintcache",
        dag.cacheVolume("eslint-cache"),
      )
      // Cache TypeScript incremental build
      .withMountedCache(
        "/workspace/.tsbuildinfo",
        dag.cacheVolume("tsbuildinfo-cache"),
      )
  );
}

/**
 * A workspace entry for dependency installation.
 *
 * Simple string entries represent a workspace path that needs:
 * - PHASE 1: package.json copied
 * - PHASE 3: full directory mounted/copied
 *
 * Object entries allow fine-grained control over each phase.
 */
export type WorkspaceEntry =
  | string
  | {
      /** The workspace path relative to repo root */
      path: string;
      /** Sub-package paths relative to repo root (for nested workspaces) */
      subPackages?: string[];
      /** Extra files to copy in PHASE 1 (e.g., "packages/clauderon/web/bun.lock") */
      extraFiles?: string[];
      /** If true, mount/copy the full directory in PHASE 1 instead of just package.json */
      fullDirPhase1?: boolean;
      /** If true, only include in PHASE 1 (deps resolution), skip PHASE 3 (source) */
      depsOnly?: boolean;
    };

/**
 * Configuration for workspace dependency installation.
 */
export type InstallWorkspaceDepsConfig = {
  /** The base container (from getBaseBunDebianContainer) */
  baseContainer: Container;
  /** The full workspace source directory */
  source: Directory;
  /** Whether to use mounts (true for CI) or copies (false for image publishing) */
  useMounts: boolean;
  /** Workspace entries to install */
  workspaces: WorkspaceEntry[];
  /** Extra root-level config files to include in PHASE 3 (e.g., "tsconfig.base.json") */
  rootConfigFiles?: string[];
};

type NormalizedEntry = {
  path: string;
  subPackages: string[];
  extraFiles: string[];
  fullDirPhase1: boolean;
  depsOnly: boolean;
};

/**
 * Helper to normalize a WorkspaceEntry to the object form.
 */
function normalizeEntry(entry: WorkspaceEntry): NormalizedEntry {
  if (typeof entry === "string") {
    return {
      path: entry,
      subPackages: [],
      extraFiles: [],
      fullDirPhase1: false,
      depsOnly: false,
    };
  }
  return {
    path: entry.path,
    subPackages: entry.subPackages ?? [],
    extraFiles: entry.extraFiles ?? [],
    fullDirPhase1: entry.fullDirPhase1 ?? false,
    depsOnly: entry.depsOnly ?? false,
  };
}

/**
 * Install workspace dependencies with optimal layer ordering.
 *
 * PHASE 1: Copy only dependency files (package.json, bun.lock)
 * PHASE 2: Run bun install (cached if lockfile unchanged)
 * PHASE 3: Copy config files and source code (changes frequently)
 * PHASE 4: Re-run bun install to recreate workspace node_modules symlinks
 *
 * Supports both mounted directories (for CI) and copied files (for image publishing).
 *
 * @param config Configuration for workspace setup
 * @returns Container with deps installed
 */
export function installMonorepoWorkspaceDeps(
  config: InstallWorkspaceDepsConfig,
): Container {
  const { baseContainer, source, useMounts, workspaces, rootConfigFiles = [] } =
    config;

  const addFile = useMounts
    ? (c: Container, path: string) =>
        c.withMountedFile(`/workspace/${path}`, source.file(path))
    : (c: Container, path: string) =>
        c.withFile(`/workspace/${path}`, source.file(path));

  const addDir = useMounts
    ? (c: Container, path: string) =>
        c.withMountedDirectory(`/workspace/${path}`, source.directory(path))
    : (c: Container, path: string) =>
        c.withDirectory(`/workspace/${path}`, source.directory(path));

  let container = baseContainer.withWorkdir("/workspace");

  // PHASE 1: Dependency files only (cached if lockfile unchanged)
  container = addFile(container, "package.json");
  container = addFile(container, "bun.lock");

  for (const entry of workspaces) {
    const { path, subPackages, extraFiles, fullDirPhase1 } =
      normalizeEntry(entry);

    if (fullDirPhase1) {
      // Some workspaces need full directory in PHASE 1 (e.g., clauderon/docs)
      if (useMounts) {
        container = container.withExec(["mkdir", "-p", `/workspace/${path}`]);
      }
      container = addDir(container, path);
    } else {
      container = addFile(container, `${path}/package.json`);
    }

    // Copy extra files (e.g., nested bun.lock)
    for (const file of extraFiles) {
      container = addFile(container, file);
    }

    // Copy sub-package package.json files
    for (const subPkg of subPackages) {
      container = addFile(container, `${subPkg}/package.json`);
    }
  }

  // PHASE 2: Install dependencies (cached if lockfile + package.jsons unchanged)
  container = container.withExec(["bun", "install", "--frozen-lockfile"]);

  // PHASE 3: Config files and source code (changes frequently, added AFTER install)
  for (const configFile of rootConfigFiles) {
    container = addFile(container, configFile);
  }

  for (const entry of workspaces) {
    const { path, fullDirPhase1, depsOnly } = normalizeEntry(entry);
    // Skip workspaces that are deps-only or fully mounted in PHASE 1
    if (depsOnly || fullDirPhase1) {continue;}
    container = addDir(container, path);
  }

  // PHASE 4: Re-run bun install to recreate workspace node_modules symlinks
  // (Source mounts/copies in Phase 3 replace the symlinks that Phase 2 created)
  container = container.withExec(["bun", "install", "--frozen-lockfile"]);

  return container;
}
