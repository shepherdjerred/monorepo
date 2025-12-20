import { dag, object, func, Secret, Directory } from "@dagger.io/dagger";
import {
  runBunWorkspaceCI,
  publishToNpm,
  manifestPr,
  manifestRelease,
} from "../../packages/dagger-utils/src";

const PACKAGES = ["eslint-config", "dagger-utils"] as const;
const REPO_URL = "shepherdjerred/monorepo";

@object()
export class Monorepo {
  /**
   * Run CI pipeline (install, typecheck, test, build)
   */
  @func()
  async ci(source: Directory): Promise<string> {
    const result = await runBunWorkspaceCI({
      source,
      typecheck: true,
      lint: false,
      test: true,
      build: true,
    });

    return `CI completed: ${JSON.stringify(result.steps)}`;
  }

  /**
   * Create/update release PRs using release-please
   */
  @func()
  async releasePr(githubToken: Secret): Promise<string> {
    return await manifestPr({
      ghToken: githubToken,
      repoUrl: REPO_URL,
    });
  }

  /**
   * Create GitHub releases for merged release PRs
   */
  @func()
  async githubRelease(githubToken: Secret): Promise<string> {
    return await manifestRelease({
      ghToken: githubToken,
      repoUrl: REPO_URL,
    });
  }

  /**
   * Publish packages to npm (only after releases are created)
   */
  @func()
  async publish(source: Directory, npmToken: Secret): Promise<string> {
    // Run CI first to get the built container
    const result = await runBunWorkspaceCI({
      source,
      typecheck: true,
      lint: false,
      test: true,
      build: true,
    });

    const outputs: string[] = [];

    for (const pkg of PACKAGES) {
      const output = await publishToNpm({
        container: result.container,
        token: npmToken,
        packageDir: `/workspace/packages/${pkg}`,
        access: "public",
      });
      outputs.push(`@shepherdjerred/${pkg}: ${output}`);
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
