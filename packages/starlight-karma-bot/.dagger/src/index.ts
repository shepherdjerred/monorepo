import type { Directory, Secret } from "@dagger.io/dagger";
import { object, func, argument } from "@dagger.io/dagger";
import { updateHomelabVersion, publishToGhcrMultiple } from "@shepherdjerred/dagger-utils/containers";

@object()
export class StarlightKarmaBot {
  /**
   * Run CI pipeline: build, push, and deploy
   */
  @func()
  async ci(
    @argument({
      ignore: ["**/node_modules", ".dagger", "*.log", ".env*", "!.env.example"],
      defaultPath: ".",
    })
    source: Directory,
    version: string,
    gitSha: string,
    ghcrUsername: string,
    ghcrPassword: Secret,
    ghToken: Secret,
  ): Promise<string> {
    // Build the Docker image using Dockerfile
    const image = source.dockerBuild({
      buildArgs: [
        { name: "VERSION", value: version },
        { name: "GIT_SHA", value: gitSha },
      ],
    });

    // Push to GHCR with both version tag and latest tag
    const imageRefs = [
      `ghcr.io/shepherdjerred/starlight-karma-bot:${version}`,
      "ghcr.io/shepherdjerred/starlight-karma-bot:latest",
    ];

    await publishToGhcrMultiple({
      container: image,
      imageRefs,
      username: ghcrUsername,
      password: ghcrPassword,
    });

    // Deploy to homelab
    const deployResult = await updateHomelabVersion({
      ghToken,
      appName: "starlight-karma-bot/beta",
      version,
    });

    return `Published ${imageRefs.join(", ")} and ${deployResult}`;
  }

  /**
   * Build and push Docker image to GHCR (without deploy)
   */
  @func()
  async buildAndPush(
    @argument({
      ignore: ["**/node_modules", ".dagger", "*.log", ".env*", "!.env.example"],
      defaultPath: ".",
    })
    source: Directory,
    version: string,
    gitSha: string,
    ghcrUsername: string,
    ghcrPassword: Secret,
  ): Promise<string> {
    // Build the Docker image using Dockerfile
    const image = source.dockerBuild({
      buildArgs: [
        { name: "VERSION", value: version },
        { name: "GIT_SHA", value: gitSha },
      ],
    });

    // Push to GHCR with both version tag and latest tag
    const imageRefs = [
      `ghcr.io/shepherdjerred/starlight-karma-bot:${version}`,
      "ghcr.io/shepherdjerred/starlight-karma-bot:latest",
    ];

    const refs = await publishToGhcrMultiple({
      container: image,
      imageRefs,
      username: ghcrUsername,
      password: ghcrPassword,
    });

    return `Published: ${refs.join(", ")}`;
  }

  /**
   * Deploy to homelab by updating version in homelab repo and creating an auto-merge PR
   */
  @func()
  async deploy(version: string, stage: string, ghToken: Secret): Promise<string> {
    return await updateHomelabVersion({
      ghToken,
      appName: `starlight-karma-bot/${stage}`,
      version,
    });
  }
}
