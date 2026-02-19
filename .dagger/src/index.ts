import type { Secret, Directory, Container, File } from "@dagger.io/dagger";
import { dag, object, func } from "@dagger.io/dagger";
import { syncToS3 } from "./lib-s3.ts";
import versions from "./lib-versions.ts";
import { reviewPr, handleInteractive } from "./code-review.ts";
import { updateReadmes as updateReadmesFn } from "./update-readme.ts";
import {
  checkHomelab,
  ciHomelab,
  homelabHelmBuild as homelabHelmBuildFn,
  homelabTestHelm as homelabTestHelmFn,
  homelabTestRenovateRegex as homelabTestRenovateRegexFn,
  homelabSync as homelabSyncFn,
} from "./homelab-index.ts";
import { Stage as HomelabStage } from "./lib-types.ts";
import {
  installWorkspaceDeps,
  setupPrisma,
  buildClauderonWeb,
  runPackageValidation,
  runReleasePhase,
} from "./index-ci-helpers.ts";
import type { ReleasePhaseOptions } from "./index-ci-helpers.ts";
import {
  checkBirmel,
  buildBirmelImage,
  smokeTestBirmelImageWithContainer,
} from "./birmel.ts";
import {
  getRustContainer,
  getCrossCompileContainer,
  uploadReleaseAssets,
  getReleasePleaseContainer,
  runReleasePleaseCommand,
  complianceCheck,
  qualityRatchet,
  shellcheckStep,
  actionlintStep,
  knipCheck,
  trivyScan,
  semgrepScan,
  CLAUDERON_TARGETS,
  runMobileCi,
  runClauderonCi,
} from "./index-infra.ts";
import { withTiming } from "./lib-timing.ts";
import { runNamedParallel } from "./lib-parallel.ts";

const BUN_VERSION = versions.bun;
const LATEX_IMAGE = "blang/latex:ubuntu";

@object()
export class Monorepo {
  /**
   * Run the full CI/CD pipeline.
   */
  @func()
  async ci(
    source: Directory,
    branch: string,
    githubToken?: Secret,
    npmToken?: Secret,
    version?: string,
    gitSha?: string,
    registryUsername?: string,
    registryPassword?: Secret,
    s3AccessKeyId?: Secret,
    s3SecretAccessKey?: Secret,
    argocdToken?: Secret,
    chartMuseumUsername?: string,
    chartMuseumPassword?: Secret,
    cloudflareApiToken?: Secret,
    cloudflareAccountId?: Secret,
    hassBaseUrl?: Secret,
    hassToken?: Secret,
    tofuGithubToken?: Secret,
    commitBackToken?: Secret,
  ): Promise<string> {
    const outputs: string[] = [];
    const isRelease = branch === "main";

    // ========================================================================
    // TIER 0: Launch all source-only work at t=0
    // These create their own containers — no dependency on bun workspace
    // ========================================================================
    const tier0Compliance = withTiming("Compliance check", () =>
      complianceCheck(source).sync().then(() => "✓ Compliance check"),
    );
    const tier0Mobile = withTiming("Mobile CI", () => this.mobileCi(source));
    const tier0BirmelImage = buildBirmelImage(source, version ?? "dev", gitSha ?? "dev");
    const tier0Birmel = withTiming("Birmel validation", () =>
      this.birmelValidation(source, version ?? "dev", gitSha ?? "dev"),
    );
    const tier0Packages = withTiming("Package validation", () =>
      this.packageValidation(source, hassBaseUrl, hassToken),
    );
    const tier0Quality = withTiming("Quality & security checks", () =>
      this.qualityChecks(source),
    );

    // Guard: suppress unhandled rejection warnings if critical path throws
    // before we get to collect tier 0 results
    const allTier0 = [tier0Compliance, tier0Mobile, tier0Birmel, tier0Packages, tier0Quality];
    Promise.allSettled(allTier0);

    // ========================================================================
    // TIER 1: Critical path — bun install + TypeShare in parallel
    // ========================================================================
    const typeSharePromise = withTiming("TypeShare generation", async () => {
      const rc = getRustContainer(source, undefined, s3AccessKeyId, s3SecretAccessKey)
        .withExec(["cargo", "install", "typeshare-cli", "--locked"])
        .withExec(["typeshare", ".", "--lang=typescript", "--output-file=web/shared/src/generated/index.ts"]);
      await rc.sync();
      return rc;
    });

    const bunSetupPromise = withTiming("Bun install + Prisma", async () => {
      const c = installWorkspaceDeps(source);
      return setupPrisma(c);
    });

    const [rustContainer, prismaResult] = await Promise.all([typeSharePromise, bunSetupPromise]);
    let container = prismaResult.container;
    outputs.push("✓ Install");
    outputs.push(...prismaResult.outputs);

    // Web build (needs both TypeShare types and bun workspace)
    outputs.push("\n--- Clauderon TypeScript Type Generation ---");
    const webResult = await withTiming("Web build", () =>
      buildClauderonWeb(container, rustContainer),
    );
    container = webResult.container;
    outputs.push(...webResult.outputs);

    // ========================================================================
    // TIER 2: Clauderon Rust CI + monorepo build in parallel
    // Both need web build output
    // ========================================================================
    const [clauderonResult, buildResult] = await Promise.allSettled([
      withTiming("Clauderon Rust CI", () =>
        this.clauderonCi(source, webResult.frontendDist, s3AccessKeyId, s3SecretAccessKey),
      ),
      withTiming("Monorepo build", async () => {
        const c = container.withExec(["bun", "run", "build"]);
        await c.sync();
        return c;
      }),
    ]);

    outputs.push("::group::Clauderon Rust Validation");
    if (clauderonResult.status === "fulfilled") {
      outputs.push(clauderonResult.value);
      outputs.push("::endgroup::");
    } else {
      outputs.push("::endgroup::");
      const reason = clauderonResult.reason;
      throw reason instanceof Error ? reason : new Error(String(reason));
    }

    if (buildResult.status === "fulfilled") {
      container = buildResult.value;
      outputs.push("✓ Build");
    } else {
      const reason = buildResult.reason;
      throw reason instanceof Error ? reason : new Error(String(reason));
    }

    // ========================================================================
    // TIER 3: knipCheck (needs fully-built container) + collect tier 0
    // ========================================================================
    try {
      await knipCheck(container).sync();
      outputs.push("✓ Knip");
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      outputs.push(`::warning title=Knip::${msg.slice(0, 200)}`);
      outputs.push(`⚠ Knip (non-blocking): ${msg}`);
    }

    // Collect TIER 0 results (have been running throughout critical path)
    outputs.push(await tier0Compliance);

    outputs.push("::group::Clauderon Mobile Validation");
    outputs.push(await tier0Mobile);
    outputs.push("::endgroup::");

    outputs.push("::group::Birmel Validation");
    outputs.push(await tier0Birmel);
    outputs.push("::endgroup::");

    outputs.push("::group::Package Validation");
    outputs.push(await tier0Packages);
    outputs.push("::endgroup::");

    outputs.push("::group::Quality & Security Checks");
    outputs.push(await tier0Quality);
    outputs.push("::endgroup::");

    // RELEASE PHASE
    if (isRelease && githubToken !== undefined && npmToken !== undefined) {
      outputs.push("\n--- Release Workflow ---");
      const releaseOptions: ReleasePhaseOptions = {
        source, container, githubToken, npmToken,
        version, gitSha, registryUsername, registryPassword,
        s3AccessKeyId, s3SecretAccessKey, argocdToken,
        chartMuseumUsername, chartMuseumPassword,
        cloudflareApiToken, cloudflareAccountId,
        hassBaseUrl, hassToken, tofuGithubToken, commitBackToken,
        birmelImage: tier0BirmelImage,
        releasePleaseRunFn: runReleasePleaseCommand,
        getReleasePleaseContainerFn: getReleasePleaseContainer,
        multiplexerBuildFn: (s, k, sk) => this.multiplexerBuild(s, k, sk),
        uploadReleaseAssetsFn: uploadReleaseAssets,
        clauderonTargets: CLAUDERON_TARGETS,
        muxSiteDeployFn: (s, k, sk) => this.muxSiteDeploy(s, k, sk),
        resumeDeployFn: (s, k, sk) => this.resumeDeploy(s, k, sk),
      };

      const releaseResult = await runReleasePhase(releaseOptions);
      outputs.push(...releaseResult.outputs);

      if (releaseResult.errors.length > 0) {
        outputs.push(`\n--- Release Phase Failed ---`);
        outputs.push(`${String(releaseResult.errors.length)} error(s) occurred during release:`);
        releaseResult.errors.forEach((err, i) => outputs.push(`  ${String(i + 1)}. ${err}`));
        throw new Error(
          `Release phase failed with ${String(releaseResult.errors.length)} error(s):\n${releaseResult.errors.join("\n")}`,
        );
      }
    }

    return outputs.join("\n");
  }

  /**
   * Run all package-specific validation checks in parallel.
   */
  @func()
  async packageValidation(source: Directory, hassBaseUrl?: Secret, hassToken?: Secret): Promise<string> {
    const result = await runPackageValidation(source, hassBaseUrl, hassToken);
    const outputs = [...result.outputs];
    if (result.errors.length > 0) {
      throw new Error(
        `Package validation failed with ${String(result.errors.length)} error(s):\n${result.errors.join("\n")}\n\n${outputs.join("\n")}`,
      );
    }
    return outputs.join("\n");
  }

  /**
   * Run quality and security checks (shellcheck, actionlint, trivy, semgrep, quality ratchet).
   */
  @func()
  async qualityChecks(source: Directory): Promise<string> {
    const results = await runNamedParallel<string>([
      { name: "Quality ratchet", operation: () => qualityRatchet(source).sync().then(() => "✓ Quality ratchet") },
      { name: "Shellcheck", operation: () => shellcheckStep(source).sync().then(() => "✓ Shellcheck") },
      { name: "Actionlint", operation: () => actionlintStep(source).sync().then(() => "✓ Actionlint") },
      { name: "Trivy", operation: () => trivyScan(source).sync().then(() => "✓ Trivy") },
      { name: "Semgrep", operation: () => semgrepScan(source).sync().then(() => "✓ Semgrep") },
    ]);
    const outputs: string[] = [];
    for (const result of results) {
      if (result.success) {
        outputs.push(String(result.value));
      } else {
        const msg = result.error instanceof Error ? result.error.message : String(result.error);
        const truncated = msg.slice(0, 200);
        outputs.push(`::warning title=${result.name}::${truncated}`);
        outputs.push(`⚠ ${result.name} (non-blocking): ${msg}`);
      }
    }
    return outputs.join("\n");
  }

  /**
   * Run birmel CI, build image, and smoke test.
   */
  @func()
  async birmelValidation(source: Directory, version: string, gitSha: string): Promise<string> {
    const outputs: string[] = [];
    const [ciResult, image] = await Promise.all([
      checkBirmel(source),
      Promise.resolve(buildBirmelImage(source, version, gitSha)),
    ]);
    outputs.push(ciResult);
    outputs.push(await smokeTestBirmelImageWithContainer(image));
    return outputs.join("\n");
  }

  @func()
  async birmelCi(source: Directory): Promise<string> {
    return checkBirmel(source);
  }

  @func()
  birmelBuild(source: Directory, version: string, gitSha: string): Container {
    return buildBirmelImage(source, version, gitSha);
  }

  @func()
  async birmelSmokeTest(source: Directory, version: string, gitSha: string): Promise<string> {
    const image = buildBirmelImage(source, version, gitSha);
    return smokeTestBirmelImageWithContainer(image);
  }

  @func()
  async birmelPublish(
    source: Directory, version: string, gitSha: string,
    registryUsername: string, registryPassword: Secret,
  ): Promise<string> {
    const image = buildBirmelImage(source, version, gitSha);
    const { publishBirmelImageWithContainer } = await import("./birmel.ts");
    const refs = await publishBirmelImageWithContainer({
      image, version, gitSha,
      registryAuth: { username: registryUsername, password: registryPassword },
    });
    return `Published:\n${refs.join("\n")}`;
  }

  @func()
  async birmelRelease(
    source: Directory, version: string, gitSha: string,
    registryUsername: string, registryPassword: Secret,
  ): Promise<string> {
    const outputs: string[] = [];
    outputs.push(await this.birmelCi(source));
    const birmelImage = buildBirmelImage(source, version, gitSha);
    outputs.push(await smokeTestBirmelImageWithContainer(birmelImage));
    const { publishBirmelImageWithContainer } = await import("./birmel.ts");
    const refs = await publishBirmelImageWithContainer({
      image: birmelImage, version, gitSha,
      registryAuth: { username: registryUsername, password: registryPassword },
    });
    outputs.push(`Published:\n${refs.join("\n")}`);
    return outputs.join("\n\n");
  }

  @func()
  async mobileCi(source: Directory): Promise<string> {
    return runMobileCi(source);
  }

  @func()
  async clauderonCi(
    source: Directory, frontendDist?: Directory,
    s3AccessKeyId?: Secret, s3SecretAccessKey?: Secret,
  ): Promise<string> {
    return runClauderonCi(source, frontendDist, s3AccessKeyId, s3SecretAccessKey);
  }

  @func()
  multiplexerBuild(source: Directory, s3AccessKeyId?: Secret, s3SecretAccessKey?: Secret): Directory {
    const container = getCrossCompileContainer(source, s3AccessKeyId, s3SecretAccessKey);
    const linuxTargets = CLAUDERON_TARGETS.filter((t) => t.os === "linux");
    let outputContainer = dag.directory();

    for (const { target, os, arch } of linuxTargets) {
      // Per-target cache volume to avoid Dagger serializing access
      let buildContainer = container
        .withEnvVariable("CARGO_TARGET_DIR", `/workspace/target-cross-${arch}`)
        .withMountedCache(`/workspace/target-cross-${arch}`, dag.cacheVolume(`clauderon-cross-target-${arch}`));

      if (target === "aarch64-unknown-linux-gnu") {
        const cargoConfig = `
[registries.crates-io]
protocol = "sparse"

[build]
jobs = -1

[target.x86_64-unknown-linux-gnu]
linker = "clang"
rustflags = ["-C", "link-arg=-fuse-ld=mold"]

[target.aarch64-unknown-linux-gnu]
linker = "aarch64-linux-gnu-gcc"

[net]
retry = 3
`;
        buildContainer = buildContainer
          .withNewFile("/workspace/.cargo/config.toml", cargoConfig)
          .withEnvVariable("OPENSSL_DIR", "/usr")
          .withEnvVariable("OPENSSL_LIB_DIR", "/usr/lib/aarch64-linux-gnu")
          .withEnvVariable("OPENSSL_INCLUDE_DIR", "/usr/include")
          .withEnvVariable("PKG_CONFIG_ALLOW_CROSS", "1")
          .withEnvVariable("PKG_CONFIG_PATH", "/usr/lib/aarch64-linux-gnu/pkgconfig");
      }

      buildContainer = buildContainer.withExec(["cargo", "build", "--release", "--target", target]);
      const binaryPath = `/workspace/target-cross-${arch}/${target}/release/clauderon`;
      const filename = `clauderon-${os}-${arch}`;
      outputContainer = outputContainer.withFile(filename, buildContainer.file(binaryPath));
    }

    return outputContainer;
  }

  @func()
  async multiplexerRelease(
    source: Directory, version: string, githubToken: Secret,
    s3AccessKeyId?: Secret, s3SecretAccessKey?: Secret,
  ): Promise<string> {
    const outputs: string[] = [];

    outputs.push("--- Clauderon CI ---");
    outputs.push(await this.clauderonCi(source, undefined, s3AccessKeyId, s3SecretAccessKey));

    outputs.push("\n--- Building Binaries ---");
    const binaries = this.multiplexerBuild(source, s3AccessKeyId, s3SecretAccessKey);

    const linuxTargets = CLAUDERON_TARGETS.filter((t) => t.os === "linux");
    const filenames = linuxTargets.map(({ os, arch }) => `clauderon-${os}-${arch}`);
    for (const filename of filenames) { outputs.push(`✓ Built ${filename}`); }

    outputs.push("\n--- Uploading to GitHub Release ---");
    const uploadResults = await uploadReleaseAssets(githubToken, version, binaries, filenames);
    outputs.push(...uploadResults.outputs);

    if (uploadResults.errors.length > 0) {
      throw new Error(`Failed to upload ${String(uploadResults.errors.length)} asset(s):\n${uploadResults.errors.join("\n")}`);
    }

    return outputs.join("\n");
  }

  @func()
  muxSiteBuild(source: Directory): Container {
    return dag.container()
      .from(`oven/bun:${BUN_VERSION}-debian`)
      .withMountedCache("/root/.bun/install/cache", dag.cacheVolume("bun-cache"))
      .withWorkdir("/workspace")
      .withDirectory("/workspace", source.directory("packages/clauderon/docs"))
      .withExec(["bun", "install"])
      .withExec(["bun", "run", "build"]);
  }

  @func()
  muxSiteOutput(source: Directory): Directory {
    return this.muxSiteBuild(source).directory("/workspace/dist");
  }

  @func()
  async muxSiteDeploy(source: Directory, s3AccessKeyId: Secret, s3SecretAccessKey: Secret): Promise<string> {
    const outputs: string[] = [];
    const siteDir = this.muxSiteOutput(source);
    outputs.push("✓ Built clauderon docs");

    const syncOutput = await syncToS3({
      sourceDir: siteDir, bucketName: "clauderon",
      endpointUrl: "https://seaweedfs.sjer.red",
      accessKeyId: s3AccessKeyId, secretAccessKey: s3SecretAccessKey,
      region: "us-east-1", deleteRemoved: true,
    });

    outputs.push("✓ Deployed to SeaweedFS S3 (bucket: clauderon)");
    outputs.push(syncOutput);
    return outputs.join("\n");
  }

  @func()
  resumeBuild(source: Directory): File {
    return dag.container()
      .from(LATEX_IMAGE)
      .withMountedDirectory("/workspace", source.directory("packages/resume"))
      .withWorkdir("/workspace")
      .withExec(["pdflatex", "resume.tex"])
      .file("/workspace/resume.pdf");
  }

  @func()
  resumeOutput(source: Directory): Directory {
    const pdf = this.resumeBuild(source);
    const resumeDir = source.directory("packages/resume");
    return dag.directory()
      .withFile("resume.pdf", pdf)
      .withFile("index.html", resumeDir.file("index.html"));
  }

  @func()
  async resumeDeploy(source: Directory, s3AccessKeyId: Secret, s3SecretAccessKey: Secret): Promise<string> {
    const outputs: string[] = [];
    const outputDir = this.resumeOutput(source);
    outputs.push("✓ Built resume.pdf");

    const syncOutput = await syncToS3({
      sourceDir: outputDir, bucketName: "resume",
      endpointUrl: "https://seaweedfs.sjer.red",
      accessKeyId: s3AccessKeyId, secretAccessKey: s3SecretAccessKey,
      region: "us-east-1", deleteRemoved: true,
    });

    outputs.push("✓ Deployed to SeaweedFS S3 (bucket: resume)");
    outputs.push(syncOutput);
    return outputs.join("\n");
  }

  @func()
  async codeReview(
    source: Directory, githubToken: Secret, claudeOauthToken: Secret,
    prNumber: number, baseBranch: string, headSha: string,
  ): Promise<string> {
    return reviewPr({ source, githubToken, claudeOauthToken, prNumber, baseBranch, headSha });
  }

  @func()
  async codeReviewInteractive(
    source: Directory, githubToken: Secret, claudeOauthToken: Secret,
    prNumber: number, commentBody: Secret,
    commentPath?: string, commentLine?: number, commentDiffHunk?: string,
  ): Promise<string> {
    const bodyText = await commentBody.plaintext();
    return handleInteractive({
      source, githubToken, claudeOauthToken, prNumber,
      commentBody: bodyText,
      eventContext: commentPath === undefined
        ? undefined
        : { path: commentPath, line: commentLine, diffHunk: commentDiffHunk },
    });
  }

  @func()
  async homelabCi(
    source: Directory, argocdToken: Secret, ghcrUsername: string, ghcrPassword: Secret,
    chartVersion: string, chartMuseumUsername: string, chartMuseumPassword: Secret,
    cloudflareApiToken: Secret, cloudflareAccountId: Secret,
    awsAccessKeyId: Secret, awsSecretAccessKey: Secret,
    hassBaseUrl?: Secret, hassToken?: Secret, tofuGithubToken?: Secret,
  ): Promise<string> {
    return ciHomelab(source, HomelabStage.Prod, {
      argocdToken, ghcrUsername, ghcrPassword, chartVersion,
      chartMuseumUsername, chartMuseumPassword,
      cloudflareApiToken, cloudflareAccountId,
      awsAccessKeyId, awsSecretAccessKey,
      ...(hassBaseUrl === undefined ? {} : { hassBaseUrl }),
      ...(hassToken === undefined ? {} : { hassToken }),
      ...(tofuGithubToken === undefined ? {} : { tofuGithubToken }),
    });
  }

  @func()
  async homelabCheckAll(source: Directory, hassBaseUrl?: Secret, hassToken?: Secret): Promise<string> {
    return checkHomelab(source, hassBaseUrl, hassToken);
  }

  @func()
  homelabHelmBuild(source: Directory, version: string): Directory {
    return homelabHelmBuildFn(source, version);
  }

  @func()
  async homelabSync(argocdToken: Secret): Promise<string> {
    return homelabSyncFn(argocdToken);
  }

  @func()
  async homelabTestHelm(source: Directory): Promise<string> {
    return homelabTestHelmFn(source);
  }

  @func()
  async homelabTestRenovateRegex(source: Directory): Promise<string> {
    return homelabTestRenovateRegexFn(source);
  }

  @func()
  async updateReadmes(
    source: Directory, githubToken: Secret, openaiApiKey: Secret, baseBranch = "main",
  ): Promise<string> {
    return await updateReadmesFn({ source, githubToken, openaiApiKey, baseBranch });
  }
}
