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
   * Run the full CI/CD pipeline.
   * - Always runs: install, typecheck, test, build
   * - If githubToken and npmToken provided: also runs release-please and publishes
   */
  @func()
  async ci(
    source: Directory,
    githubToken?: Secret,
    npmToken?: Secret
  ): Promise<string> {
    const outputs: string[] = [];

    // Run CI pipeline
    let container = getBunContainerWithCache(source);

    container = container.withExec(["bun", "install", "--frozen-lockfile"]);
    await container.sync();
    outputs.push("✓ Install");

    container = container.withExec(["bun", "run", "typecheck"]);
    await container.sync();
    outputs.push("✓ Typecheck");

    container = container.withExec(["bun", "run", "test"]);
    await container.sync();
    outputs.push("✓ Test");

    container = container.withExec(["bun", "run", "build"]);
    await container.sync();
    outputs.push("✓ Build");

    // If tokens provided, run release workflow
    if (githubToken && npmToken) {
      outputs.push("\n--- Release Workflow ---");

      // Create/update release PRs
      const prContainer = getReleasePleaseContainer()
        .withSecretVariable("GITHUB_TOKEN", githubToken)
        .withExec([
          "sh",
          "-c",
          `git clone https://x-access-token:$GITHUB_TOKEN@github.com/${REPO_URL}.git . && release-please manifest-pr --token=\$GITHUB_TOKEN --repo-url=${REPO_URL} --target-branch=main`,
        ]);

      const prOutput = await prContainer.stdout();
      outputs.push(`Release PR: ${prOutput || "(no changes)"}`);

      // Create GitHub releases
      const releaseContainer = getReleasePleaseContainer()
        .withSecretVariable("GITHUB_TOKEN", githubToken)
        .withExec([
          "sh",
          "-c",
          `git clone https://x-access-token:$GITHUB_TOKEN@github.com/${REPO_URL}.git . && release-please manifest-release --token=\$GITHUB_TOKEN --repo-url=${REPO_URL}`,
        ]);

      const releaseOutput = await releaseContainer.stdout();
      outputs.push(`GitHub Release: ${releaseOutput || "(no releases)"}`);

      // Check if any releases were created and publish
      if (releaseOutput.includes("github.com") && releaseOutput.includes("releases")) {
        outputs.push("\n--- Publishing ---");

        for (const pkg of PACKAGES) {
          await container
            .withWorkdir(`/workspace/packages/${pkg}`)
            .withSecretVariable("NPM_TOKEN", npmToken)
            .withExec(["sh", "-c", 'echo "//registry.npmjs.org/:_authToken=${NPM_TOKEN}" > ~/.npmrc'])
            .withExec(["bun", "publish", "--access", "public", "--tag", "latest", "--registry", "https://registry.npmjs.org"])
            .stdout();

          outputs.push(`✓ Published @shepherdjerred/${pkg}`);
        }
      } else {
        outputs.push("No releases created - skipping publish");
      }
    }

    return outputs.join("\n");
  }
}
