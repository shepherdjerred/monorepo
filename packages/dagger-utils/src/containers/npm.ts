import { dag, type Container, type Directory, type Secret } from "@dagger.io/dagger";
import versions from "../versions";

export type NpmPublishOptions = {
  /** The container with the built package */
  container: Container;
  /** NPM auth token as a secret */
  token: Secret;
  /** Package directory (defaults to current workdir) */
  packageDir?: string;
  /** NPM registry URL (defaults to https://registry.npmjs.org) */
  registry?: string;
  /** Access level for scoped packages */
  access?: "public" | "restricted";
  /** Tag to publish under (defaults to "latest") */
  tag?: string;
  /** Dry run (don't actually publish) */
  dryRun?: boolean;
};

/**
 * Returns a Bun container configured with npm caches for faster installs.
 *
 * @param source - The source directory to mount
 * @param customVersion - Optional custom Bun version
 * @returns A configured container with Bun and caches mounted
 */
export function getBunContainerWithCache(source: Directory, customVersion?: string): Container {
  const version = customVersion ?? versions["oven/bun"];
  return dag
    .container()
    .from(`oven/bun:${version}`)
    .withWorkdir("/workspace")
    .withMountedCache("/root/.bun/install/cache", dag.cacheVolume("bun-cache"))
    .withMountedDirectory("/workspace", source);
}

/**
 * Installs dependencies using Bun with frozen lockfile.
 *
 * @param container - Container with source mounted
 * @returns Container with dependencies installed
 */
export function withBunInstall(container: Container): Container {
  return container.withExec(["bun", "install", "--frozen-lockfile"]);
}

/**
 * Publishes a package to NPM registry.
 *
 * @param options - Publish configuration options
 * @returns The container after publishing
 *
 * @example
 * ```ts
 * await publishToNpm({
 *   container: builtContainer,
 *   token: dag.setSecret("npm-token", process.env.NPM_TOKEN),
 *   access: "public",
 * });
 * ```
 */
export async function publishToNpm(options: NpmPublishOptions): Promise<string> {
  const registry = options.registry ?? "https://registry.npmjs.org";
  const access = options.access ?? "public";
  const tag = options.tag ?? "latest";
  const packageDir = options.packageDir ?? ".";

  const publishArgs = ["bun", "publish", "--access", access, "--tag", tag, "--registry", registry];

  if (options.dryRun) {
    publishArgs.push("--dry-run");
  }

  // Extract the registry host for the npmrc auth configuration
  const registryHost = new URL(registry).host;

  // bun publish must be run from within the package directory
  const result = await options.container
    .withWorkdir(packageDir)
    .withSecretVariable("NPM_TOKEN", options.token)
    .withExec(["sh", "-c", `echo "//${registryHost}/:_authToken=\${NPM_TOKEN}" > ~/.npmrc`])
    .withExec(publishArgs)
    .stdout();

  return result;
}

export type BunWorkspaceCIOptions = {
  /** Source directory containing the workspace */
  source: Directory;
  /** Whether to run typecheck (defaults to true) */
  typecheck?: boolean;
  /** Whether to run lint (defaults to true) */
  lint?: boolean;
  /** Whether to run tests (defaults to true) */
  test?: boolean;
  /** Whether to run build (defaults to true) */
  build?: boolean;
  /** Custom Bun version */
  bunVersion?: string;
};

export type BunWorkspaceCIResult = {
  /** Whether CI passed */
  success: boolean;
  /** Container after all CI steps */
  container: Container;
  /** Individual step results */
  steps: {
    install: boolean;
    typecheck?: boolean;
    lint?: boolean;
    test?: boolean;
    build?: boolean;
  };
};

/**
 * Runs a complete CI pipeline for a Bun workspace.
 * Includes: install, typecheck, lint, test, build
 *
 * @param options - CI configuration options
 * @returns Result with success status and container
 *
 * @example
 * ```ts
 * const result = await runBunWorkspaceCI({
 *   source: dag.host().directory("."),
 * });
 * if (!result.success) {
 *   throw new Error("CI failed");
 * }
 * ```
 */
export async function runBunWorkspaceCI(options: BunWorkspaceCIOptions): Promise<BunWorkspaceCIResult> {
  const { source, typecheck = true, lint = true, test = true, build = true, bunVersion } = options;

  const steps: BunWorkspaceCIResult["steps"] = {
    install: false,
  };

  let container = getBunContainerWithCache(source, bunVersion);

  // Install
  container = withBunInstall(container);
  await container.sync();
  steps.install = true;

  // Typecheck
  if (typecheck) {
    container = container.withExec(["bun", "run", "typecheck"]);
    await container.sync();
    steps.typecheck = true;
  }

  // Lint
  if (lint) {
    container = container.withExec(["bun", "run", "lint"]);
    await container.sync();
    steps.lint = true;
  }

  // Test
  if (test) {
    container = container.withExec(["bun", "run", "test"]);
    await container.sync();
    steps.test = true;
  }

  // Build
  if (build) {
    container = container.withExec(["bun", "run", "build"]);
    await container.sync();
    steps.build = true;
  }

  return {
    success: true,
    container,
    steps,
  };
}
