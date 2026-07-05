/**
 * TypeScript lint, typecheck, test, and generate helper functions.
 *
 * These are plain functions (not decorated) — the @func() wrappers live in index.ts.
 */
import { dag, Container, Directory, File, Secret } from "@dagger.io/dagger";

import { ESLINT_CACHE, HELM_IMAGE } from "./constants";

import { bunBaseContainer } from "./base";
import { runBundle } from "./bundle";
import { astroCheckHelper, astroBuildContainerHelper } from "./astro";

/** Run the lint script on a bun container. */
export function lintHelper(
  pkgDir: Directory,
  pkg: string,
  depNames: string[] = [],
  depDirs: Directory[] = [],
  tsconfig: File | null = null,
  repoRoot: Directory | null = null,
): Container {
  return bunBaseContainer(pkgDir, pkg, depNames, depDirs, tsconfig, [], repoRoot)
    .withMountedCache(
      `/workspace/packages/${pkg}/.eslintcache`,
      dag.cacheVolume(ESLINT_CACHE),
    )
    .withExec(["bun", "run", "lint"]);
}

/** Run the typecheck script on a bun container. */
export function typecheckHelper(
  pkgDir: Directory,
  pkg: string,
  depNames: string[] = [],
  depDirs: Directory[] = [],
  tsconfig: File | null = null,
  repoRoot: Directory | null = null,
): Container {
  return bunBaseContainer(pkgDir, pkg, depNames, depDirs, tsconfig, [], repoRoot).withExec([
    "bun",
    "run",
    "typecheck",
  ]);
}

/** Run the build script on a bun container (validates compilation). */
export function buildHelper(
  pkgDir: Directory,
  pkg: string,
  depNames: string[] = [],
  depDirs: Directory[] = [],
  tsconfig: File | null = null,
  repoRoot: Directory | null = null,
): Container {
  return bunBaseContainer(pkgDir, pkg, depNames, depDirs, tsconfig, [], repoRoot).withExec([
    "bun",
    "run",
    "build",
  ]);
}

/** Run the test script on a bun container. */
export function testHelper(
  pkgDir: Directory,
  pkg: string,
  depNames: string[] = [],
  depDirs: Directory[] = [],
  tsconfig: File | null = null,
  needsHelm = false,
  repoRoot: Directory | null = null,
): Container {
  let container = bunBaseContainer(
    pkgDir,
    pkg,
    depNames,
    depDirs,
    tsconfig,
    [],
    repoRoot,
  ).withEnvVariable("CI", "true");
  if (needsHelm) {
    const helmBinary = dag.container().from(HELM_IMAGE).file("/usr/bin/helm");
    container = container.withFile("/usr/local/bin/helm", helmBinary);
  }
  return container.withExec(["bun", "run", "test"]);
}

/** Run bun run generate and return the container (for chaining lint/typecheck/test). */
export function generateContainer(
  pkgDir: Directory,
  pkg: string,
  depNames: string[] = [],
  depDirs: Directory[] = [],
  tsconfig: File | null = null,
  repoRoot: Directory | null = null,
): Container {
  return bunBaseContainer(pkgDir, pkg, depNames, depDirs, tsconfig, [], repoRoot)
    .withWorkdir(`/workspace/packages/${pkg}`)
    .withExec(["bun", "run", "generate"]);
}

/**
 * Run bun run generate with Home Assistant secrets injected. Used by temporal,
 * whose generate script invokes `ha-codegen` against a live HA instance to
 * materialize the typed schema before typecheck. Secrets are optional so local
 * `dagger call` invocations without HA credentials fall back to the committed
 * stub via `scripts/ensure-ha-schema.ts`.
 */
export function generateContainerWithSecrets(
  pkgDir: Directory,
  pkg: string,
  depNames: string[] = [],
  depDirs: Directory[] = [],
  tsconfig: File | null = null,
  haUrl: Secret | null = null,
  haToken: Secret | null = null,
  repoRoot: Directory | null = null,
): Container {
  let container = bunBaseContainer(
    pkgDir,
    pkg,
    depNames,
    depDirs,
    tsconfig,
    [],
    repoRoot,
  ).withWorkdir(`/workspace/packages/${pkg}`);
  if (haUrl !== null) {
    container = container.withSecretVariable("HA_URL", haUrl);
  }
  if (haToken !== null) {
    container = container.withSecretVariable("HA_TOKEN", haToken);
  }
  return container.withExec(["bun", "run", "generate"]);
}

/** Generate with HA secrets, then typecheck on the same container. */
export function generateAndTypecheckWithSecretsHelper(
  pkgDir: Directory,
  pkg: string,
  depNames: string[] = [],
  depDirs: Directory[] = [],
  tsconfig: File | null = null,
  haUrl: Secret | null = null,
  haToken: Secret | null = null,
  repoRoot: Directory | null = null,
): Container {
  return generateContainerWithSecrets(
    pkgDir,
    pkg,
    depNames,
    depDirs,
    tsconfig,
    haUrl,
    haToken,
    repoRoot,
  ).withExec(["bun", "run", "typecheck"]);
}

/** Generate then lint — chains on the same container to avoid SIGILL from bun install in fresh containers. */
export function generateAndLintHelper(
  pkgDir: Directory,
  pkg: string,
  depNames: string[] = [],
  depDirs: Directory[] = [],
  tsconfig: File | null = null,
  repoRoot: Directory | null = null,
): Container {
  return generateContainer(pkgDir, pkg, depNames, depDirs, tsconfig, repoRoot)
    .withMountedCache(
      `/workspace/packages/${pkg}/.eslintcache`,
      dag.cacheVolume(ESLINT_CACHE),
    )
    .withExec(["bun", "run", "lint"]);
}

/** Generate then typecheck — chains on the same container. */
export function generateAndTypecheckHelper(
  pkgDir: Directory,
  pkg: string,
  depNames: string[] = [],
  depDirs: Directory[] = [],
  tsconfig: File | null = null,
  repoRoot: Directory | null = null,
): Container {
  return generateContainer(pkgDir, pkg, depNames, depDirs, tsconfig, repoRoot).withExec([
    "bun",
    "run",
    "typecheck",
  ]);
}

/** Generate then test — chains on the same container. */
export function generateAndTestHelper(
  pkgDir: Directory,
  pkg: string,
  depNames: string[] = [],
  depDirs: Directory[] = [],
  tsconfig: File | null = null,
  repoRoot: Directory | null = null,
): Container {
  return generateContainer(pkgDir, pkg, depNames, depDirs, tsconfig, repoRoot).withExec([
    "bun",
    "run",
    "test",
  ]);
}

/**
 * Run lint, typecheck, and test in parallel via the engine. Three sibling
 * containers share their `bunBaseContainer` prefix by content-address, so
 * the install layer is materialised once and reused. Replaces three separate
 * BK steps with a single bundled step.
 *
 * `haUrl` / `haToken`: when set, the typecheck sibling uses
 * `generateAndTypecheckWithSecretsHelper` (temporal: runs ha-codegen against a
 * live Home Assistant instance before tsc). Without them, plain typecheck.
 *
 * `includeAstroCheck` / `includeAstroBuild`: when set, astro check / build
 * run as additional parallel siblings (sjer.red, cooklang-rich-preview).
 * `includeBuild`: when set, `bun run build` runs as a parallel sibling
 * (NPM_BUILD_PACKAGES — astro-opengraph-images, webring).
 */
export async function lintTypecheckTestHelper(
  pkgDir: Directory,
  pkg: string,
  depNames: string[] = [],
  depDirs: Directory[] = [],
  tsconfig: File | null = null,
  needsHelm = false,
  haUrl: Secret | null = null,
  haToken: Secret | null = null,
  includeAstroCheck = false,
  includeAstroBuild = false,
  includeBuild = false,
  skipTest = false,
  repoRoot: Directory | null = null,
): Promise<string> {
  const useTypecheckSecrets = haUrl !== null || haToken !== null;
  const children: { name: string; run: () => Promise<string> }[] = [
    {
      name: "lint",
      run: () => lintHelper(pkgDir, pkg, depNames, depDirs, tsconfig, repoRoot).stdout(),
    },
    {
      name: "typecheck",
      run: () =>
        useTypecheckSecrets
          ? generateAndTypecheckWithSecretsHelper(
              pkgDir,
              pkg,
              depNames,
              depDirs,
              tsconfig,
              haUrl,
              haToken,
              repoRoot,
            ).stdout()
          : typecheckHelper(pkgDir, pkg, depNames, depDirs, tsconfig, repoRoot).stdout(),
    },
  ];
  if (!skipTest) {
    // PLAYWRIGHT_PACKAGES (sjer.red) override `bun run test` to
    // `bun run build && bunx playwright test`, which needs a Playwright
    // browser install — separate from this bun-base bundle. For those
    // packages, the dedicated `playwright-test-<pkg>` BK step covers test.
    children.push({
      name: "test",
      run: () =>
        testHelper(
          pkgDir,
          pkg,
          depNames,
          depDirs,
          tsconfig,
          needsHelm,
          repoRoot,
        ).stdout(),
    });
  }
  if (includeAstroCheck) {
    children.push({
      name: "astro-check",
      run: () =>
        astroCheckHelper(pkgDir, pkg, depNames, depDirs, tsconfig, repoRoot).stdout(),
    });
  }
  if (includeAstroBuild) {
    children.push({
      name: "astro-build",
      run: () =>
        astroBuildContainerHelper(
          pkgDir,
          pkg,
          depNames,
          depDirs,
          tsconfig,
          repoRoot,
        ).stdout(),
    });
  }
  if (includeBuild) {
    children.push({
      name: "build",
      run: () => buildHelper(pkgDir, pkg, depNames, depDirs, tsconfig, repoRoot).stdout(),
    });
  }
  return runBundle(children);
}

/**
 * Prisma variant of {@link lintTypecheckTestHelper}: each sibling does
 * `bun run generate` first (against the materialised package) before its
 * action. The generate container chain is content-addressed identically for
 * all three siblings, so the engine reuses one generate result.
 */
export async function generateAndLintTypecheckTestHelper(
  pkgDir: Directory,
  pkg: string,
  depNames: string[] = [],
  depDirs: Directory[] = [],
  tsconfig: File | null = null,
  repoRoot: Directory | null = null,
): Promise<string> {
  return runBundle([
    {
      name: "lint",
      run: () =>
        generateAndLintHelper(
          pkgDir,
          pkg,
          depNames,
          depDirs,
          tsconfig,
          repoRoot,
        ).stdout(),
    },
    {
      name: "typecheck",
      run: () =>
        generateAndTypecheckHelper(
          pkgDir,
          pkg,
          depNames,
          depDirs,
          tsconfig,
          repoRoot,
        ).stdout(),
    },
    {
      name: "test",
      run: () =>
        generateAndTestHelper(
          pkgDir,
          pkg,
          depNames,
          depDirs,
          tsconfig,
          repoRoot,
        ).stdout(),
    },
  ]);
}
