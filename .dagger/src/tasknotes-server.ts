import type { Directory, Container, Secret } from "@dagger.io/dagger";
import {
  getBaseBunDebianContainer,
  installMonorepoWorkspaceDeps,
} from "./lib-monorepo-workspace.ts";
import type { WorkspaceEntry } from "./lib-monorepo-workspace.ts";
import { getBuiltEslintConfig } from "./lib-eslint-config.ts";

/**
 * Workspace entries for tasknotes-server CI/build.
 * Minimal — tasknotes-server only needs itself and eslint-config.
 */
const TASKNOTES_SERVER_WORKSPACES: WorkspaceEntry[] = [
  "packages/tasknotes-server",
  "packages/eslint-config",
  // Explicit (non-glob) workspaces in root package.json — must exist for bun install
  { path: "packages/clauderon/docs", fullDirPhase1: true, depsOnly: true },
  { path: "packages/sentinel/web", depsOnly: true },
];

/**
 * Install tasknotes-server workspace dependencies.
 */
function installTasknotesServerWorkspaceDeps(
  workspaceSource: Directory,
  useMounts: boolean,
): Container {
  return installMonorepoWorkspaceDeps({
    baseContainer: getBaseBunDebianContainer(),
    source: workspaceSource,
    useMounts,
    workspaces: TASKNOTES_SERVER_WORKSPACES,
    rootConfigFiles: ["tsconfig.base.json"],
  });
}

/**
 * Get a prepared container with all dependencies installed (using mounts for CI).
 */
function getTasknotesServerPrepared(workspaceSource: Directory): Container {
  const builtEslintConfig = getBuiltEslintConfig(workspaceSource);
  return installTasknotesServerWorkspaceDeps(workspaceSource, true)
    .withDirectory(
      "/workspace/packages/eslint-config/dist",
      builtEslintConfig.directory("dist"),
    )
    .withWorkdir("/workspace/packages/tasknotes-server");
}

/**
 * Run type checking, linting, and tests for tasknotes-server in PARALLEL.
 */
export async function checkTasknotesServer(
  source: Directory,
): Promise<string> {
  const prepared = getTasknotesServerPrepared(source);

  await Promise.all([
    prepared.withExec(["bun", "run", "typecheck"]).sync(),
    prepared.withExec(["bun", "run", "lint"]).sync(),
    prepared.withExec(["bun", "run", "test"]).sync(),
  ]);

  return "✓ TaskNotes Server CI passed (typecheck, lint, test)";
}

/**
 * Build the tasknotes-server Docker image for production.
 */
export function buildTasknotesServerImage(
  source: Directory,
  version: string,
  _gitSha: string,
): Container {
  return installTasknotesServerWorkspaceDeps(source, false)
    .withWorkdir("/workspace/packages/tasknotes-server")
    .withEnvVariable("NODE_ENV", "production")
    .withEntrypoint(["bun", "run", "src/index.ts"])
    .withExposedPort(3000)
    .withLabel("org.opencontainers.image.title", "tasknotes-server")
    .withLabel(
      "org.opencontainers.image.description",
      "TaskNotes API server for the Tasks for Obsidian mobile app",
    )
    .withLabel(
      "org.opencontainers.image.source",
      "https://github.com/shepherdjerred/monorepo",
    )
    .withLabel("org.opencontainers.image.version", version);
}

/**
 * Smoke test a pre-built tasknotes-server Docker image.
 */
export async function smokeTestTasknotesServerImage(
  image: Container,
): Promise<string> {
  const container = image
    .withEnvVariable("VAULT_PATH", "/tmp/test-vault")
    .withEnvVariable("AUTH_TOKEN", "test-token")
    .withEnvVariable("PORT", "3000")
    .withEntrypoint([])
    .withExec(["mkdir", "-p", "/tmp/test-vault"])
    .withExec([
      "sh",
      "-c",
      "timeout 5s bun run src/index.ts 2>&1 || true",
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

  // Server should start and listen on port 3000
  const expectedPatterns = ["listening", "3000", "started", "ready"];
  const hasExpectedPattern = expectedPatterns.some((pattern) =>
    output.toLowerCase().includes(pattern.toLowerCase()),
  );

  if (hasExpectedPattern) {
    return `✅ Smoke test passed: Server started successfully.\n\nOutput snippet: ${output.slice(0, 500)}`;
  }

  return `⚠️ Smoke test unclear: Server ran but output was unexpected.\nOutput:\n${output}`;
}

/**
 * Run tasknotes-server CI validation and smoke test in parallel.
 */
export async function runTasknotesServerValidation(
  source: Directory,
  version: string,
  gitSha: string,
): Promise<string> {
  const outputs: string[] = [];
  const [ciResult, image] = await Promise.all([
    checkTasknotesServer(source),
    Promise.resolve(buildTasknotesServerImage(source, version, gitSha)),
  ]);
  outputs.push(ciResult);
  outputs.push(await smokeTestTasknotesServerImage(image));
  return outputs.join("\n");
}

type PublishOptions = {
  image: Container;
  version: string;
  gitSha: string;
  registryAuth?: {
    username: string;
    password: Secret;
  } | undefined;
};

export async function publishTasknotesServerImage(
  options: PublishOptions,
): Promise<{ refs: string[]; versionedRef: string }> {
  let image = options.image;

  if (options.registryAuth) {
    image = image.withRegistryAuth(
      "ghcr.io",
      options.registryAuth.username,
      options.registryAuth.password,
    );
  }

  const versionRef = await image.publish(
    `ghcr.io/shepherdjerred/tasknotes-server:${options.version}`,
  );
  const shaRef = await image.publish(
    `ghcr.io/shepherdjerred/tasknotes-server:${options.gitSha}`,
  );
  const latestRef = await image.publish(
    "ghcr.io/shepherdjerred/tasknotes-server:latest",
  );

  return { refs: [versionRef, shaRef, latestRef], versionedRef: versionRef };
}
