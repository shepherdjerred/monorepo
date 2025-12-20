import { dag, object, func, Secret, Directory, Container } from "@dagger.io/dagger";

const PACKAGES = ["eslint-config", "dagger-utils"] as const;
const REPO_URL = "shepherdjerred/monorepo";

// Inline the bun version from dagger-utils/versions.ts
const BUN_VERSION = "1.3.4";
const NODE_VERSION = "24.11.1";

/**
 * Get a Bun container with caching enabled
 */
function getBunContainerWithCache(source: Directory): Container {
  return dag
    .container()
    .from(`oven/bun:${BUN_VERSION}`)
    .withWorkdir("/workspace")
    .withMountedCache("/root/.bun/install/cache", dag.cacheVolume("bun-cache"))
    .withMountedDirectory("/workspace", source);
}

/**
 * Get a container with release-please CLI installed
 */
function getReleasePleaseContainer(): Container {
  return dag
    .container()
    .from(`node:${NODE_VERSION}-bookworm`)
    .withExec(["apt-get", "update"])
    .withExec(["apt-get", "install", "-y", "git"])
    .withExec(["npm", "install", "-g", "release-please@latest"])
    .withWorkdir("/workspace");
}

@object()
export class Monorepo {
  /**
   * Run CI pipeline (install, typecheck, test, build)
   */
  @func()
  async ci(source: Directory): Promise<string> {
    let container = getBunContainerWithCache(source);

    // Install
    container = container.withExec(["bun", "install", "--frozen-lockfile"]);
    await container.sync();

    // Typecheck
    container = container.withExec(["bun", "run", "typecheck"]);
    await container.sync();

    // Test
    container = container.withExec(["bun", "run", "test"]);
    await container.sync();

    // Build
    container = container.withExec(["bun", "run", "build"]);
    await container.sync();

    return "CI completed: install, typecheck, test, build";
  }

  /**
   * Create/update release PRs using release-please manifest mode
   */
  @func()
  async releasePr(githubToken: Secret): Promise<string> {
    const container = getReleasePleaseContainer()
      .withSecretVariable("GITHUB_TOKEN", githubToken)
      .withExec([
        "sh",
        "-c",
        `git clone https://x-access-token:$GITHUB_TOKEN@github.com/${REPO_URL}.git .`,
      ])
      .withExec([
        "release-please",
        "manifest-pr",
        "--token=$GITHUB_TOKEN",
        `--repo-url=${REPO_URL}`,
        "--target-branch=main",
      ]);

    return await container.stdout();
  }

  /**
   * Create GitHub releases for merged release PRs
   */
  @func()
  async githubRelease(githubToken: Secret): Promise<string> {
    const container = getReleasePleaseContainer()
      .withSecretVariable("GITHUB_TOKEN", githubToken)
      .withExec([
        "sh",
        "-c",
        `git clone https://x-access-token:$GITHUB_TOKEN@github.com/${REPO_URL}.git .`,
      ])
      .withExec([
        "release-please",
        "manifest-release",
        "--token=$GITHUB_TOKEN",
        `--repo-url=${REPO_URL}`,
      ]);

    return await container.stdout();
  }

  /**
   * Publish packages to npm
   */
  @func()
  async publish(source: Directory, npmToken: Secret): Promise<string> {
    let container = getBunContainerWithCache(source);

    // Install and build
    container = container.withExec(["bun", "install", "--frozen-lockfile"]);
    await container.sync();

    container = container.withExec(["bun", "run", "build"]);
    await container.sync();

    const outputs: string[] = [];

    for (const pkg of PACKAGES) {
      // Publish each package
      const result = await container
        .withWorkdir(`/workspace/packages/${pkg}`)
        .withSecretVariable("NPM_TOKEN", npmToken)
        .withExec(["sh", "-c", 'echo "//registry.npmjs.org/:_authToken=${NPM_TOKEN}" > ~/.npmrc'])
        .withExec(["bun", "publish", "--access", "public", "--tag", "latest", "--registry", "https://registry.npmjs.org"])
        .stdout();

      outputs.push(`@shepherdjerred/${pkg}: published`);
    }

    return outputs.join("\n");
  }

  /**
   * Full release workflow: create PRs, create releases, publish if released
   */
  @func()
  async release(
    source: Directory,
    githubToken: Secret,
    npmToken: Secret
  ): Promise<string> {
    const outputs: string[] = [];

    // Create/update release PRs
    const prOutput = await this.releasePr(githubToken);
    outputs.push(`Release PR: ${prOutput}`);

    // Create GitHub releases
    const releaseOutput = await this.githubRelease(githubToken);
    outputs.push(`GitHub Release: ${releaseOutput}`);

    // Check if any releases were created
    if (releaseOutput.includes("github.com") && releaseOutput.includes("releases")) {
      outputs.push("Releases created! Publishing packages...");
      const publishOutput = await this.publish(source, npmToken);
      outputs.push(publishOutput);
    } else {
      outputs.push("No releases created - skipping publish");
    }

    return outputs.join("\n");
  }
}
