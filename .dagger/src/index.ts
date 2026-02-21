import type { Secret, Directory, Container, File } from "@dagger.io/dagger";
import { object, func } from "@dagger.io/dagger";
import { reviewPr, handleInteractiveFromSecret } from "./code-review.ts";
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
  collectTier0Results,
  handleTier2Results,
  handleTier3Results,
} from "./index-ci-helpers.ts";
import type { ReleasePhaseOptions } from "./index-ci-helpers.ts";
import {
  checkBirmel,
  buildBirmelImage,
  smokeTestBirmelImageWithContainer,
  runBirmelValidation,
  publishBirmel,
  releaseBirmel,
} from "./birmel.ts";
import {
  getRustContainer,
  getReleasePleaseContainer,
  runReleasePleaseCommand,
  complianceCheck,
  knipCheck,
  runQualityChecks,
  uploadReleaseAssets,
  CLAUDERON_TARGETS,
} from "./index-infra.ts";
import { runMobileCi, runClauderonCi } from "./index-platform-ci.ts";
import {
  buildMuxSiteContainer,
  getMuxSiteOutput,
  deployMuxSite,
  buildResumeFile,
  getResumeOutput,
  deployResumeSite,
  buildMultiplexerBinaries,
  releaseMultiplexer,
} from "./index-build-deploy-helpers.ts";
import { withTiming } from "./lib-timing.ts";

@object()
export class Monorepo {
  /** Run the full CI/CD pipeline. */
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

    // === TIER 0: Launch all source-only work at t=0 ===
    const tier0Compliance = withTiming("Compliance check", async () => {
      await complianceCheck(source).sync();
      return "✓ Compliance check";
    });
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
    void Promise.allSettled([tier0Compliance, tier0Mobile, tier0Birmel, tier0Packages, tier0Quality]);

    // === TIER 1: Critical path — bun install + TypeShare in parallel ===
    const typeSharePromise = withTiming("TypeShare generation", async () => {
      const rc = getRustContainer(source, undefined, s3AccessKeyId, s3SecretAccessKey)
        .withExec(["cargo", "install", "typeshare-cli", "--locked", "--force", "--root", "/root/.cargo-tools"])
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
    outputs.push("✓ Install", ...prismaResult.outputs);

    // Web build (needs both TypeShare types and bun workspace)
    outputs.push("\n--- Clauderon TypeScript Type Generation ---");
    const webResult = await withTiming("Web build", () => buildClauderonWeb(container, rustContainer));
    container = webResult.container;
    outputs.push(...webResult.outputs);

    // === TIER 2: Clauderon Rust CI + monorepo build in parallel ===
    const [clauderonResult, buildResult] = await Promise.allSettled([
      withTiming("Clauderon Rust CI", () =>
        this.clauderonCi(source, webResult.frontendDist, s3AccessKeyId, s3SecretAccessKey),
      ),
      withTiming("Monorepo build", async () => {
        const webringBuilt = container.withWorkdir("/workspace/packages/webring").withExec(["bun", "run", "build"]);
        const webringDist = webringBuilt.directory("/workspace/packages/webring/dist");
        const c = container
          .withMountedDirectory("/workspace/packages/webring/dist", webringDist)
          .withWorkdir("/workspace")
          // sjer.red needs Playwright for rehype-mermaid; validated separately in tier 0
          .withEnvVariable("SKIP_PACKAGES", "sjer.red")
          .withExec(["bun", "run", "build"]);
        await c.sync();
        return c;
      }),
    ]);
    container = handleTier2Results(clauderonResult, buildResult, outputs);

    // === TIER 3: knipCheck + collect tier 0 ===
    const [knipResult, tier0Result] = await Promise.allSettled([
      knipCheck(container).sync(),
      collectTier0Results({
        compliance: tier0Compliance,
        mobile: tier0Mobile,
        birmel: tier0Birmel,
        packages: tier0Packages,
        quality: tier0Quality,
      }),
    ]);
    handleTier3Results(knipResult, tier0Result, outputs);

    // RELEASE PHASE
    if (isRelease && githubToken !== undefined && npmToken !== undefined) {
      outputs.push("\n--- Release Workflow ---");
      const releaseOptions: ReleasePhaseOptions = {
        source, container, githubToken, npmToken, version, gitSha,
        registryUsername, registryPassword, s3AccessKeyId, s3SecretAccessKey,
        argocdToken, chartMuseumUsername, chartMuseumPassword,
        cloudflareApiToken, cloudflareAccountId, hassBaseUrl, hassToken,
        tofuGithubToken, commitBackToken, birmelImage: tier0BirmelImage,
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

  @func()
  async qualityChecks(source: Directory): Promise<string> {
    return runQualityChecks(source);
  }

  @func()
  async birmelValidation(source: Directory, version: string, gitSha: string): Promise<string> {
    return runBirmelValidation(source, version, gitSha);
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
    return smokeTestBirmelImageWithContainer(buildBirmelImage(source, version, gitSha));
  }

  @func()
  async birmelPublish(
    source: Directory, version: string, gitSha: string,
    registryUsername: string, registryPassword: Secret,
  ): Promise<string> {
    return publishBirmel({ source, version, gitSha, registryUsername, registryPassword });
  }

  @func()
  async birmelRelease(
    source: Directory, version: string, gitSha: string,
    registryUsername: string, registryPassword: Secret,
  ): Promise<string> {
    return releaseBirmel({ source, version, gitSha, registryUsername, registryPassword });
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
    return buildMultiplexerBinaries(source, s3AccessKeyId, s3SecretAccessKey);
  }

  @func()
  async multiplexerRelease(
    source: Directory, version: string, githubToken: Secret,
    s3AccessKeyId?: Secret, s3SecretAccessKey?: Secret,
  ): Promise<string> {
    return releaseMultiplexer({
      source, version, githubToken, s3AccessKeyId, s3SecretAccessKey,
      clauderonCiFn: (s, fd, k, sk) => this.clauderonCi(s, fd, k, sk),
    });
  }

  @func()
  muxSiteBuild(source: Directory): Container {
    return buildMuxSiteContainer(source);
  }

  @func()
  muxSiteOutput(source: Directory): Directory {
    return getMuxSiteOutput(source);
  }

  @func()
  async muxSiteDeploy(source: Directory, s3AccessKeyId: Secret, s3SecretAccessKey: Secret): Promise<string> {
    return deployMuxSite(source, s3AccessKeyId, s3SecretAccessKey);
  }

  @func()
  resumeBuild(source: Directory): File {
    return buildResumeFile(source);
  }

  @func()
  resumeOutput(source: Directory): Directory {
    return getResumeOutput(source);
  }

  @func()
  async resumeDeploy(source: Directory, s3AccessKeyId: Secret, s3SecretAccessKey: Secret): Promise<string> {
    return deployResumeSite(source, s3AccessKeyId, s3SecretAccessKey);
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
    prNumber: number, commentBody: Secret, commentPath?: string,
    commentLine?: number, commentDiffHunk?: string,
  ): Promise<string> {
    return handleInteractiveFromSecret({
      source, githubToken, claudeOauthToken, prNumber, commentBody,
      commentPath, commentLine, commentDiffHunk,
    });
  }

  @func()
  async homelabCi(
    source: Directory, argocdToken: Secret, ghcrUsername: string,
    ghcrPassword: Secret, chartVersion: string, chartMuseumUsername: string,
    chartMuseumPassword: Secret, cloudflareApiToken: Secret,
    cloudflareAccountId: Secret, awsAccessKeyId: Secret,
    awsSecretAccessKey: Secret, hassBaseUrl?: Secret,
    hassToken?: Secret, tofuGithubToken?: Secret,
  ): Promise<string> {
    const result = await ciHomelab(source, HomelabStage.Prod, {
      argocdToken, ghcrUsername, ghcrPassword, chartVersion,
      chartMuseumUsername, chartMuseumPassword, cloudflareApiToken,
      cloudflareAccountId, awsAccessKeyId, awsSecretAccessKey,
      ...(hassBaseUrl === undefined ? {} : { hassBaseUrl }),
      ...(hassToken === undefined ? {} : { hassToken }),
      ...(tofuGithubToken === undefined ? {} : { tofuGithubToken }),
    });
    return result.summary;
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
