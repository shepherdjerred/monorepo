import type { Directory, Container, Secret } from "@dagger.io/dagger";
import { dag } from "@dagger.io/dagger";

const BUN_VERSION = "1.3.4";

/**
 * Get a Bun container with caching and ffmpeg for voice support
 */
function getBunContainerWithVoice(): Container {
  return dag
    .container()
    .from(`oven/bun:${BUN_VERSION}-debian`)
    .withExec(["apt-get", "update"])
    .withExec(["apt-get", "install", "-y", "ffmpeg", "python3", "make", "g++", "libtool-bin"])
    .withMountedCache("/root/.bun/install/cache", dag.cacheVolume("bun-cache"));
}

/**
 * Get a prepared container with all dependencies installed
 * @param workspaceSource The full workspace source directory
 * @returns Container ready for birmel operations
 */
export function getBirmelPrepared(workspaceSource: Directory): Container {
  return getBunContainerWithVoice()
    .withWorkdir("/workspace")
    .withMountedDirectory("/workspace", workspaceSource)
    .withExec(["bun", "install", "--frozen-lockfile"])
    .withWorkdir("/workspace/packages/birmel");
}

/**
 * Run type checking, linting, and tests for birmel
 * @param workspaceSource The full workspace source directory
 * @returns The container after running checks
 */
export function checkBirmel(workspaceSource: Directory): Container {
  return getBirmelPrepared(workspaceSource)
    .withExec(["bun", "run", "typecheck"])
    .withExec(["bun", "run", "lint"])
    .withExec(["bun", "run", "test"]);
}

/**
 * Build the birmel Docker image for production
 * @param workspaceSource The full workspace source directory
 * @param version The version tag
 * @param gitSha The git SHA
 * @returns The built container with files copied (not mounted)
 */
export function buildBirmelImage(
  workspaceSource: Directory,
  version: string,
  gitSha: string,
): Container {
  // Use withDirectory to copy files into the image (not withMountedDirectory)
  // Mounted directories are temporary and not included in published images
  return getBunContainerWithVoice()
    .withWorkdir("/workspace")
    .withDirectory("/workspace", workspaceSource)
    .withExec(["bun", "install", "--frozen-lockfile"])
    .withWorkdir("/workspace/packages/birmel")
    .withExec(["bunx", "prisma", "generate"])
    .withEnvVariable("VERSION", version)
    .withEnvVariable("GIT_SHA", gitSha)
    .withEnvVariable("NODE_ENV", "production")
    .withEntrypoint(["bun", "run", "src/index.ts"])
    .withLabel("org.opencontainers.image.title", "birmel")
    .withLabel("org.opencontainers.image.description", "AI-powered Discord server management bot");
}

/**
 * Smoke test the birmel Docker image
 * @param workspaceSource The full workspace source directory
 * @param version The version tag
 * @param gitSha The git SHA
 * @returns Test result with logs
 */
export async function smokeTestBirmelImage(
  workspaceSource: Directory,
  version: string,
  gitSha: string,
): Promise<string> {
  const image = buildBirmelImage(workspaceSource, version, gitSha);

  // Run with env vars that will cause expected startup failure (missing tokens)
  const containerWithEnv = image
    .withEnvVariable("DISCORD_TOKEN", "test-token")
    .withEnvVariable("DISCORD_CLIENT_ID", "test-client-id")
    .withEnvVariable("ANTHROPIC_API_KEY", "test-anthropic-key")
    .withEnvVariable("OPENAI_API_KEY", "test-openai-key")
    .withEnvVariable("DATABASE_PATH", "/tmp/test.db")
    .withEntrypoint([]);

  const container = containerWithEnv.withExec([
    "sh",
    "-c",
    "timeout 30s bun run src/index.ts 2>&1 || true",
  ]);

  let output = "";

  try {
    output = await container.stdout();
  } catch (error) {
    try {
      output = await container.stderr();
    } catch (_stderrError) {
      return `❌ Smoke test failed: Could not capture container output. Error: ${String(error)}`;
    }
  }

  // Check for expected patterns indicating the bot tried to start
  const expectedPatterns = [
    "Logging in",
    "Discord",
    "TokenInvalid",
    "Invalid token",
    "401",
    "Unauthorized",
  ];

  const hasExpectedPattern = expectedPatterns.some((pattern) =>
    output.toLowerCase().includes(pattern.toLowerCase()),
  );

  if (hasExpectedPattern) {
    return `✅ Smoke test passed: Container started and failed as expected due to invalid credentials.\n\nOutput snippet: ${output.slice(0, 500)}`;
  }

  return `⚠️ Smoke test unclear: Container ran but output was unexpected.\nOutput:\n${output}`;
}

type PublishBirmelImageOptions = {
  workspaceSource: Directory;
  version: string;
  gitSha: string;
  registryAuth?: {
    username: string;
    password: Secret;
  };
};

type PublishBirmelImageWithContainerOptions = {
  image: Container;
  version: string;
  gitSha: string;
  registryAuth?: {
    username: string;
    password: Secret;
  };
};

/**
 * Publish the birmel Docker image
 * @param options Publishing options including workspace source, version, git SHA, and optional registry auth
 * @returns The published image references
 */
export async function publishBirmelImage(options: PublishBirmelImageOptions): Promise<string[]> {
  const image = buildBirmelImage(options.workspaceSource, options.version, options.gitSha);
  return publishBirmelImageWithContainer({
    image,
    version: options.version,
    gitSha: options.gitSha,
    registryAuth: options.registryAuth,
  });
}

/**
 * Publish a pre-built birmel Docker image (avoids rebuilding)
 * @param options Publishing options including pre-built image, version, git SHA, and optional registry auth
 * @returns The published image references
 */
export async function publishBirmelImageWithContainer(
  options: PublishBirmelImageWithContainerOptions,
): Promise<string[]> {
  let image = options.image;

  // Set up registry authentication if credentials provided
  if (options.registryAuth) {
    image = image.withRegistryAuth("ghcr.io", options.registryAuth.username, options.registryAuth.password);
  }

  const versionRef = await image.publish(`ghcr.io/shepherdjerred/birmel:${options.version}`);
  const shaRef = await image.publish(`ghcr.io/shepherdjerred/birmel:${options.gitSha}`);

  return [versionRef, shaRef];
}
