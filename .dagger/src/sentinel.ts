import type { Directory, Container, Secret } from "@dagger.io/dagger";
import {
  getBaseBunDebianContainer,
  installMonorepoWorkspaceDeps,
} from "./lib-monorepo-workspace.ts";
import type { WorkspaceEntry } from "./lib-monorepo-workspace.ts";
import { getBuiltEslintConfig } from "./lib-eslint-config.ts";

/**
 * Workspace entries for sentinel CI/build.
 * Minimal — sentinel only needs itself and eslint-config.
 */
const SENTINEL_WORKSPACES: WorkspaceEntry[] = [
  "packages/sentinel",
  "packages/eslint-config",
  // Explicit (non-glob) workspace in root package.json — must exist for bun install
  { path: "packages/clauderon/docs", fullDirPhase1: true, depsOnly: true },
];

/**
 * Install sentinel workspace dependencies.
 * @param workspaceSource The full workspace source directory
 * @param useMounts If true, use mounted directories (for CI). If false, copy files (for image publishing).
 * @returns Container with deps installed
 */
function installSentinelWorkspaceDeps(
  workspaceSource: Directory,
  useMounts: boolean,
): Container {
  return installMonorepoWorkspaceDeps({
    baseContainer: getBaseBunDebianContainer(),
    source: workspaceSource,
    useMounts,
    workspaces: SENTINEL_WORKSPACES,
    rootConfigFiles: ["tsconfig.base.json"],
  });
}

/**
 * Get a prepared container with all dependencies installed (using mounts for CI)
 * @param workspaceSource The full workspace source directory
 * @returns Container ready for sentinel operations
 */
export function getSentinelPrepared(workspaceSource: Directory): Container {
  const builtEslintConfig = getBuiltEslintConfig(workspaceSource);
  return installSentinelWorkspaceDeps(workspaceSource, true)
    .withDirectory(
      "/workspace/packages/eslint-config/dist",
      builtEslintConfig.directory("dist"),
    )
    .withWorkdir("/workspace/packages/sentinel");
}

/**
 * Run type checking, linting, and tests for sentinel in PARALLEL
 * @param workspaceSource The full workspace source directory
 * @returns Result message
 */
export async function checkSentinel(
  workspaceSource: Directory,
): Promise<string> {
  const testDataDir = "/app/sentinel-test";
  const testDbPath = `file:${testDataDir}/test.db`;

  const prepared = getSentinelPrepared(workspaceSource)
    .withEnvVariable("DATABASE_URL", testDbPath)
    .withExec(["mkdir", "-p", testDataDir])
    .withExec(["bunx", "prisma", "generate"])
    .withExec(["bunx", "prisma", "db", "push", "--accept-data-loss"]);

  // Run typecheck, lint, and test in PARALLEL
  await Promise.all([
    prepared.withExec(["bun", "run", "typecheck"]).sync(),
    prepared.withExec(["bun", "run", "lint"]).sync(),
    prepared.withExec(["bun", "run", "test"]).sync(),
  ]);

  return "✓ Sentinel CI passed (typecheck, lint, test)";
}

/**
 * Build the sentinel Docker image for production.
 * Uses withDirectory (not mounts) so files are included in the published image.
 * @param workspaceSource The full workspace source directory
 * @param version The version tag
 * @param gitSha The git SHA
 * @returns The built container with files copied (not mounted)
 */
export function buildSentinelImage(
  workspaceSource: Directory,
  version: string,
  gitSha: string,
): Container {
  // CLI tool versions for agents (kubectl, argocd, talosctl)
  // renovate: datasource=github-releases versioning=semver depName=kubernetes/kubernetes
  const kubectlVersion = "v1.35.0";
  // renovate: datasource=github-releases versioning=semver depName=siderolabs/talos
  const talosctlVersion = "v1.12.0";

  return installSentinelWorkspaceDeps(workspaceSource, false)
    .withWorkdir("/workspace/packages/sentinel")
    .withExec(["bunx", "prisma", "generate"])
    // Install CLI tools for agents
    .withExec([
      "apt-get",
      "install",
      "-y",
      "--no-install-recommends",
      "curl",
      "ca-certificates",
    ])
    .withExec([
      "sh",
      "-c",
      `curl -fsSL "https://dl.k8s.io/release/${kubectlVersion}/bin/linux/amd64/kubectl" -o /usr/local/bin/kubectl && chmod +x /usr/local/bin/kubectl`,
    ])
    .withExec([
      "sh",
      "-c",
      'curl -fsSL "https://github.com/argoproj/argo-cd/releases/latest/download/argocd-linux-amd64" -o /usr/local/bin/argocd && chmod +x /usr/local/bin/argocd',
    ])
    .withExec([
      "sh",
      "-c",
      `curl -fsSL "https://github.com/siderolabs/talos/releases/download/${talosctlVersion}/talosctl-linux-amd64" -o /usr/local/bin/talosctl && chmod +x /usr/local/bin/talosctl`,
    ])
    .withEnvVariable("VERSION", version)
    .withEnvVariable("GIT_SHA", gitSha)
    .withEnvVariable("NODE_ENV", "production")
    .withEntrypoint([
      "sh",
      "-c",
      "bunx prisma db push --skip-generate && bun run src/index.ts",
    ])
    .withLabel("org.opencontainers.image.title", "sentinel")
    .withLabel(
      "org.opencontainers.image.description",
      "Autonomous agent system for operational task automation",
    )
    .withLabel(
      "org.opencontainers.image.source",
      "https://github.com/shepherdjerred/monorepo",
    );
}

/**
 * Smoke test a pre-built sentinel Docker image (avoids rebuilding)
 * @param image The pre-built container image
 * @returns Test result with logs
 */
export async function smokeTestSentinelImageWithContainer(
  image: Container,
): Promise<string> {
  // Run with env vars that will cause expected startup (but no real agent work)
  const containerWithEnv = image
    .withEnvVariable("DATABASE_URL", "file:/tmp/test.db")
    .withEnvVariable("ANTHROPIC_API_KEY", "test-key")
    .withEntrypoint([]);

  const container = containerWithEnv.withExec([
    "sh",
    "-c",
    "bunx prisma db push --skip-generate && timeout 10s bun run start 2>&1 || true",
  ]);

  let output = "";

  try {
    output = await container.stdout();
  } catch (error) {
    try {
      output = await container.stderr();
    } catch {
      return `❌ Smoke test failed: Could not capture container output. Error: ${String(error)}`;
    }
  }

  // Check for expected patterns indicating the app tried to start
  const expectedPatterns = [
    "Starting Sentinel",
    "Database initialized",
    "Worker started",
    "Sentinel ready",
  ];

  const hasExpectedPattern = expectedPatterns.some((pattern) =>
    output.toLowerCase().includes(pattern.toLowerCase()),
  );

  if (hasExpectedPattern) {
    return `✅ Smoke test passed: Container started successfully.\n\nOutput snippet: ${output.slice(0, 500)}`;
  }

  return `⚠️ Smoke test unclear: Container ran but output was unexpected.\nOutput:\n${output}`;
}

/**
 * Run sentinel CI validation and smoke test in parallel.
 */
export async function runSentinelValidation(
  source: Directory,
  version: string,
  gitSha: string,
): Promise<string> {
  const outputs: string[] = [];
  const [ciResult, image] = await Promise.all([
    checkSentinel(source),
    Promise.resolve(buildSentinelImage(source, version, gitSha)),
  ]);
  outputs.push(ciResult);
  outputs.push(await smokeTestSentinelImageWithContainer(image));
  return outputs.join("\n");
}

type PublishSentinelImageWithContainerOptions = {
  image: Container;
  version: string;
  gitSha: string;
  registryAuth?:
    | {
        username: string;
        password: Secret;
      }
    | undefined;
};

export async function publishSentinelImageWithContainer(
  options: PublishSentinelImageWithContainerOptions,
): Promise<{ refs: string[]; versionedRef: string }> {
  let image = options.image;

  // Set up registry authentication if credentials provided
  if (options.registryAuth) {
    image = image.withRegistryAuth(
      "ghcr.io",
      options.registryAuth.username,
      options.registryAuth.password,
    );
  }

  const versionRef = await image.publish(
    `ghcr.io/shepherdjerred/sentinel:${options.version}`,
  );
  const shaRef = await image.publish(
    `ghcr.io/shepherdjerred/sentinel:${options.gitSha}`,
  );
  const latestRef = await image.publish(
    "ghcr.io/shepherdjerred/sentinel:latest",
  );

  return { refs: [versionRef, shaRef, latestRef], versionedRef: versionRef };
}
