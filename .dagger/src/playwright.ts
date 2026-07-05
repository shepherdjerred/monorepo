/**
 * Playwright test helper functions.
 *
 * These are plain functions (not decorated) — the @func() wrappers live in index.ts.
 */
import { dag, Container, Directory, File } from "@dagger.io/dagger";

import {
  PLAYWRIGHT_IMAGE,
  BUN_VERSION,
  SOURCE_EXCLUDES,
  BUN_CACHE,
} from "./constants";

import { BUILD_TIME_DEPS } from "./deps";
import { bunInstallWithRetry, workspaceMeta } from "./base";

/**
 * Shared Playwright container setup: PLAYWRIGHT_IMAGE + bun install + deps.
 * Returns a container ready for the divergent test/update steps.
 */
function requireRepoRoot(repoRoot: Directory | null, pkg: string): Directory {
  if (repoRoot === null) {
    throw new Error(
      `playwright(${pkg}): repoRoot is required since the bun-workspace migration`,
    );
  }
  return repoRoot;
}

function playwrightBaseContainer(
  pkgDir: Directory,
  pkg: string,
  depNames: string[] = [],
  depDirs: Directory[] = [],
  tsconfig: File | null = null,
  repoRoot: Directory | null = null,
): Container {
  let container = dag
    .container()
    .from(PLAYWRIGHT_IMAGE)
    .withExec(["apt-get", "update", "-qq"])
    .withExec([
      "apt-get",
      "install",
      "-y",
      "-qq",
      "--no-install-recommends",
      "unzip",
    ])
    .withExec([
      "bash",
      "-c",
      `curl -fsSL https://bun.sh/install | bash -s -- bun-v${BUN_VERSION}`,
    ])
    .withEnvVariable(
      "PATH",
      "/root/.bun/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
    )
    .withEnvVariable("CI", "true")
    .withMountedCache("/root/.bun/install/cache", dag.cacheVolume(BUN_CACHE))
    .withDirectory("/workspace", workspaceMeta(requireRepoRoot(repoRoot, pkg)))
    .withDirectory(`/workspace/packages/${pkg}`, pkgDir, {
      exclude: SOURCE_EXCLUDES,
    });

  // Mount deps at correct relative paths
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

  // One filtered install at the workspace root, then build-time deps' dist/.
  container = container
    .withWorkdir("/workspace")
    .withExec(["sh", "-c", bunInstallWithRetry([pkg, ...depNames])]);
  for (const dep of BUILD_TIME_DEPS) {
    if (depNames.includes(dep)) {
      container = container
        .withWorkdir(`/workspace/packages/${dep}`)
        .withExec(["bun", "run", "build"]);
    }
  }

  container = container.withWorkdir(`/workspace/packages/${pkg}`);

  return container;
}

/** Run Playwright tests headless in a container. */
export function playwrightTestHelper(
  pkgDir: Directory,
  pkg: string,
  depNames: string[] = [],
  depDirs: Directory[] = [],
  tsconfig: File | null = null,
  repoRoot: Directory | null = null,
): Container {
  return (
    playwrightBaseContainer(pkgDir, pkg, depNames, depDirs, tsconfig, repoRoot)
      // Build the site first — playwright tests run against astro preview which needs dist/
      .withExec(["bunx", "astro", "build"])
      .withExec(["bun", "run", "test"])
  );
}

/** Generate/update Playwright snapshot baselines. Returns the snapshots directory. */
export function playwrightUpdateHelper(
  pkgDir: Directory,
  pkg: string,
  depNames: string[] = [],
  depDirs: Directory[] = [],
  tsconfig: File | null = null,
  repoRoot: Directory | null = null,
): Directory {
  return playwrightBaseContainer(
    pkgDir,
    pkg,
    depNames,
    depDirs,
    tsconfig,
    repoRoot,
  )
    .withExec(["bunx", "astro", "build"])
    .withExec(["bunx", "playwright", "test", "--update-snapshots"])
    .directory(`/workspace/packages/${pkg}/test`);
}
