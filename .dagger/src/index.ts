/**
 * Monorepo CI module — hermetic lint, typecheck, test, build, and publish.
 *
 * The `pkg` argument specifies which package subdirectory to operate on.
 * Each function runs the corresponding npm script from the package's package.json.
 *
 * All implementation logic lives in helper files; this file contains only
 * the @object() class with thin @func() wrappers (Dagger TypeScript SDK constraint).
 */
import {
  Container,
  Directory,
  File,
  Secret,
  object,
  func,
} from "@dagger.io/dagger";

import { mavenBuildHelper, mavenTestHelper, mavenCoverageHelper } from "./java";

import { latexBuildHelper } from "./latex";

import {
  helmPackageHelper,
  tofuApplyHelper,
  tofuPlanHelper,
  publishNpmHelper,
  deploySiteHelper,
  deployStaticSiteHelper,
  argoCdSyncHelper,
  argoCdHealthWaitHelper,
  cooklangBuildHelper,
  cooklangPushHelper,
  cooklangCreateReleaseHelper,
  clauderonCollectBinariesHelper,
  clauderonUploadHelper,
  versionCommitBackHelper,
  releasePleaseHelper,
  codeReviewHelper,
  cargoDenyHelper,
} from "./release";

import {
  lintHelper,
  typecheckHelper,
  testHelper,
  buildHelper,
  generateAndLintHelper,
  generateAndTypecheckHelper,
  generateAndTestHelper,
} from "./typescript";

import { astroCheckHelper, astroBuildHelper, viteBuildHelper } from "./astro";

import {
  buildImageHelper,
  pushImageHelper,
  buildHomelabImageHelper,
  buildDepsSummaryImageHelper,
  buildDnsAuditImageHelper,
  buildCaddyS3ProxyImageHelper,
  pushHomelabImageHelper,
  pushDepsSummaryImageHelper,
  pushDnsAuditImageHelper,
  pushCaddyS3ProxyImageHelper,
} from "./image";

import {
  rustFmtHelper,
  rustClippyHelper,
  rustTestHelper,
  rustBuildHelper,
} from "./rust";

import { goBuildHelper, goTestHelper, goLintHelper } from "./golang";

import {
  homelabSynthHelper,
  haGenerateHelper,
  haLintHelper,
  haTypecheckHelper,
} from "./homelab";

import { swiftLintHelper } from "./swift";

import { playwrightTestHelper, playwrightUpdateHelper } from "./playwright";

import { ciAllHelper } from "./ci";

import {
  mkdocsBuildHelper,
  caddyfileValidateHelper,
  smokeTestHelper,
  smokeTestScoutForLolHelper,
  smokeTestBirmelHelper,
  smokeTestStarlightKarmaBotHelper,
  smokeTestTasknotesServerHelper,
  smokeTestHomelabHelper,
  smokeTestDepsSummaryHelper,
  smokeTestDnsAuditHelper,
  smokeTestCaddyS3ProxyHelper,
  smokeTestDiscordPlaysPokemonHelper,
  smokeTestBetterSkillCappedFetcherHelper,
} from "./misc";

@object()
export class Monorepo {
  // ---------------------------------------------------------------------------
  // Standard TS operations (lint, typecheck, test)
  // ---------------------------------------------------------------------------

  /** Run the lint script on a package */
  @func()
  async lint(
    pkgDir: Directory,
    pkg: string,
    depNames: string[] = [],
    depDirs: Directory[] = [],
    tsconfig: File | null = null,
  ): Promise<string> {
    return lintHelper(pkgDir, pkg, depNames, depDirs, tsconfig).stdout();
  }

  /** Run the typecheck script on a package */
  @func()
  async typecheck(
    pkgDir: Directory,
    pkg: string,
    depNames: string[] = [],
    depDirs: Directory[] = [],
    tsconfig: File | null = null,
  ): Promise<string> {
    return typecheckHelper(pkgDir, pkg, depNames, depDirs, tsconfig).stdout();
  }

  /** Run the test script on a package */
  @func()
  async test(
    pkgDir: Directory,
    pkg: string,
    depNames: string[] = [],
    depDirs: Directory[] = [],
    tsconfig: File | null = null,
  ): Promise<string> {
    return testHelper(pkgDir, pkg, depNames, depDirs, tsconfig).stdout();
  }

  /** Run the build script on a package. Returns the Container so dist/ can be exported via CLI chaining. */
  @func()
  buildPackage(
    pkgDir: Directory,
    pkg: string,
    depNames: string[] = [],
    depDirs: Directory[] = [],
    tsconfig: File | null = null,
  ): Container {
    return buildHelper(pkgDir, pkg, depNames, depDirs, tsconfig);
  }

  // ---------------------------------------------------------------------------
  // Combined generate + action (avoids nested CLI calls / SSH serialization)
  // ---------------------------------------------------------------------------

  /** Generate then lint — chains on the same container to avoid SIGILL from bun install in fresh containers */
  @func()
  async generateAndLint(
    pkgDir: Directory,
    pkg: string,
    depNames: string[] = [],
    depDirs: Directory[] = [],
    tsconfig: File | null = null,
  ): Promise<string> {
    return generateAndLintHelper(
      pkgDir,
      pkg,
      depNames,
      depDirs,
      tsconfig,
    ).stdout();
  }

  /** Generate then typecheck — chains on the same container */
  @func()
  async generateAndTypecheck(
    pkgDir: Directory,
    pkg: string,
    depNames: string[] = [],
    depDirs: Directory[] = [],
    tsconfig: File | null = null,
  ): Promise<string> {
    return generateAndTypecheckHelper(
      pkgDir,
      pkg,
      depNames,
      depDirs,
      tsconfig,
    ).stdout();
  }

  /** Generate then test — chains on the same container */
  @func()
  async generateAndTest(
    pkgDir: Directory,
    pkg: string,
    depNames: string[] = [],
    depDirs: Directory[] = [],
    tsconfig: File | null = null,
  ): Promise<string> {
    return generateAndTestHelper(
      pkgDir,
      pkg,
      depNames,
      depDirs,
      tsconfig,
    ).stdout();
  }

  // ---------------------------------------------------------------------------
  // HA type generation (requires live Home Assistant instance)
  // ---------------------------------------------------------------------------

  /** Generate Home Assistant entity types by introspecting a live HA instance */
  @func()
  haGenerate(
    pkgDir: Directory,
    hassToken: Secret,
    depNames: string[] = [],
    depDirs: Directory[] = [],
    tsconfig: File | null = null,
    homelabTsconfig: File | null = null,
    hassBaseUrl: string = "https://homeassistant.sjer.red",
  ): Directory {
    return haGenerateHelper(
      pkgDir,
      hassToken,
      depNames,
      depDirs,
      tsconfig,
      homelabTsconfig,
      hassBaseUrl,
    );
  }

  /** Generate HA types then lint homelab/src/ha */
  @func()
  async haLint(
    pkgDir: Directory,
    hassToken: Secret,
    depNames: string[] = [],
    depDirs: Directory[] = [],
    tsconfig: File | null = null,
    homelabTsconfig: File | null = null,
  ): Promise<string> {
    return haLintHelper(
      pkgDir,
      hassToken,
      depNames,
      depDirs,
      tsconfig,
      homelabTsconfig,
    ).stdout();
  }

  /** Generate HA types then typecheck homelab/src/ha */
  @func()
  async haTypecheck(
    pkgDir: Directory,
    hassToken: Secret,
    depNames: string[] = [],
    depDirs: Directory[] = [],
    tsconfig: File | null = null,
    homelabTsconfig: File | null = null,
  ): Promise<string> {
    return haTypecheckHelper(
      pkgDir,
      hassToken,
      depNames,
      depDirs,
      tsconfig,
      homelabTsconfig,
    ).stdout();
  }

  // ---------------------------------------------------------------------------
  // Astro operations
  // ---------------------------------------------------------------------------

  /** Run astro check on a package */
  @func()
  async astroCheck(
    pkgDir: Directory,
    pkg: string,
    depNames: string[] = [],
    depDirs: Directory[] = [],
    tsconfig: File | null = null,
  ): Promise<string> {
    return astroCheckHelper(pkgDir, pkg, depNames, depDirs, tsconfig).stdout();
  }

  /** Run astro build and return the output directory */
  @func()
  astroBuild(
    pkgDir: Directory,
    pkg: string,
    depNames: string[] = [],
    depDirs: Directory[] = [],
    tsconfig: File | null = null,
  ): Directory {
    return astroBuildHelper(pkgDir, pkg, depNames, depDirs, tsconfig);
  }

  // ---------------------------------------------------------------------------
  // Vite/React operations
  // ---------------------------------------------------------------------------

  /** Run vite build and return the output directory */
  @func()
  viteBuild(
    pkgDir: Directory,
    pkg: string,
    depNames: string[] = [],
    depDirs: Directory[] = [],
    tsconfig: File | null = null,
  ): Directory {
    return viteBuildHelper(pkgDir, pkg, depNames, depDirs, tsconfig);
  }

  // ---------------------------------------------------------------------------
  // OCI image operations
  // ---------------------------------------------------------------------------

  /**
   * Build a Bun service OCI image. Constructs a minimal workspace with
   * only the target package and its workspace deps — no file modification.
   */
  @func()
  buildImage(
    pkgDir: Directory,
    pkg: string,
    depNames: string[] = [],
    depDirs: Directory[] = [],
    version: string = "dev",
    gitSha: string = "unknown",
  ): Container {
    return buildImageHelper(pkgDir, pkg, depNames, depDirs, version, gitSha);
  }

  /** Push a built image to a registry under one or more tags. Returns digest of the first tag. */
  @func({ cache: "never" })
  async pushImage(
    pkgDir: Directory,
    pkg: string,
    tags: string[],
    registryUsername: string,
    registryPassword: Secret,
    depNames: string[] = [],
    depDirs: Directory[] = [],
    version: string = "dev",
    gitSha: string = "unknown",
  ): Promise<string> {
    return pushImageHelper(
      pkgDir,
      pkg,
      tags,
      registryUsername,
      registryPassword,
      depNames,
      depDirs,
      version,
      gitSha,
    );
  }

  // ---------------------------------------------------------------------------
  // Homelab sub-package image operations
  // ---------------------------------------------------------------------------

  /** Build the homelab HA automation image (Bun + native deps) */
  @func()
  buildHomelabImage(
    pkgDir: Directory,
    depNames: string[] = [],
    depDirs: Directory[] = [],
    version: string = "dev",
    gitSha: string = "unknown",
  ): Container {
    return buildHomelabImageHelper(pkgDir, depNames, depDirs, version, gitSha);
  }

  /** Build the dependency-summary image (Bun + helm binary) */
  @func()
  buildDepsSummaryImage(
    pkgDir: Directory,
    depNames: string[] = [],
    depDirs: Directory[] = [],
    version: string = "dev",
    gitSha: string = "unknown",
  ): Container {
    return buildDepsSummaryImageHelper(pkgDir, depNames, depDirs, version, gitSha);
  }

  /** Build the dns-audit image (Python + checkdmarc) */
  @func()
  buildDnsAuditImage(
    version: string = "dev",
    gitSha: string = "unknown",
  ): Container {
    return buildDnsAuditImageHelper(version, gitSha);
  }

  /** Build the caddy-s3proxy image (custom Caddy build with S3 proxy plugin) */
  @func()
  buildCaddyS3ProxyImage(
    version: string = "dev",
    gitSha: string = "unknown",
  ): Container {
    return buildCaddyS3ProxyImageHelper(version, gitSha);
  }

  /** Push a homelab HA image to a registry. Returns digest. */
  @func({ cache: "never" })
  async pushHomelabImage(
    pkgDir: Directory,
    tags: string[],
    registryUsername: string,
    registryPassword: Secret,
    depNames: string[] = [],
    depDirs: Directory[] = [],
    version: string = "dev",
    gitSha: string = "unknown",
  ): Promise<string> {
    return pushHomelabImageHelper(
      pkgDir,
      tags,
      registryUsername,
      registryPassword,
      depNames,
      depDirs,
      version,
      gitSha,
    );
  }

  /** Push a dependency-summary image to a registry. Returns digest. */
  @func({ cache: "never" })
  async pushDepsSummaryImage(
    pkgDir: Directory,
    tags: string[],
    registryUsername: string,
    registryPassword: Secret,
    depNames: string[] = [],
    depDirs: Directory[] = [],
    version: string = "dev",
    gitSha: string = "unknown",
  ): Promise<string> {
    return pushDepsSummaryImageHelper(
      pkgDir,
      tags,
      registryUsername,
      registryPassword,
      depNames,
      depDirs,
      version,
      gitSha,
    );
  }

  /** Push a dns-audit image to a registry. Returns digest. */
  @func({ cache: "never" })
  async pushDnsAuditImage(
    tags: string[],
    registryUsername: string,
    registryPassword: Secret,
    version: string = "dev",
    gitSha: string = "unknown",
  ): Promise<string> {
    return pushDnsAuditImageHelper(
      tags,
      registryUsername,
      registryPassword,
      version,
      gitSha,
    );
  }

  /** Push a caddy-s3proxy image to a registry. Returns digest. */
  @func({ cache: "never" })
  async pushCaddyS3ProxyImage(
    tags: string[],
    registryUsername: string,
    registryPassword: Secret,
    version: string = "dev",
    gitSha: string = "unknown",
  ): Promise<string> {
    return pushCaddyS3ProxyImageHelper(
      tags,
      registryUsername,
      registryPassword,
      version,
      gitSha,
    );
  }

  // ---------------------------------------------------------------------------
  // Rust operations (clauderon)
  // ---------------------------------------------------------------------------

  /** Run cargo fmt --check */
  @func()
  async rustFmt(pkgDir: Directory): Promise<string> {
    return rustFmtHelper(pkgDir).stdout();
  }

  /** Run cargo clippy */
  @func()
  async rustClippy(pkgDir: Directory): Promise<string> {
    return rustClippyHelper(pkgDir).stdout();
  }

  /** Run cargo test */
  @func()
  async rustTest(pkgDir: Directory): Promise<string> {
    return rustTestHelper(pkgDir).stdout();
  }

  /** Build the Rust project */
  @func()
  rustBuild(
    pkgDir: Directory,
    target: string = "x86_64-unknown-linux-gnu",
  ): Container {
    return rustBuildHelper(pkgDir, target);
  }

  // ---------------------------------------------------------------------------
  // Go operations (terraform-provider-asuswrt)
  // ---------------------------------------------------------------------------

  /** Run go build */
  @func()
  async goBuild(pkgDir: Directory): Promise<string> {
    return goBuildHelper(pkgDir).stdout();
  }

  /** Run go test */
  @func()
  async goTest(pkgDir: Directory): Promise<string> {
    return goTestHelper(pkgDir).stdout();
  }

  /** Run golangci-lint (v2) */
  @func()
  async goLint(pkgDir: Directory): Promise<string> {
    return goLintHelper(pkgDir).stdout();
  }

  // ---------------------------------------------------------------------------
  // Homelab operations
  // ---------------------------------------------------------------------------

  /** Run cdk8s synth (bun run build) and return the output directory */
  @func()
  homelabSynth(
    pkgDir: Directory,
    depNames: string[] = [],
    depDirs: Directory[] = [],
    tsconfig: File | null = null,
  ): Directory {
    return homelabSynthHelper(pkgDir, depNames, depDirs, tsconfig);
  }

  // ---------------------------------------------------------------------------
  // Swift operations (lint only — build/test require macOS)
  // ---------------------------------------------------------------------------

  /** Run swiftlint on a Swift package */
  @func()
  async swiftLint(source: Directory, pkg: string): Promise<string> {
    return swiftLintHelper(source, pkg).stdout();
  }

  // ---------------------------------------------------------------------------
  // Playwright tests
  // ---------------------------------------------------------------------------

  /** Run Playwright tests headless in a container */
  @func()
  async playwrightTest(
    pkgDir: Directory,
    pkg: string,
    depNames: string[] = [],
    depDirs: Directory[] = [],
    tsconfig: File | null = null,
  ): Promise<string> {
    return playwrightTestHelper(
      pkgDir,
      pkg,
      depNames,
      depDirs,
      tsconfig,
    ).stdout();
  }

  /** Generate/update Playwright snapshot baselines. Returns the snapshots directory. */
  @func()
  playwrightUpdate(
    pkgDir: Directory,
    pkg: string,
    depNames: string[] = [],
    depDirs: Directory[] = [],
    tsconfig: File | null = null,
  ): Directory {
    return playwrightUpdateHelper(pkgDir, pkg, depNames, depDirs, tsconfig);
  }

  // ---------------------------------------------------------------------------
  // Full CI validation
  // ---------------------------------------------------------------------------

  /** Run lint/typecheck/test for all TS packages in parallel. Returns results summary. */
  @func({ cache: "session" })
  async ciAll(
    source: Directory,
    hassToken: Secret | null = null,
  ): Promise<string> {
    return ciAllHelper(source, hassToken);
  }

  // ---------------------------------------------------------------------------
  // Java/Maven operations
  // ---------------------------------------------------------------------------

  /** Build the Maven project (castle-casters) with `mvn package -DskipTests` */
  @func()
  async mavenBuild(pkgDir: Directory): Promise<string> {
    return mavenBuildHelper(pkgDir).stdout();
  }

  /** Test the Maven project (castle-casters) with `mvn test` */
  @func()
  async mavenTest(pkgDir: Directory): Promise<string> {
    return mavenTestHelper(pkgDir).stdout();
  }

  /** Run `mvn verify` to generate JaCoCo coverage reports */
  @func()
  async mavenCoverage(pkgDir: Directory): Promise<string> {
    return mavenCoverageHelper(pkgDir).stdout();
  }

  // ---------------------------------------------------------------------------
  // LaTeX operations
  // ---------------------------------------------------------------------------

  /** Build the LaTeX resume with xelatex */
  @func()
  async latexBuild(pkgDir: Directory): Promise<string> {
    return latexBuildHelper(pkgDir).stdout();
  }

  // ---------------------------------------------------------------------------
  // MkDocs operations
  // ---------------------------------------------------------------------------

  /** Build MkDocs documentation site and return the built site/ directory */
  @func()
  mkdocsBuild(source: Directory): Directory {
    return mkdocsBuildHelper(source);
  }

  // ---------------------------------------------------------------------------
  // Release/deploy operations (all cache: "never")
  // ---------------------------------------------------------------------------

  /** Package and push a single Helm chart to ChartMuseum */
  @func({ cache: "never" })
  async helmPackage(
    source: Directory,
    cdk8sDist: Directory,
    chartName: string,
    version: string,
    chartMuseumUsername: string,
    chartMuseumPassword: Secret,
    dryrun = false,
  ): Promise<string> {
    return helmPackageHelper(
      source,
      cdk8sDist,
      chartName,
      version,
      chartMuseumUsername,
      chartMuseumPassword,
      dryrun,
    ).stdout();
  }

  /**
   * Synth cdk8s manifests and package a Helm chart in one call.
   * Eliminates Buildkite artifact transfer — Dagger caches the synth output.
   */
  @func({ cache: "never" })
  async helmSynthAndPackage(
    source: Directory,
    synthPkgDir: Directory,
    synthDepNames: string[] = [],
    synthDepDirs: Directory[] = [],
    tsconfig: File | null = null,
    chartName: string,
    version: string,
    chartMuseumUsername: string,
    chartMuseumPassword: Secret,
    dryrun = false,
  ): Promise<string> {
    const cdk8sDist = homelabSynthHelper(
      synthPkgDir,
      synthDepNames,
      synthDepDirs,
      tsconfig,
    );
    return helmPackageHelper(
      source,
      cdk8sDist,
      chartName,
      version,
      chartMuseumUsername,
      chartMuseumPassword,
      dryrun,
    ).stdout();
  }

  /** Run tofu init + apply on an infrastructure stack */
  @func({ cache: "never" })
  async tofuApply(
    source: Directory,
    stack: string,
    awsAccessKeyId: Secret,
    awsSecretAccessKey: Secret,
    ghToken: Secret,
    cloudflareAccountId: Secret | null = null,
    cloudflareApiToken: Secret | null = null,
    dryrun = false,
  ): Promise<string> {
    return tofuApplyHelper(
      source,
      stack,
      awsAccessKeyId,
      awsSecretAccessKey,
      ghToken,
      cloudflareAccountId,
      cloudflareApiToken,
      dryrun,
    ).stdout();
  }

  /** Run tofu init + plan on an infrastructure stack (read-only) */
  @func()
  async tofuPlan(
    source: Directory,
    stack: string,
    awsAccessKeyId: Secret,
    awsSecretAccessKey: Secret,
    ghToken: Secret,
    cloudflareAccountId: Secret | null = null,
    cloudflareApiToken: Secret | null = null,
    dryrun = false,
  ): Promise<string> {
    return tofuPlanHelper(
      source,
      stack,
      awsAccessKeyId,
      awsSecretAccessKey,
      ghToken,
      cloudflareAccountId,
      cloudflareApiToken,
      dryrun,
    ).stdout();
  }

  /** Publish an npm package. Set devVersion for dev releases (--tag dev), leave empty for prod (--tag latest). */
  @func({ cache: "never" })
  async publishNpm(
    pkgDir: Directory,
    pkg: string,
    npmToken: Secret,
    depNames: string[] = [],
    depDirs: Directory[] = [],
    dryrun = false,
    tsconfig: File | null = null,
    devVersion: string = "",
  ): Promise<string> {
    return publishNpmHelper(
      pkgDir,
      pkg,
      npmToken,
      depNames,
      depDirs,
      dryrun,
      tsconfig,
      devVersion,
    ).stdout();
  }

  /** Build and deploy a static site to S3 or R2 */
  @func({ cache: "never" })
  async deploySite(
    pkgDir: Directory,
    pkg: string,
    bucket: string,
    buildCmd: string,
    distSubdir: string,
    target: string,
    awsAccessKeyId: Secret,
    awsSecretAccessKey: Secret,
    cloudflareAccountId: string = "",
    depNames: string[] = [],
    depDirs: Directory[] = [],
    dryrun = false,
    tsconfig: File | null = null,
    needsPlaywright = false,
  ): Promise<string> {
    return deploySiteHelper(
      pkgDir,
      pkg,
      bucket,
      buildCmd,
      distSubdir,
      target,
      awsAccessKeyId,
      awsSecretAccessKey,
      cloudflareAccountId,
      depNames,
      depDirs,
      dryrun,
      tsconfig,
      needsPlaywright,
    ).stdout();
  }

  /** Deploy a pre-built static site directory to S3 (no bun install or build) */
  @func({ cache: "never" })
  async deployStaticSite(
    siteDir: Directory,
    bucket: string,
    target: string,
    awsAccessKeyId: Secret,
    awsSecretAccessKey: Secret,
    dryrun = false,
  ): Promise<string> {
    return deployStaticSiteHelper(
      siteDir,
      bucket,
      target,
      awsAccessKeyId,
      awsSecretAccessKey,
      dryrun,
    ).stdout();
  }

  /** Trigger an ArgoCD sync for an application */
  @func({ cache: "never" })
  async argoCdSync(
    appName: string,
    argoCdToken: Secret,
    serverUrl: string = "https://argocd.sjer.red",
    dryrun = false,
  ): Promise<string> {
    return argoCdSyncHelper(appName, argoCdToken, serverUrl, dryrun).stdout();
  }

  /** Wait for an ArgoCD application to become healthy */
  @func({ cache: "never" })
  async argoCdHealthWait(
    appName: string,
    argoCdToken: Secret,
    timeoutSeconds: number = 300,
    serverUrl: string = "https://argocd.sjer.red",
    dryrun = false,
  ): Promise<string> {
    return argoCdHealthWaitHelper(
      appName,
      argoCdToken,
      timeoutSeconds,
      serverUrl,
      dryrun,
    ).stdout();
  }

  /** Build cooklang-for-obsidian plugin and return artifacts (main.js, manifest.json, styles.css) */
  @func()
  cooklangBuild(
    pkgDir: Directory,
    depNames: string[] = [],
    depDirs: Directory[] = [],
    tsconfig: File | null = null,
  ): Directory {
    return cooklangBuildHelper(pkgDir, depNames, depDirs, tsconfig)
      .directory("/workspace/packages/cooklang-for-obsidian")
      .withoutDirectory("node_modules");
  }

  /** Push cooklang artifacts to GitHub repository */
  @func({ cache: "never" })
  async cooklangPush(
    source: Directory,
    version: string,
    ghToken: Secret,
    dryrun = false,
  ): Promise<string> {
    return cooklangPushHelper(source, version, ghToken, dryrun).stdout();
  }

  /** Build and push cooklang artifacts in a single pipeline */
  @func({ cache: "never" })
  async cooklangBuildAndPush(
    pkgDir: Directory,
    version: string,
    ghToken: Secret,
    depNames: string[] = [],
    depDirs: Directory[] = [],
    tsconfig: File | null = null,
    dryrun = false,
  ): Promise<string> {
    const dist = this.cooklangBuild(pkgDir, depNames, depDirs, tsconfig);
    return cooklangPushHelper(dist, version, ghToken, dryrun).stdout();
  }

  /** Build cooklang and create a GitHub release in a single pipeline */
  @func({ cache: "never" })
  async cooklangBuildAndRelease(
    pkgDir: Directory,
    version: string,
    ghToken: Secret,
    depNames: string[] = [],
    depDirs: Directory[] = [],
    tsconfig: File | null = null,
    dryrun = false,
  ): Promise<string> {
    const dist = this.cooklangBuild(pkgDir, depNames, depDirs, tsconfig);
    return cooklangCreateReleaseHelper(dist, version, ghToken, dryrun).stdout();
  }

  /** Build clauderon for multiple targets and collect binaries into one Directory */
  @func()
  clauderonCollectBinaries(pkgDir: Directory): Directory {
    return clauderonCollectBinariesHelper(pkgDir, [
      {
        target: "x86_64-unknown-linux-gnu",
        filename: "clauderon-linux-x86_64",
      },
      {
        target: "aarch64-unknown-linux-gnu",
        filename: "clauderon-linux-arm64",
      },
    ]);
  }

  /** Upload clauderon binaries to a GitHub release */
  @func({ cache: "never" })
  async clauderonUpload(
    binaries: Directory,
    version: string,
    ghToken: Secret,
    dryrun = false,
  ): Promise<string> {
    return clauderonUploadHelper(binaries, version, ghToken, dryrun).stdout();
  }

  /** Build clauderon for all targets and upload to GitHub release */
  @func({ cache: "never" })
  async clauderonBuildAndUpload(
    pkgDir: Directory,
    version: string,
    ghToken: Secret,
    dryrun = false,
  ): Promise<string> {
    const binaries = this.clauderonCollectBinaries(pkgDir);
    return clauderonUploadHelper(binaries, version, ghToken, dryrun).stdout();
  }

  /** Update versions.ts with new image digests and create auto-merge PR */
  @func({ cache: "never" })
  async versionCommitBack(
    digests: string,
    version: string,
    ghToken: Secret,
    dryrun = false,
  ): Promise<string> {
    return versionCommitBackHelper(digests, version, ghToken, dryrun).stdout();
  }

  /** Run release-please to create release PRs and GitHub releases */
  @func({ cache: "never" })
  async releasePlease(
    source: Directory,
    ghToken: Secret,
    dryrun = false,
  ): Promise<string> {
    return releasePleaseHelper(source, ghToken, dryrun).stdout();
  }

  /** Create a GitHub release for cooklang-rich-preview */
  @func({ cache: "never" })
  async cooklangCreateRelease(
    artifacts: Directory,
    version: string,
    ghToken: Secret,
    dryrun = false,
  ): Promise<string> {
    return cooklangCreateReleaseHelper(
      artifacts,
      version,
      ghToken,
      dryrun,
    ).stdout();
  }

  /** Run AI code review on a PR */
  @func({ cache: "never" })
  async codeReview(
    source: Directory,
    prNumber: string,
    baseBranch: string,
    commitSha: string,
    ghToken: Secret,
    claudeToken: Secret,
  ): Promise<string> {
    return codeReviewHelper(
      source,
      prNumber,
      baseBranch,
      commitSha,
      ghToken,
      claudeToken,
    ).stdout();
  }

  /** Run cargo deny check on the Rust project */
  @func()
  async cargoDeny(pkgDir: Directory): Promise<string> {
    return cargoDenyHelper(pkgDir).stdout();
  }

  // ---------------------------------------------------------------------------
  // Caddyfile validation
  // ---------------------------------------------------------------------------

  /** Generate and validate the Caddyfile for S3 static sites */
  @func()
  async caddyfileValidate(source: Directory): Promise<string> {
    return caddyfileValidateHelper(source).stdout();
  }

  // ---------------------------------------------------------------------------
  // Smoke test
  // ---------------------------------------------------------------------------

  /** Start a container and verify its health endpoint responds */
  @func()
  async smokeTest(
    image: Container,
    port: number = 3000,
    healthPath: string = "/",
    timeoutSeconds: number = 30,
  ): Promise<string> {
    return smokeTestHelper(image, port, healthPath, timeoutSeconds).stdout();
  }

  // ---------------------------------------------------------------------------
  // Per-package smoke tests
  // ---------------------------------------------------------------------------

  /** Smoke test scout-for-lol: install deps, verify config, HTTP server, expected Discord auth failure */
  @func()
  async smokeTestScoutForLol(
    pkgDir: Directory,
    pkg: string,
    depNames: string[] = [],
    depDirs: Directory[] = [],
    tsconfig: File | null = null,
  ): Promise<string> {
    return smokeTestScoutForLolHelper(pkgDir, pkg, depNames, depDirs, tsconfig);
  }

  /** Smoke test birmel: install deps, verify config, Discord login attempt, expected auth failure */
  @func()
  async smokeTestBirmel(
    pkgDir: Directory,
    pkg: string,
    depNames: string[] = [],
    depDirs: Directory[] = [],
    tsconfig: File | null = null,
  ): Promise<string> {
    return smokeTestBirmelHelper(pkgDir, pkg, depNames, depDirs, tsconfig);
  }

  /** Smoke test starlight-karma-bot: install deps, verify config, server start, expected auth failure */
  @func()
  async smokeTestStarlightKarmaBot(
    pkgDir: Directory,
    pkg: string,
    depNames: string[] = [],
    depDirs: Directory[] = [],
    tsconfig: File | null = null,
  ): Promise<string> {
    return smokeTestStarlightKarmaBotHelper(
      pkgDir,
      pkg,
      depNames,
      depDirs,
      tsconfig,
    );
  }

  /** Smoke test tasknotes-server: install deps, verify server starts and listens */
  @func()
  async smokeTestTasknotesServer(
    pkgDir: Directory,
    pkg: string,
    depNames: string[] = [],
    depDirs: Directory[] = [],
    tsconfig: File | null = null,
  ): Promise<string> {
    return smokeTestTasknotesServerHelper(
      pkgDir,
      pkg,
      depNames,
      depDirs,
      tsconfig,
    );
  }

  /** Smoke test homelab HA: boots app, expects ECONNREFUSED to HA */
  @func()
  async smokeTestHomelab(
    pkgDir: Directory,
    depNames: string[] = [],
    depDirs: Directory[] = [],
  ): Promise<string> {
    return smokeTestHomelabHelper(pkgDir, depNames, depDirs);
  }

  /** Smoke test dependency-summary: boots app, expects clone/API failure */
  @func()
  async smokeTestDepsSummary(
    pkgDir: Directory,
    depNames: string[] = [],
    depDirs: Directory[] = [],
  ): Promise<string> {
    return smokeTestDepsSummaryHelper(pkgDir, depNames, depDirs);
  }

  /** Smoke test dns-audit: verifies Python + checkdmarc installed */
  @func()
  async smokeTestDnsAudit(): Promise<string> {
    return smokeTestDnsAuditHelper();
  }

  /** Smoke test caddy-s3proxy: verifies custom Caddy binary works */
  @func()
  async smokeTestCaddyS3Proxy(): Promise<string> {
    return smokeTestCaddyS3ProxyHelper();
  }

  /** Smoke test discord-plays-pokemon: boots app, expects Discord auth failure */
  @func()
  async smokeTestDiscordPlaysPokemon(
    pkgDir: Directory,
    pkg: string,
    depNames: string[] = [],
    depDirs: Directory[] = [],
    tsconfig: File | null = null,
  ): Promise<string> {
    return smokeTestDiscordPlaysPokemonHelper(
      pkgDir,
      pkg,
      depNames,
      depDirs,
      tsconfig,
    );
  }

  /** Smoke test better-skill-capped-fetcher: boots app, expects Firebase auth failure */
  @func()
  async smokeTestBetterSkillCappedFetcher(
    pkgDir: Directory,
    pkg: string,
    depNames: string[] = [],
    depDirs: Directory[] = [],
    tsconfig: File | null = null,
  ): Promise<string> {
    return smokeTestBetterSkillCappedFetcherHelper(
      pkgDir,
      pkg,
      depNames,
      depDirs,
      tsconfig,
    );
  }
}
