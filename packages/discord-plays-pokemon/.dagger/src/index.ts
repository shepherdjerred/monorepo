import { func, argument, Directory, object, Secret, Container, dag } from "@dagger.io/dagger";
import { logWithTimestamp, withTiming } from "@shepherdjerred/dagger-utils";
import { syncToS3 } from "@shepherdjerred/dagger-utils/containers";
import { lintCommon, buildCommon, testCommon } from "./common";
import { lintBackend, buildBackend, testBackend } from "./backend";
import { lintFrontend, buildFrontend, testFrontend } from "./frontend";
import { buildDockerImage, publishDockerImage } from "./docker";
import { getBunContainer } from "./base";

@object()
export class DiscordPlaysPokemon {
  /**
   * Run all checks (lint and test) for all packages
   * @param source The source directory
   * @returns A message indicating completion
   */
  @func()
  async check(
    @argument({
      ignore: ["**/node_modules", "**/dist", "**/build", "**/.cache", "*.log", ".env*", "!.env.example", ".dagger", "**/coverage", "common.tgz", "packages/frontend/public/emulatorjs", "packages/frontend/public/roms"],
      defaultPath: ".",
    })
    source: Directory,
  ): Promise<string> {
    const operations = [
      () =>
        withTiming("Common lint", async () => {
          await lintCommon(source).sync();
        }),
      () =>
        withTiming("Common test", async () => {
          await testCommon(source).sync();
        }),
      () =>
        withTiming("Backend lint", async () => {
          await (await lintBackend(source)).sync();
        }),
      () =>
        withTiming("Backend test", async () => {
          await (await testBackend(source)).sync();
        }),
      () =>
        withTiming("Frontend lint", async () => {
          await (await lintFrontend(source)).sync();
        }),
      () =>
        withTiming("Frontend test", async () => {
          await (await testFrontend(source)).sync();
        }),
    ];

    // Run all operations in parallel
    await Promise.all(operations.map((op) => op()));

    return "All checks passed successfully!";
  }

  /**
   * Build all packages
   * @param source The source directory
   * @param version The version tag
   * @param gitSha The git SHA
   * @returns A message indicating completion
   */
  @func()
  async build(
    @argument({
      ignore: ["**/node_modules", "**/dist", "**/build", "**/.cache", "*.log", ".env*", "!.env.example", ".dagger", "**/coverage", "common.tgz", "packages/frontend/public/emulatorjs", "packages/frontend/public/roms"],
      defaultPath: ".",
    })
    source: Directory,
    @argument() version: string,
    @argument() gitSha: string,
  ): Promise<string> {
    const operations = [
      () =>
        withTiming("Common build", async () => {
          await buildCommon(source).sync();
        }),
      () =>
        withTiming("Backend build", async () => {
          await (await buildBackend(source)).sync();
        }),
      () =>
        withTiming("Frontend build", async () => {
          await (await buildFrontend(source)).sync();
        }),
    ];

    // Run all operations in parallel
    await Promise.all(operations.map((op) => op()));

    return `All packages built successfully for version ${version} (${gitSha})`;
  }

  /**
   * Run prettier formatting check
   * @param source The source directory
   * @returns A message indicating completion
   */
  @func()
  async prettier(
    @argument({
      ignore: ["**/node_modules", "**/dist", "**/build", "**/.cache", "*.log", ".env*", "!.env.example", ".dagger", "**/coverage", "common.tgz", "packages/frontend/public/emulatorjs", "packages/frontend/public/roms"],
      defaultPath: ".",
    })
    source: Directory,
  ): Promise<string> {
    await withTiming("Prettier check", async () => {
      await getBunContainer(source)
        .withExec(["bun", "install", "--frozen-lockfile"])
        .withExec(["bun", "run", "prettier"])
        .sync();
    });

    return "Prettier formatting check passed!";
  }

  /**
   * Run markdownlint check
   * @param source The source directory
   * @returns A message indicating completion
   */
  @func()
  async markdownlint(
    @argument({
      ignore: ["**/node_modules", "**/dist", "**/build", "**/.cache", "*.log", ".env*", "!.env.example", ".dagger", "**/coverage", "common.tgz", "packages/frontend/public/emulatorjs", "packages/frontend/public/roms"],
      defaultPath: ".",
    })
    source: Directory,
  ): Promise<string> {
    await withTiming("Markdownlint check", async () => {
      await dag
        .container()
        .from("davidanson/markdownlint-cli2")
        .withDirectory("/workspace", source)
        .withWorkdir("/workspace")
        .withExec(["markdownlint-cli2", "**/*.md"])
        .sync();
    });

    return "Markdownlint check passed!";
  }

  /**
   * Build the Docker image
   * @param source The source directory
   * @param version The version tag
   * @param gitSha The git SHA
   * @returns The built container
   */
  @func()
  async buildImage(
    @argument({
      ignore: ["**/node_modules", "**/dist", "**/build", "**/.cache", "*.log", ".env*", "!.env.example", ".dagger", "**/coverage", "common.tgz", "packages/frontend/public/emulatorjs", "packages/frontend/public/roms"],
      defaultPath: ".",
    })
    source: Directory,
    @argument() version: string,
    @argument() gitSha: string,
  ): Promise<Container> {
    return await withTiming("Docker image build", async () => {
      return await buildDockerImage(source, version, gitSha);
    });
  }

  /**
   * Publish the Docker image
   * @param source The source directory
   * @param version The version tag
   * @param gitSha The git SHA
   * @param ghcrUsername Optional GHCR username for authentication
   * @param ghcrPassword Optional GHCR password for authentication
   * @returns The published image references
   */
  @func()
  async publishImage(
    @argument({
      ignore: ["**/node_modules", "**/dist", "**/build", "**/.cache", "*.log", ".env*", "!.env.example", ".dagger", "**/coverage", "common.tgz", "packages/frontend/public/emulatorjs", "packages/frontend/public/roms"],
      defaultPath: ".",
    })
    source: Directory,
    @argument() version: string,
    @argument() gitSha: string,
    ghcrUsername?: string,
    ghcrPassword?: Secret,
  ): Promise<string[]> {
    return await withTiming("Docker image publish", async () => {
      return await publishDockerImage(source, version, gitSha, ghcrUsername, ghcrPassword);
    });
  }

  /**
   * Run the complete CI pipeline
   * @param source The source directory
   * @param version The version tag
   * @param gitSha The git SHA
   * @param ghcrUsername Optional GHCR username for authentication
   * @param ghcrPassword Optional GHCR password for authentication
   * @param env The environment (dev/prod)
   * @returns A message indicating completion
   */
  @func()
  async ci(
    @argument({
      ignore: ["**/node_modules", "**/dist", "**/build", "**/.cache", "*.log", ".env*", "!.env.example", ".dagger", "**/coverage", "common.tgz", "packages/frontend/public/emulatorjs", "packages/frontend/public/roms"],
      defaultPath: ".",
    })
    source: Directory,
    @argument() version: string,
    @argument() gitSha: string,
    ghcrUsername?: string,
    ghcrPassword?: Secret,
    env?: string,
  ): Promise<string> {
    logWithTimestamp(`Starting CI pipeline for version ${version} in ${env || "dev"} environment`);

    // Step 1: Run all checks
    await withTiming("All checks", async () => {
      await this.check(source);
    });

    // Step 2: Run linting checks
    await withTiming("Prettier check", async () => {
      await this.prettier(source);
    });

    await withTiming("Markdownlint check", async () => {
      await this.markdownlint(source);
    });

    // Step 3: Build all packages
    await withTiming("Build all packages", async () => {
      await this.build(source, version, gitSha);
    });

    // Step 4: Build Docker image
    await withTiming("Build Docker image", async () => {
      await this.buildImage(source, version, gitSha);
    });

    // Step 5: Publish Docker image (only for prod environment)
    if (env === "prod" && ghcrUsername && ghcrPassword) {
      const refs = await withTiming("Publish Docker image", async () => {
        return await this.publishImage(source, version, gitSha, ghcrUsername, ghcrPassword);
      });
      logWithTimestamp(`Published Docker image: ${refs.join(", ")}`);
    }

    const completionMessage = `CI pipeline completed successfully for version ${version} (${gitSha}) in ${env || "dev"} environment`;
    logWithTimestamp(completionMessage);
    return completionMessage;
  }

  /**
   * Build the MkDocs documentation
   * @param source The source directory
   * @returns The built docs directory
   */
  @func()
  async buildDocs(
    @argument({
      ignore: ["**/node_modules", "**/dist", "**/build", "**/.cache", "*.log", ".env*", "!.env.example", ".dagger", "**/coverage", "common.tgz", "packages/frontend/public/emulatorjs", "packages/frontend/public/roms"],
      defaultPath: ".",
    })
    source: Directory,
  ): Promise<Directory> {
    logWithTimestamp("Building MkDocs documentation...");

    const container = dag
      .container()
      .from("squidfunk/mkdocs-material:latest")
      .withDirectory("/docs", source.directory("docs"))
      .withWorkdir("/docs")
      .withExec(["build"]);

    const docsDir = container.directory("/docs/site");

    logWithTimestamp("MkDocs documentation built successfully");
    return docsDir;
  }

  /**
   * Deploy docs to S3 (SeaweedFS)
   * @param source The source directory
   * @param s3AccessKeyId S3 access key ID
   * @param s3SecretAccessKey S3 secret access key
   * @returns The sync output
   */
  @func()
  async deployDocsToS3(
    @argument({
      ignore: ["**/node_modules", "**/dist", "**/build", "**/.cache", "*.log", ".env*", "!.env.example", ".dagger", "**/coverage", "common.tgz", "packages/frontend/public/emulatorjs", "packages/frontend/public/roms"],
      defaultPath: ".",
    })
    source: Directory,
    @argument() s3AccessKeyId: Secret,
    @argument() s3SecretAccessKey: Secret,
  ): Promise<string> {
    logWithTimestamp("Deploying docs to S3...");

    const docsDir = await this.buildDocs(source);

    const syncOutput = await syncToS3({
      sourceDir: docsDir,
      bucketName: "dpp-docs",
      endpointUrl: "http://seaweedfs-s3.seaweedfs.svc.cluster.local:8333",
      accessKeyId: s3AccessKeyId,
      secretAccessKey: s3SecretAccessKey,
      region: "us-east-1",
      deleteRemoved: true,
    });

    logWithTimestamp("Docs deployed to S3 successfully");
    return syncOutput;
  }
}
