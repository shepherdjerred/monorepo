import type { Directory, Container, Secret, File } from "@dagger.io/dagger";
import { dag } from "@dagger.io/dagger";
import { syncToS3 } from "./lib-s3.ts";
import { publishToGhcrMultiple } from "./lib-ghcr.ts";
import { logWithTimestamp, withTiming } from "./lib-timing.ts";
import versions from "./lib-versions.ts";
import { getBuiltEslintConfig } from "./lib-eslint-config.ts";

const BUN_VERSION = versions.bun;

// --- Base container helpers ---

/**
 * Get a base Bun container without source mounted.
 */
function getBaseBunContainer(): Container {
  return dag
    .container()
    .from(`oven/bun:${BUN_VERSION}`)
    .withWorkdir("/workspace")
    .withMountedCache("/root/.bun/install/cache", dag.cacheVolume("bun-cache"));
}

// --- Common package helpers ---

/**
 * Install dependencies for the common package.
 * Mounts the full workspace to satisfy bun workspace requirements.
 */
function installCommonDeps(workspaceSource: Directory): Container {
  return getBaseBunContainer()
    .withFile("/workspace/package.json", workspaceSource.file("package.json"))
    .withFile("/workspace/bun.lock", workspaceSource.file("bun.lock"))
    .withDirectory(
      "/workspace/packages/common",
      workspaceSource.directory("packages/common"),
    )
    .withDirectory(
      "/workspace/packages/backend",
      workspaceSource.directory("packages/backend"),
    )
    .withDirectory(
      "/workspace/packages/frontend",
      workspaceSource.directory("packages/frontend"),
    )
    .withWorkdir("/workspace")
    .withExec(["bun", "install", "--frozen-lockfile"])
    .withWorkdir("/workspace/packages/common")
    .withExec(["bun", "install"]);
}

function lintCommon(
  workspaceSource: Directory,
  builtEslintConfig: Directory,
  tsconfigBase: File,
): Container {
  return installCommonDeps(workspaceSource)
    .withDirectory("/eslint-config", builtEslintConfig)
    .withFile("/tsconfig.base.json", tsconfigBase)
    .withWorkdir("/workspace/packages/common")
    .withExec(["bun", "run", "lint:check"]);
}

function buildCommon(workspaceSource: Directory): Container {
  return installCommonDeps(workspaceSource).withExec(["bun", "run", "build"]);
}

function testCommon(workspaceSource: Directory): Container {
  return installCommonDeps(workspaceSource).withExec(["bun", "run", "test"]);
}

function packCommon(workspaceSource: Directory): Container {
  return buildCommon(workspaceSource).withExec(["bun", "pm", "pack"]);
}

function getCommonPackage(workspaceSource: Directory): Directory {
  return packCommon(workspaceSource).directory("/workspace/packages/common");
}

// --- Backend package helpers ---

/**
 * Install dependencies for the backend package.
 * Builds and packs common first, then mounts all workspace packages.
 */
function installBackendDeps(workspaceSource: Directory): Container {
  const commonDir = getCommonPackage(workspaceSource);

  return getBaseBunContainer()
    .withFile("/workspace/package.json", workspaceSource.file("package.json"))
    .withFile("/workspace/bun.lock", workspaceSource.file("bun.lock"))
    .withDirectory(
      "/workspace/packages/backend",
      workspaceSource.directory("packages/backend"),
    )
    .withDirectory(
      "/workspace/packages/frontend",
      workspaceSource.directory("packages/frontend"),
    )
    .withDirectory("/workspace/packages/common", commonDir)
    .withWorkdir("/workspace")
    .withExec(["bun", "install", "--frozen-lockfile"]);
}

function lintBackend(
  workspaceSource: Directory,
  builtEslintConfig: Directory,
  tsconfigBase: File,
): Container {
  return installBackendDeps(workspaceSource)
    .withDirectory("/eslint-config", builtEslintConfig)
    .withFile("/tsconfig.base.json", tsconfigBase)
    .withWorkdir("/workspace/packages/backend")
    .withExec(["bun", "run", "lint:check"]);
}

function buildBackend(workspaceSource: Directory): Container {
  return installBackendDeps(workspaceSource)
    .withWorkdir("/workspace/packages/backend")
    .withExec(["bun", "run", "build"]);
}

function testBackend(workspaceSource: Directory): Container {
  return installBackendDeps(workspaceSource)
    .withWorkdir("/workspace/packages/backend")
    .withExec(["bun", "run", "test"]);
}

function getBackendWithDeps(workspaceSource: Directory): Directory {
  return installBackendDeps(workspaceSource).directory(
    "/workspace/packages/backend",
  );
}

// --- Frontend package helpers ---

/**
 * Install dependencies for the frontend package.
 * Builds and packs common first, then mounts all workspace packages.
 */
function installFrontendDeps(workspaceSource: Directory): Container {
  const commonDir = getCommonPackage(workspaceSource);

  return getBaseBunContainer()
    .withFile("/workspace/package.json", workspaceSource.file("package.json"))
    .withFile("/workspace/bun.lock", workspaceSource.file("bun.lock"))
    .withDirectory(
      "/workspace/packages/frontend",
      workspaceSource.directory("packages/frontend"),
    )
    .withDirectory(
      "/workspace/packages/backend",
      workspaceSource.directory("packages/backend"),
    )
    .withDirectory("/workspace/packages/common", commonDir)
    .withWorkdir("/workspace")
    .withExec(["bun", "install", "--frozen-lockfile"]);
}

function lintFrontend(
  workspaceSource: Directory,
  builtEslintConfig: Directory,
  tsconfigBase: File,
): Container {
  return installFrontendDeps(workspaceSource)
    .withDirectory("/eslint-config", builtEslintConfig)
    .withFile("/tsconfig.base.json", tsconfigBase)
    .withWorkdir("/workspace/packages/frontend")
    .withExec(["bun", "run", "lint:check"]);
}

function buildFrontend(workspaceSource: Directory): Container {
  return installFrontendDeps(workspaceSource)
    .withWorkdir("/workspace/packages/frontend")
    .withExec(["bun", "run", "build"]);
}

function testFrontend(workspaceSource: Directory): Container {
  return installFrontendDeps(workspaceSource)
    .withWorkdir("/workspace/packages/frontend")
    .withExec(["bun", "run", "test"]);
}

function getFrontendBuild(workspaceSource: Directory): Directory {
  return buildFrontend(workspaceSource).directory(
    "/workspace/packages/frontend/dist",
  );
}

// --- Docker image helpers ---

/**
 * Build the Discord Plays Pokemon Docker image.
 * Uses a GPU-enabled desktop base image with Bun runtime.
 */
function buildDockerImage(
  workspaceSource: Directory,
  version: string,
  gitSha: string,
): Container {
  const backendDir = getBackendWithDeps(workspaceSource);
  const frontendDist = getFrontendBuild(workspaceSource);

  const standardPath =
    "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin";

  return dag
    .container()
    .from("ghcr.io/selkies-project/nvidia-egl-desktop:24.04-20241222100454")
    .withoutEntrypoint()
    .withEnvVariable("PATH", standardPath)
    .withEnvVariable("DEBIAN_FRONTEND", "noninteractive")
    .withUser("root")
    .withExec(["sh", "-c", "rm -f /etc/apt/sources.list.d/google-chrome*"])
    .withExec(["apt", "update"])
    .withExec([
      "apt",
      "install",
      "-y",
      "curl",
      "kde-config-screenlocker",
      "unzip",
    ])
    .withExec([
      "sh",
      "-c",
      `curl -fsSL https://bun.sh/install | bash -s "bun-v${BUN_VERSION}"`,
    ])
    .withEnvVariable(
      "PATH",
      `/root/.bun/bin:/home/ubuntu/.bun/bin:${standardPath}`,
    )
    .withWorkdir("/home/ubuntu")
    .withExec(["mkdir", "-p", "data"])
    .withFile(
      "/tmp/supervisord.conf",
      workspaceSource.file("misc/supervisord.conf"),
    )
    .withExec([
      "sh",
      "-c",
      "cat /tmp/supervisord.conf >> /etc/supervisord.conf && rm /tmp/supervisord.conf",
    ])
    .withFile("package.json", backendDir.file("package.json"))
    .withFile("bun.lock", workspaceSource.file("bun.lock"))
    .withDirectory("packages/backend", backendDir)
    .withDirectory("packages/frontend", frontendDist)
    .withFile("run.sh", workspaceSource.file("misc/run.sh"))
    .withExec(["mkdir", "-p", "Downloads"])
    .withExec(["chown", "-R", "ubuntu:ubuntu", "/home/ubuntu"])
    .withUser("ubuntu")
    .withExec([
      "kwriteconfig5",
      "--file",
      "kscreenlockerrc",
      "--group",
      "Daemon",
      "--key",
      "Autolock",
      "false",
    ])
    .withExec([
      "kwriteconfig5",
      "--file",
      "~/.config/powermanagementprofilesrc",
      "--group",
      "AC",
      "--group",
      "DPMSControl",
      "--key",
      "idleTime",
      "540",
    ])
    .withLabel("org.opencontainers.image.title", "discord-plays-pokemon")
    .withLabel(
      "org.opencontainers.image.description",
      "Discord Plays Pokemon - A bot that lets Discord users play Pokemon",
    )
    .withLabel("org.opencontainers.image.version", version)
    .withLabel("org.opencontainers.image.revision", gitSha)
    .withLabel(
      "org.opencontainers.image.source",
      "https://github.com/shepherdjerred/monorepo",
    );
}

/**
 * Build MkDocs documentation.
 */
function buildDocs(workspaceSource: Directory): Directory {
  const container = dag
    .container()
    .from("squidfunk/mkdocs-material:latest")
    .withDirectory("/docs", workspaceSource.directory("docs"))
    .withWorkdir("/docs")
    .withExec(["mkdocs", "build"]);

  return container.directory("/docs/site");
}

// --- Exported pipeline functions ---

/**
 * Check discord-plays-pokemon: lint + test per sub-package (common, backend, frontend),
 * prettier, markdownlint, and build all packages.
 *
 * @param source The monorepo root source directory
 * @returns A message indicating completion
 */
export async function checkDiscordPlaysPokemon(
  source: Directory,
): Promise<string> {
  const pkgSource = source.directory("packages/discord-plays-pokemon");
  const eslintConfig = getBuiltEslintConfig(source);
  const tsconfigBase = source.file("tsconfig.base.json");

  await Promise.all([
    // Common lint
    withTiming("Common lint", async () => {
      await lintCommon(pkgSource, eslintConfig, tsconfigBase).sync();
    }),
    // Common test
    withTiming("Common test", async () => {
      await testCommon(pkgSource).sync();
    }),
    // Common build
    withTiming("Common build", async () => {
      await buildCommon(pkgSource).sync();
    }),
    // Backend lint
    withTiming("Backend lint", async () => {
      await lintBackend(pkgSource, eslintConfig, tsconfigBase).sync();
    }),
    // Backend test
    withTiming("Backend test", async () => {
      await testBackend(pkgSource).sync();
    }),
    // Backend build
    withTiming("Backend build", async () => {
      await buildBackend(pkgSource).sync();
    }),
    // Frontend lint
    withTiming("Frontend lint", async () => {
      await lintFrontend(pkgSource, eslintConfig, tsconfigBase).sync();
    }),
    // Frontend test
    withTiming("Frontend test", async () => {
      await testFrontend(pkgSource).sync();
    }),
    // Frontend build
    withTiming("Frontend build", async () => {
      await buildFrontend(pkgSource).sync();
    }),
    // Markdownlint
    withTiming("Markdownlint check", async () => {
      await dag
        .container()
        .from("davidanson/markdownlint-cli2")
        .withDirectory("/workspace", pkgSource)
        .withWorkdir("/workspace")
        .withExec(["markdownlint-cli2", "**/*.md", "#**/emulatorjs/**"])
        .sync();
    }),
  ]);

  return "discord-plays-pokemon CI passed (lint, test, build, markdownlint)";
}

/**
 * Deploy discord-plays-pokemon: publish Docker image to GHCR and deploy docs to S3.
 *
 * @param source The monorepo root source directory
 * @param version The version tag
 * @param gitSha The git SHA
 * @param ghcrUsername GHCR username for authentication
 * @param ghcrPassword GHCR password/token
 * @param s3AccessKeyId S3 access key ID for docs deployment
 * @param s3SecretAccessKey S3 secret access key for docs deployment
 * @returns A message indicating completion
 */
type DeployDiscordPlaysPokemonOptions = {
  source: Directory;
  version: string;
  gitSha: string;
  ghcrUsername: string;
  ghcrPassword: Secret;
  s3AccessKeyId: Secret;
  s3SecretAccessKey: Secret;
};

export async function deployDiscordPlaysPokemon(
  options: DeployDiscordPlaysPokemonOptions,
): Promise<{ message: string; versionedRef: string }> {
  const {
    source,
    version,
    gitSha,
    ghcrUsername,
    ghcrPassword,
    s3AccessKeyId,
    s3SecretAccessKey,
  } = options;
  const pkgSource = source.directory("packages/discord-plays-pokemon");
  const outputs: string[] = [];

  logWithTimestamp(
    `Starting deploy for discord-plays-pokemon version ${version} (${gitSha})`,
  );

  // Build and publish Docker image to GHCR
  const image = await withTiming("Docker image build", () =>
    Promise.resolve(buildDockerImage(pkgSource, version, gitSha)),
  );

  const ghcrImage = "ghcr.io/shepherdjerred/discord-plays-pokemon";
  const refs = await withTiming("Docker image publish", async () => {
    return await publishToGhcrMultiple({
      container: image,
      imageRefs: [`${ghcrImage}:${version}`, `${ghcrImage}:latest`],
      username: ghcrUsername,
      password: ghcrPassword,
    });
  });
  outputs.push(`Docker image published: ${refs.join(", ")}`);

  // Build and deploy docs to S3
  const docsDir = buildDocs(pkgSource);
  const syncOutput = await withTiming("Docs deploy to S3", async () => {
    return await syncToS3({
      sourceDir: docsDir,
      bucketName: "dpp-docs",
      endpointUrl: "https://seaweedfs.sjer.red",
      accessKeyId: s3AccessKeyId,
      secretAccessKey: s3SecretAccessKey,
      region: "us-east-1",
      deleteRemoved: true,
    });
  });
  outputs.push(`Docs deployed to S3\n${syncOutput}`);

  logWithTimestamp("Deploy completed for discord-plays-pokemon");
  return { message: outputs.join("\n"), versionedRef: refs[0] ?? "" };
}
