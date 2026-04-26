/**
 * OCI image build and push helper functions.
 *
 * These are plain functions (not decorated) — the @func() wrappers live in index.ts.
 */
import { dag, Container, Directory, Secret } from "@dagger.io/dagger";

import {
  BUN_IMAGE,
  BUN_CACHE,
  CADDY_BUILDER_IMAGE,
  CADDY_IMAGE,
  CLAUDE_CODE_VERSION,
  GH_CLI_VERSION,
} from "./constants";
import versions from "./versions";

function withGitHubCli(container: Container): Container {
  return container
    .withExec(["apt-get", "update", "-qq"])
    .withExec([
      "apt-get",
      "install",
      "-y",
      "-qq",
      "--no-install-recommends",
      "ca-certificates",
      "curl",
      "git",
    ])
    .withExec(["sh", "-c", "rm -rf /var/lib/apt/lists/*"])
    .withExec([
      "sh",
      "-c",
      `curl -fsSL https://github.com/cli/cli/releases/download/v${GH_CLI_VERSION}/gh_${GH_CLI_VERSION}_linux_amd64.tar.gz | tar xz -C /usr/local/bin --strip-components=2 gh_${GH_CLI_VERSION}_linux_amd64/bin/gh`,
    ]);
}

/**
 * Install the GitHub CLI and Claude Code CLI into a Bun-based container.
 *
 * The birmel Discord bot's editor sub-agent shells out to both:
 * - `gh` — opens pull requests on the user's behalf after an editor session
 * - `claude` — runs the actual code edits
 *
 * Without these binaries the editor agent logs "feature will not work" on
 * every restart and silently fails any user request that hits its tools.
 */
function withEditorClis(container: Container): Container {
  return withGitHubCli(container).withExec([
    "bun",
    "add",
    "-g",
    `@anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}`,
  ]);
}

/**
 * Build a Bun service OCI image. Constructs a minimal workspace with
 * only the target package and its workspace deps — no file modification.
 *
 * `installEditorClis` opts a package into having `gh` and `claude` in PATH;
 * required for birmel and any future package whose agent shells out to them.
 */
export function buildImageHelper(
  pkgDir: Directory,
  pkg: string,
  depNames: string[] = [],
  depDirs: Directory[] = [],
  version: string = "dev",
  gitSha: string = "unknown",
  usePrisma: boolean = false,
  installEditorClis: boolean = false,
): Container {
  const excludes = ["node_modules", "dist", ".eslintcache"];

  // Build a minimal workspace: target + needed packages
  let container = dag
    .container()
    .from(BUN_IMAGE)
    .withMountedCache("/root/.bun/install/cache", dag.cacheVolume(BUN_CACHE));

  if (installEditorClis) {
    container = withEditorClis(container);
  }

  container = container
    .withWorkdir("/workspace")
    .withDirectory(`/workspace/packages/${pkg}`, pkgDir, {
      exclude: excludes,
    });

  for (let i = 0; i < depNames.length; i++) {
    container = container.withDirectory(
      `/workspace/packages/${depNames[i]}`,
      depDirs[i],
      { exclude: excludes },
    );
  }

  // Install deps then set up the final image
  return container
    .withWorkdir(`/workspace/packages/${pkg}`)
    .withExec(["bun", "install", "--frozen-lockfile"])
    .withLabel(
      "org.opencontainers.image.source",
      "https://github.com/shepherdjerred/monorepo",
    )
    .withLabel("org.opencontainers.image.version", version)
    .withLabel("org.opencontainers.image.revision", gitSha)
    .withEnvVariable("VERSION", version)
    .withEnvVariable("GIT_SHA", gitSha)
    .withEntrypoint(
      usePrisma
        ? ["/bin/sh", "-c", "bunx prisma db push && bun run src/index.ts"]
        : ["bun", "run", "src/index.ts"],
    );
}

/**
 * Build the caddy-s3proxy image.
 * Multi-stage Go build: xcaddy builds a custom Caddy binary with the S3 proxy plugin,
 * then copies it into the runtime Caddy Alpine image.
 */
export function buildCaddyS3ProxyImageHelper(
  version: string = "dev",
  gitSha: string = "unknown",
): Container {
  // Stage 1: Build custom Caddy binary with S3 proxy plugin
  const caddyBinary = dag
    .container()
    .from(CADDY_BUILDER_IMAGE)
    .withExec([
      "xcaddy",
      "build",
      "--with",
      "github.com/lindenlab/caddy-s3-proxy",
    ])
    .file("/usr/bin/caddy");

  // Stage 2: Runtime image with the custom binary
  return dag
    .container()
    .from(CADDY_IMAGE)
    .withFile("/usr/bin/caddy", caddyBinary)
    .withLabel(
      "org.opencontainers.image.source",
      "https://github.com/shepherdjerred/monorepo",
    )
    .withLabel("org.opencontainers.image.version", version)
    .withLabel("org.opencontainers.image.revision", gitSha)
    .withEnvVariable("VERSION", version)
    .withEnvVariable("GIT_SHA", gitSha);
}

// ---------------------------------------------------------------------------
// Push helpers
// ---------------------------------------------------------------------------

/** Push any pre-built container to a registry under one or more tags. Returns the digest. */
export async function pushContainerHelper(
  container: Container,
  tags: string[],
  registryUsername: string,
  registryPassword: Secret,
): Promise<string> {
  if (tags.length === 0) {
    throw new Error("pushContainerHelper requires at least one tag");
  }
  const image = container.withRegistryAuth(
    "ghcr.io",
    registryUsername,
    registryPassword,
  );

  const digest = await image.publish(tags[0]);
  for (const tag of tags.slice(1)) {
    await image.publish(tag);
  }
  return digest;
}

/** Push a caddy-s3proxy image to a registry. */
export async function pushCaddyS3ProxyImageHelper(
  tags: string[],
  registryUsername: string,
  registryPassword: Secret,
  version: string = "dev",
  gitSha: string = "unknown",
): Promise<string> {
  const container = buildCaddyS3ProxyImageHelper(version, gitSha);
  return pushContainerHelper(
    container,
    tags,
    registryUsername,
    registryPassword,
  );
}

/**
 * Build the obsidian-headless image.
 * Node-based, installs obsidian-headless CLI globally for Obsidian vault sync.
 * Uses Node instead of Bun because obsidian-headless depends on better-sqlite3,
 * a native Node addon that Bun does not support.
 * Pinned to a specific obsidian-headless npm version so the Dagger cache key
 * changes when we bump the dependency; previous un-pinned code left a stale
 * Bun-based image cached on CI for weeks.
 */
export function buildObsidianHeadlessImageHelper(
  version: string = "dev",
  gitSha: string = "unknown",
): Container {
  return dag
    .container()
    .from("node:22-slim")
    .withExec([
      "sh",
      "-c",
      "apt-get update && apt-get install -y python3 build-essential && rm -rf /var/lib/apt/lists/*",
    ])
    .withExec([
      "npm",
      "install",
      "-g",
      `obsidian-headless@${versions["obsidian-headless"]}`,
    ])
    .withExec(["node", "--version"])
    .withExec(["which", "ob"])
    .withExec(["mkdir", "-p", "/vault"])
    .withLabel(
      "org.opencontainers.image.source",
      "https://github.com/shepherdjerred/monorepo",
    )
    .withLabel("org.opencontainers.image.version", version)
    .withLabel("org.opencontainers.image.revision", gitSha)
    .withEnvVariable("VERSION", version)
    .withEnvVariable("GIT_SHA", gitSha)
    .withEntrypoint(["/bin/sh", "-c"]);
}

/** Push an obsidian-headless image to a registry. */
export async function pushObsidianHeadlessImageHelper(
  tags: string[],
  registryUsername: string,
  registryPassword: Secret,
  version: string = "dev",
  gitSha: string = "unknown",
): Promise<string> {
  const container = buildObsidianHeadlessImageHelper(version, gitSha);
  return pushContainerHelper(
    container,
    tags,
    registryUsername,
    registryPassword,
  );
}

// ---------------------------------------------------------------------------
// Temporal worker image builder
// ---------------------------------------------------------------------------

/**
 * Build the Temporal worker image.
 * Standalone Bun package — simple workspace mount + install + run.
 */
export function buildTemporalWorkerImageHelper(
  pkgDir: Directory,
  depNames: string[] = [],
  depDirs: Directory[] = [],
  version: string = "dev",
  gitSha: string = "unknown",
): Container {
  const excludes = ["node_modules", "dist", ".eslintcache"];

  let container = dag
    .container()
    .from(BUN_IMAGE)
    .withMountedCache("/root/.bun/install/cache", dag.cacheVolume(BUN_CACHE));

  // The docs-groom workflow shells out to `gh` + `claude` from inside the
  // worker pod, so the temporal-worker image must ship both binaries.
  container = withEditorClis(container);

  container = container
    .withWorkdir("/workspace")
    .withDirectory("/workspace/packages/temporal", pkgDir, {
      exclude: excludes,
    });

  for (let i = 0; i < depNames.length; i++) {
    container = container.withDirectory(
      `/workspace/packages/${depNames[i]}`,
      depDirs[i],
      { exclude: excludes },
    );
  }

  return withGitHubCli(container)
    .withWorkdir("/workspace/packages/temporal")
    .withExec(["bun", "install", "--frozen-lockfile"])
    .withLabel(
      "org.opencontainers.image.source",
      "https://github.com/shepherdjerred/monorepo",
    )
    .withLabel("org.opencontainers.image.version", version)
    .withLabel("org.opencontainers.image.revision", gitSha)
    .withEnvVariable("VERSION", version)
    .withEnvVariable("GIT_SHA", gitSha)
    .withEntrypoint(["bun", "run", "src/worker.ts"]);
}

/** Push a temporal-worker image to a registry. */
export async function pushTemporalWorkerImageHelper(
  pkgDir: Directory,
  tags: string[],
  registryUsername: string,
  registryPassword: Secret,
  depNames: string[] = [],
  depDirs: Directory[] = [],
  version: string = "dev",
  gitSha: string = "unknown",
): Promise<string> {
  const container = buildTemporalWorkerImageHelper(
    pkgDir,
    depNames,
    depDirs,
    version,
    gitSha,
  );
  return pushContainerHelper(
    container,
    tags,
    registryUsername,
    registryPassword,
  );
}

// ---------------------------------------------------------------------------
// Workspace-monorepo image builders (scout, discord-plays-pokemon)
// ---------------------------------------------------------------------------

/**
 * Build the scout-for-lol backend image.
 * Scout is a Bun workspace monorepo — mount the full package, install deps at root,
 * run prisma generate, then set workdir to the backend sub-package.
 */
export function buildScoutImageHelper(
  pkgDir: Directory,
  depNames: string[] = [],
  depDirs: Directory[] = [],
  version: string = "dev",
  gitSha: string = "unknown",
): Container {
  const excludes = ["node_modules", "dist", ".eslintcache"];

  let container = dag
    .container()
    .from(BUN_IMAGE)
    .withMountedCache("/root/.bun/install/cache", dag.cacheVolume(BUN_CACHE))
    .withWorkdir("/workspace")
    .withDirectory("/workspace/packages/scout-for-lol", pkgDir, {
      exclude: excludes,
    });

  for (let i = 0; i < depNames.length; i++) {
    container = container.withDirectory(
      `/workspace/packages/${depNames[i]}`,
      depDirs[i],
      { exclude: excludes },
    );
  }

  return container
    .withWorkdir("/workspace/packages/scout-for-lol")
    .withExec(["bun", "install", "--frozen-lockfile"])
    .withWorkdir("/workspace/packages/scout-for-lol/packages/backend")
    .withExec(["bunx", "--trust", "prisma@6", "generate"])
    .withLabel(
      "org.opencontainers.image.source",
      "https://github.com/shepherdjerred/monorepo",
    )
    .withLabel("org.opencontainers.image.version", version)
    .withLabel("org.opencontainers.image.revision", gitSha)
    .withEnvVariable("VERSION", version)
    .withEnvVariable("GIT_SHA", gitSha)
    .withEntrypoint([
      "/bin/sh",
      "-c",
      "bunx prisma migrate deploy && bun run src/index.ts",
    ]);
}

/**
 * Build the discord-plays-pokemon backend image.
 * Similar workspace structure — mount the full package, install deps at root,
 * then install deps in the backend sub-package.
 */
export function buildDiscordPlaysPokemonImageHelper(
  pkgDir: Directory,
  depNames: string[] = [],
  depDirs: Directory[] = [],
  version: string = "dev",
  gitSha: string = "unknown",
): Container {
  const excludes = ["node_modules", "dist", ".eslintcache"];

  let container = dag
    .container()
    .from(BUN_IMAGE)
    .withMountedCache("/root/.bun/install/cache", dag.cacheVolume(BUN_CACHE))
    .withWorkdir("/workspace")
    .withDirectory("/workspace/packages/discord-plays-pokemon", pkgDir, {
      exclude: excludes,
    });

  for (let i = 0; i < depNames.length; i++) {
    container = container.withDirectory(
      `/workspace/packages/${depNames[i]}`,
      depDirs[i],
      { exclude: excludes },
    );
  }

  return container
    .withWorkdir("/workspace/packages/discord-plays-pokemon")
    .withExec(["bun", "install", "--frozen-lockfile"])
    .withWorkdir("/workspace/packages/discord-plays-pokemon/packages/backend")
    .withExec(["bun", "install", "--frozen-lockfile"])
    .withLabel(
      "org.opencontainers.image.source",
      "https://github.com/shepherdjerred/monorepo",
    )
    .withLabel("org.opencontainers.image.version", version)
    .withLabel("org.opencontainers.image.revision", gitSha)
    .withEnvVariable("VERSION", version)
    .withEnvVariable("GIT_SHA", gitSha)
    .withEntrypoint(["bun", "run", "src/index.ts"]);
}

// ---------------------------------------------------------------------------
// Push helpers for workspace-monorepo images
// ---------------------------------------------------------------------------

/** Push a scout-for-lol image to a registry. */
export async function pushScoutImageHelper(
  pkgDir: Directory,
  tags: string[],
  registryUsername: string,
  registryPassword: Secret,
  depNames: string[] = [],
  depDirs: Directory[] = [],
  version: string = "dev",
  gitSha: string = "unknown",
): Promise<string> {
  const container = buildScoutImageHelper(
    pkgDir,
    depNames,
    depDirs,
    version,
    gitSha,
  );
  return pushContainerHelper(
    container,
    tags,
    registryUsername,
    registryPassword,
  );
}

/** Push a discord-plays-pokemon image to a registry. */
export async function pushDiscordPlaysPokemonImageHelper(
  pkgDir: Directory,
  tags: string[],
  registryUsername: string,
  registryPassword: Secret,
  depNames: string[] = [],
  depDirs: Directory[] = [],
  version: string = "dev",
  gitSha: string = "unknown",
): Promise<string> {
  const container = buildDiscordPlaysPokemonImageHelper(
    pkgDir,
    depNames,
    depDirs,
    version,
    gitSha,
  );
  return pushContainerHelper(
    container,
    tags,
    registryUsername,
    registryPassword,
  );
}

// ---------------------------------------------------------------------------
// CI base image (Dockerfile-based build)
// ---------------------------------------------------------------------------

/** Build the CI base image from .buildkite/ci-image/Dockerfile. */
export function buildCiBaseImageHelper(context: Directory): Container {
  return context.dockerBuild();
}

/** Build and push the CI base image. Returns the digest. */
export async function pushCiBaseImageHelper(
  context: Directory,
  tags: string[],
  registryUsername: string,
  registryPassword: Secret,
): Promise<string> {
  const container = buildCiBaseImageHelper(context);
  return pushContainerHelper(
    container,
    tags,
    registryUsername,
    registryPassword,
  );
}

/** Push a built image to a registry under one or more tags. Returns the digest of the first tag published. */
export async function pushImageHelper(
  pkgDir: Directory,
  pkg: string,
  tags: string[],
  registryUsername: string,
  registryPassword: Secret,
  depNames: string[] = [],
  depDirs: Directory[] = [],
  version: string = "dev",
  gitSha: string = "unknown",
  usePrisma: boolean = false,
  installEditorClis: boolean = false,
): Promise<string> {
  if (tags.length === 0) {
    throw new Error("pushImageHelper requires at least one tag");
  }
  const image = buildImageHelper(
    pkgDir,
    pkg,
    depNames,
    depDirs,
    version,
    gitSha,
    usePrisma,
    installEditorClis,
  ).withRegistryAuth("ghcr.io", registryUsername, registryPassword);

  const digest = await image.publish(tags[0]);
  for (const tag of tags.slice(1)) {
    await image.publish(tag);
  }
  return digest;
}
