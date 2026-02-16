import { func, argument, Directory, object, Secret, dag, File } from "@dagger.io/dagger";
import { formatDaggerError, execOrThrow } from "./errors";
import {
  buildHa,
  typeCheckHa,
  lintHa,
  buildAndExportHaImage,
  prepareHaContainer,
  typeCheckHaWithContainer,
  lintHaWithContainer,
  buildHaWithContainer,
} from "./ha";
import { getMiseRuntimeContainer } from "./base";
import {
  typeCheckCdk8s,
  buildK8sManifests,
  testCdk8s,
  lintCdk8s,
  prepareCdk8sContainer,
  typeCheckCdk8sWithContainer,
  lintCdk8sWithContainer,
  buildK8sManifestsWithContainer,
  testCdk8sWithContainer,
  validateCaddyfileWithContainer,
} from "./cdk8s";
import { sync as argocdSync } from "./argocd";
import { applyK8sConfig, buildAndApplyCdk8s } from "./k8s";
import { buildAndPushHaImage } from "./ha";
import { buildAndPushDependencySummaryImage } from "./dependency-summary";
import { buildAndPushDnsAuditImage } from "./dns-audit";
import { buildAndPushCaddyS3ProxyImage } from "./caddy-s3proxy";
import { buildAndPushOpenclawImage } from "./openclaw";
import { buildAllCharts, HELM_CHARTS, publishAllCharts } from "./helm";
import { Stage } from "./stage";
import versions from "./versions";
import { runReleasePleaseWorkflow } from "./release-please.ts";
import { planAll } from "./tofu";

export type StepStatus = "passed" | "failed" | "skipped";
// note: this must be an interface for Dagger
// eslint-disable-next-line @typescript-eslint/consistent-type-definitions
export interface StepResult {
  status: StepStatus;
  message: string;
}

export type HelmBuildResult = StepResult & {
  dist?: Directory;
};

@object()
export class Homelab {
  /**
   * Runs type check, test, and lint for HA, and type check for CDK8s in parallel.
   * @param source The source directory to use for all checks.
   * @param hassBaseUrl The Home Assistant base URL (as a Dagger Secret). Optional if src/ha/src/hass/ exists.
   * @param hassToken The Home Assistant long-lived access token (as a Dagger Secret). Optional if src/ha/src/hass/ exists.
   * @returns A summary string of the results for each check.
   */
  @func()
  async checkAll(
    @argument({
      ignore: ["node_modules", "dist", "build", ".cache", "*.log", ".env*", "!.env.example", ".dagger"],
      defaultPath: ".",
    })
    source: Directory,
    hassBaseUrl?: Secret,
    hassToken?: Secret,
  ): Promise<string> {
    const haTypeCheck = typeCheckHa(source, hassBaseUrl, hassToken);
    const haLint = lintHa(source, hassBaseUrl, hassToken);
    const cdk8sTypeCheck = typeCheckCdk8s(source);
    const cdk8sLint = lintCdk8s(source);
    const cdk8sTest = testCdk8s(source);
    const results = await Promise.allSettled([haTypeCheck, haLint, cdk8sTypeCheck, cdk8sLint, cdk8sTest]);
    const names = ["HA TypeCheck", "HA Lint", "CDK8s TypeCheck", "CDK8s Lint", "CDK8s Test"];
    const summary = results
      .map((result, index) => {
        const name = names[index] ?? "Unknown";
        if (result.status === "fulfilled") {
          return `${name}: PASSED`;
        }
        const errorDetails = formatDaggerError(result.reason);
        return `${name}: FAILED\n${errorDetails}`;
      })
      .join("\n\n");
    return `Pipeline Results:\n${summary}`;
  }

  /**
   * Update the versions.ts file with the HA image version for production builds
   * @param source The source directory
   * @param version The version to set for the HA image
   * @returns The updated source directory
   */
  @func()
  updateHaVersion(
    @argument({
      ignore: ["node_modules", "dist", "build", ".cache", "*.log", ".env*", "!.env.example", ".dagger"],
      defaultPath: ".",
    })
    source: Directory,
    @argument() version: string,
  ): Directory {
    return dag
      .container()
      .from(`alpine:${versions.alpine}`)
      .withMountedDirectory("/workspace", source)
      .withWorkdir("/workspace")
      .withExec([
        "sed",
        "-i",
        `s/"shepherdjerred\\/homelab": "[^"]*"/"shepherdjerred\\/homelab": "${version}"/`,
        "src/cdk8s/src/versions.ts",
      ])
      .directory("/workspace");
  }

  /**
   * Update the versions.ts file with the dependency-summary image version for production builds
   * @param source The source directory
   * @param version The version to set for the dependency-summary image
   * @returns The updated source directory
   */
  @func()
  updateDependencySummaryVersion(
    @argument({
      ignore: ["node_modules", "dist", "build", ".cache", "*.log", ".env*", "!.env.example", ".dagger"],
      defaultPath: ".",
    })
    source: Directory,
    @argument() version: string,
  ): Directory {
    return dag
      .container()
      .from(`alpine:${versions.alpine}`)
      .withMountedDirectory("/workspace", source)
      .withWorkdir("/workspace")
      .withExec([
        "sed",
        "-i",
        `s/"shepherdjerred\\/dependency-summary": "[^"]*"/"shepherdjerred\\/dependency-summary": "${version}"/`,
        "src/cdk8s/src/versions.ts",
      ])
      .directory("/workspace");
  }

  /** Update the versions.ts file with the dns-audit image version for production builds */
  @func()
  updateDnsAuditVersion(
    @argument({
      ignore: ["node_modules", "dist", "build", ".cache", "*.log", ".env*", "!.env.example", ".dagger"],
      defaultPath: ".",
    })
    source: Directory,
    @argument() version: string,
  ): Directory {
    return dag
      .container()
      .from(`alpine:${versions.alpine}`)
      .withMountedDirectory("/workspace", source)
      .withWorkdir("/workspace")
      .withExec([
        "sed",
        "-i",
        `s/"shepherdjerred\\/dns-audit": "[^"]*"/"shepherdjerred\\/dns-audit": "${version}"/`,
        "src/cdk8s/src/versions.ts",
      ])
      .directory("/workspace");
  }

  /**
   * Runs kube-linter, ArgoCD sync, builds for CDK8s and HA, publishes the HA image (if prod), publishes the Helm chart (if prod), and runs release-please for npm publishing as part of the CI pipeline.
   * @param source The source directory for kube-linter, and builds.
   * @param argocdToken The ArgoCD API token for authentication (as a Dagger Secret).
   * @param ghcrUsername The GHCR username (required for prod).
   * @param ghcrPassword The GHCR password (as a Dagger Secret, required for prod).
   * @param chartVersion The Helm chart version to publish (required for prod).
   * @param chartRepo The ChartMuseum repo URL (required for prod).
   * @param chartMuseumUsername The ChartMuseum username (required for prod).
   * @param chartMuseumPassword The ChartMuseum password (as a Dagger Secret, required for prod).
   * @param hassBaseUrl The Home Assistant base URL (as a Dagger Secret). Optional if src/ha/src/hass/ exists.
   * @param hassToken The Home Assistant long-lived access token (as a Dagger Secret). Optional if src/ha/src/hass/ exists.
   * @param env The environment (e.g., 'prod' or 'dev').
   * @param versionOnly If true, skip HA checks and CDK8s lint/test (for version-only PRs).
   * @param githubToken GitHub token with write access for release-please (as a Dagger Secret, optional).
   * @param npmToken NPM token for publishing @shepherdjerred/helm-types (as a Dagger Secret, optional).
   * @returns A summary string of the results for each CI step.
   */
  @func()
  async ci(
    @argument({
      // Note: .dagger is NOT ignored here because testRenovateRegex() needs access to
      // .dagger/src/versions.ts and .dagger/test/test-renovate-regex.ts files.
      // This may have a slight performance/cache impact as .dagger directory changes
      // will invalidate the CI cache, but it's necessary for the Renovate regex test.
      ignore: ["node_modules", "dist", "build", ".cache", "*.log", ".env*", "!.env.example"],
      defaultPath: ".",
    })
    source: Directory,
    argocdToken: Secret,
    @argument() ghcrUsername: string,
    ghcrPassword: Secret,
    @argument() chartVersion: string,
    chartRepo = "https://chartmuseum.tailnet-1a49.ts.net",
    @argument() chartMuseumUsername: string,
    chartMuseumPassword: Secret,
    cloudflareApiToken: Secret,
    cloudflareAccountId: Secret,
    awsAccessKeyId: Secret,
    awsSecretAccessKey: Secret,
    hassBaseUrl?: Secret,
    hassToken?: Secret,
    @argument() env: Stage = Stage.Dev,
    @argument() versionOnly = false,
    githubToken?: Secret,
    npmToken?: Secret,
    tofuGithubToken?: Secret,
  ): Promise<string> {
    // Update image versions in versions.ts if prod
    let updatedSource = source;
    if (env === Stage.Prod) {
      updatedSource = this.updateHaVersion(source, chartVersion);
      updatedSource = this.updateDependencySummaryVersion(updatedSource, chartVersion);
      updatedSource = this.updateDnsAuditVersion(updatedSource, chartVersion);
    }

    // Prepare shared containers once - this is a major optimization
    // All HA operations (lint, typecheck, build) share the same prepared container
    // All CDK8s operations share the same prepared container
    // Skip HA container preparation for version-only PRs (saves time)
    const haContainerPromise = versionOnly ? undefined : prepareHaContainer(updatedSource, hassBaseUrl, hassToken);
    const cdk8sContainer = prepareCdk8sContainer(updatedSource);
    const versionOnlySkip = (name: string): Promise<{ status: "skipped"; message: string }> =>
      Promise.resolve({ status: "skipped" as const, message: `${name}: SKIPPED (version-only)` });

    // Renovate regex test (run async)
    const renovateTestPromise = this.testRenovateRegex(updatedSource)
      .then((msg) => ({
        status: "passed" as const,
        message: `Renovate Test: PASSED\n${msg}`,
      }))
      .catch((e: unknown) => ({
        status: "failed" as const,
        message: `Renovate Test: FAILED\n${formatDaggerError(e)}`,
      }));

    // Helm test (run async) - skip for version-only PRs
    const helmTestPromise = versionOnly
      ? versionOnlySkip("Helm Test")
      : this.testHelm(updatedSource)
          .then((msg) => ({ status: "passed" as const, message: `Helm Test: PASSED\n${msg}` }))
          .catch((e: unknown) => ({
            status: "failed" as const,
            message: `Helm Test: FAILED\n${formatDaggerError(e)}`,
          }));

    // CDK8s test - uses shared container - skip for version-only PRs
    const cdk8sTestPromise = versionOnly
      ? versionOnlySkip("CDK8s Test")
      : testCdk8sWithContainer(cdk8sContainer)
          .then((msg) => ({ status: "passed" as const, message: `CDK8s Test: PASSED\n${msg}` }))
          .catch((e: unknown) => ({
            status: "failed" as const,
            message: `CDK8s Test: FAILED\n${formatDaggerError(e)}`,
          }));

    // Caddyfile validation - uses shared container - skip for version-only PRs
    const caddyfileValidatePromise = versionOnly
      ? versionOnlySkip("Caddyfile Validate")
      : validateCaddyfileWithContainer(cdk8sContainer)
          .then((msg) => ({ status: "passed" as const, message: `Caddyfile Validate: PASSED\n${msg}` }))
          .catch((e: unknown) => ({
            status: "failed" as const,
            message: `Caddyfile Validate: FAILED\n${formatDaggerError(e)}`,
          }));

    // CDK8s linting - uses shared container - skip for version-only PRs
    const cdk8sLintPromise = versionOnly
      ? versionOnlySkip("CDK8s Lint")
      : lintCdk8sWithContainer(cdk8sContainer)
          .then((msg) => ({ status: "passed" as const, message: `CDK8s Lint: PASSED\n${msg}` }))
          .catch((e: unknown) => ({
            status: "failed" as const,
            message: `CDK8s Lint: FAILED\n${formatDaggerError(e)}`,
          }));

    // HA linting - uses shared container - skip for version-only PRs
    const haLintPromise =
      versionOnly || !haContainerPromise
        ? versionOnlySkip("HA Lint")
        : haContainerPromise
            .then((container) => lintHaWithContainer(container))
            .then((msg) => ({ status: "passed" as const, message: `HA Lint: PASSED\n${msg}` }))
            .catch((e: unknown) => ({
              status: "failed" as const,
              message: `HA Lint: FAILED\n${formatDaggerError(e)}`,
            }));

    // CDK8s type checking - uses shared container
    const cdk8sTypeCheckPromise = typeCheckCdk8sWithContainer(cdk8sContainer)
      .then((msg) => ({
        status: "passed" as const,
        message: `CDK8s TypeCheck: PASSED\n${msg}`,
      }))
      .catch((e: unknown) => ({
        status: "failed" as const,
        message: `CDK8s TypeCheck: FAILED\n${formatDaggerError(e)}`,
      }));

    // HA type checking - uses shared container - skip for version-only PRs
    const haTypeCheckPromise =
      versionOnly || !haContainerPromise
        ? versionOnlySkip("HA TypeCheck")
        : haContainerPromise
            .then((container) => typeCheckHaWithContainer(container))
            .then((msg) => ({ status: "passed" as const, message: `HA TypeCheck: PASSED\n${msg}` }))
            .catch((e: unknown) => ({
              status: "failed" as const,
              message: `HA TypeCheck: FAILED\n${formatDaggerError(e)}`,
            }));

    // OpenTofu plan - drift detection
    const tofuPlanPromise = planAll(
      updatedSource,
      cloudflareApiToken,
      cloudflareAccountId,
      awsAccessKeyId,
      awsSecretAccessKey,
      tofuGithubToken,
    )
      .then((msg) => ({ status: "passed" as const, message: `Tofu Plan: PASSED\n${msg}` }))
      .catch((e: unknown) => ({
        status: "failed" as const,
        message: `Tofu Plan: FAILED\n${formatDaggerError(e)}`,
      }));

    // CDK8s build - uses shared container
    const cdk8sBuildPromise = Promise.resolve(buildK8sManifestsWithContainer(cdk8sContainer))
      .then(() => ({
        status: "passed" as const,
        message: "CDK8s Build: PASSED",
      }))
      .catch((e: unknown) => ({
        status: "failed" as const,
        message: `CDK8s Build: FAILED\n${formatDaggerError(e)}`,
      }));

    // HA build - uses shared container to ensure types are generated - skip for version-only PRs
    const haBuildPromise =
      versionOnly || !haContainerPromise
        ? versionOnlySkip("HA Build")
        : haContainerPromise
            .then((container) => buildHaWithContainer(container))
            .then(() => ({ status: "passed" as const, message: "HA Build: PASSED" }))
            .catch((e: unknown) => ({
              status: "failed" as const,
              message: `HA Build: FAILED\n${formatDaggerError(e)}`,
            }));

    // Always build Helm chart (for both dev and prod)
    const helmBuildPromise = Promise.resolve().then(() => {
      try {
        const dist = this.helmBuild(updatedSource, chartVersion || "dev-snapshot");
        return {
          status: "passed" as const,
          message: "Helm Build: PASSED",
          dist,
        };
      } catch (e: unknown) {
        return {
          status: "failed" as const,
          message: `Helm Build: FAILED\n${formatDaggerError(e)}`,
          dist: undefined,
        };
      }
    });

    // Await builds, tests, linting, and type checking
    const [
      cdk8sBuildResult,
      haBuildResult,
      helmBuildResult,
      renovateTestResult,
      helmTestResult,
      cdk8sTestResult,
      caddyfileValidateResult,
      cdk8sLintResult,
      haLintResult,
      cdk8sTypeCheckResult,
      haTypeCheckResult,
      tofuPlanResult,
    ] = await Promise.all([
      cdk8sBuildPromise,
      haBuildPromise,
      helmBuildPromise,
      renovateTestPromise,
      helmTestPromise,
      cdk8sTestPromise,
      caddyfileValidatePromise,
      cdk8sLintPromise,
      haLintPromise,
      cdk8sTypeCheckPromise,
      haTypeCheckPromise,
      tofuPlanPromise,
    ]);

    // Publish all images and Helm chart in parallel for faster CI
    let haPublishResult: StepResult = { status: "skipped", message: "[SKIPPED] Not prod" };
    let depSummaryPublishResult: StepResult = { status: "skipped", message: "[SKIPPED] Not prod" };
    let dnsAuditPublishResult: StepResult = { status: "skipped", message: "[SKIPPED] Not prod" };
    let caddyS3ProxyPublishResult: StepResult = { status: "skipped", message: "[SKIPPED] Not prod" };
    let openclawPublishResult: StepResult = { status: "skipped", message: "[SKIPPED] Not prod" };
    let helmPublishResult: StepResult = { status: "skipped", message: "[SKIPPED] Not prod" };

    if (env === Stage.Prod) {
      // Run all image pushes and helm publish in parallel
      const [haResults, depSummaryResults, dnsAuditResults, caddyS3ProxyResult, openclawResult, helmResult] =
        await Promise.all([
          // HA image: push versioned and latest tags in parallel
          Promise.all([
            buildAndPushHaImage(
              updatedSource,
              `ghcr.io/shepherdjerred/homelab:${chartVersion}`,
              ghcrUsername,
              ghcrPassword,
              false,
            ),
            buildAndPushHaImage(
              updatedSource,
              `ghcr.io/shepherdjerred/homelab:latest`,
              ghcrUsername,
              ghcrPassword,
              false,
            ),
          ]),
          // Dependency-summary image: push versioned and latest tags in parallel
          Promise.all([
            buildAndPushDependencySummaryImage(
              updatedSource,
              `ghcr.io/shepherdjerred/dependency-summary:${chartVersion}`,
              ghcrUsername,
              ghcrPassword,
              false,
            ),
            buildAndPushDependencySummaryImage(
              updatedSource,
              `ghcr.io/shepherdjerred/dependency-summary:latest`,
              ghcrUsername,
              ghcrPassword,
              false,
            ),
          ]),
          // Dns-audit image: push versioned and latest tags in parallel
          Promise.all([
            buildAndPushDnsAuditImage(
              `ghcr.io/shepherdjerred/dns-audit:${chartVersion}`,
              ghcrUsername,
              ghcrPassword,
              false,
            ),
            buildAndPushDnsAuditImage(`ghcr.io/shepherdjerred/dns-audit:latest`, ghcrUsername, ghcrPassword, false),
          ]),
          // Caddy-s3proxy image: push latest tag only (no versioning needed for this utility image)
          buildAndPushCaddyS3ProxyImage(
            `ghcr.io/shepherdjerred/caddy-s3proxy:latest`,
            ghcrUsername,
            ghcrPassword,
            false,
          ),
          // OpenClaw image: push latest tag only
          buildAndPushOpenclawImage(`ghcr.io/shepherdjerred/openclaw:latest`, ghcrUsername, ghcrPassword, false),
          // Helm chart publish
          helmBuildResult.dist
            ? this.helmPublishBuilt(
                helmBuildResult.dist,
                `1.0.0-${chartVersion}`,
                chartRepo,
                chartMuseumUsername,
                chartMuseumPassword,
                env,
              )
            : Promise.resolve({ status: "skipped" as const, message: "[SKIPPED] No dist available" }),
        ]);

      // Combine HA results
      haPublishResult = {
        status: haResults[0].status === "passed" && haResults[1].status === "passed" ? "passed" : "failed",
        message: `Versioned tag: ${haResults[0].message}\nLatest tag: ${haResults[1].message}`,
      };

      // Combine dependency-summary results
      depSummaryPublishResult = {
        status:
          depSummaryResults[0].status === "passed" && depSummaryResults[1].status === "passed" ? "passed" : "failed",
        message: `Versioned tag: ${depSummaryResults[0].message}\nLatest tag: ${depSummaryResults[1].message}`,
      };

      // Combine dns-audit results
      dnsAuditPublishResult = {
        status: dnsAuditResults[0].status === "passed" && dnsAuditResults[1].status === "passed" ? "passed" : "failed",
        message: `Versioned tag: ${dnsAuditResults[0].message}\nLatest tag: ${dnsAuditResults[1].message}`,
      };

      // Caddy-s3proxy result
      caddyS3ProxyPublishResult = caddyS3ProxyResult;

      // OpenClaw result
      openclawPublishResult = openclawResult;

      // Helm result
      helmPublishResult = helmResult;
    }
    // Sync (run only after successful Helm chart publish)
    let syncResult: StepResult = {
      status: "skipped",
      message: "[SKIPPED] Not prod or chart publish failed",
    };
    if (env === Stage.Prod && helmPublishResult.status === "passed") {
      const sync = await argocdSync(argocdToken);
      syncResult = sync;
    }

    // Release-please workflow (only on prod with tokens)
    const releasePleaseResult: StepResult =
      env === Stage.Prod && githubToken && npmToken
        ? await runReleasePleaseWorkflow(githubToken, npmToken, updatedSource)
        : { status: "skipped", message: "[SKIPPED] No github/npm tokens provided" };

    // Build summary
    const summary = [
      renovateTestResult.message,
      helmTestResult.message,
      cdk8sTestResult.message,
      caddyfileValidateResult.message,
      cdk8sLintResult.message,
      haLintResult.message,
      cdk8sTypeCheckResult.message,
      haTypeCheckResult.message,
      `Sync result:\n${syncResult.message}`,
      cdk8sBuildResult.message,
      haBuildResult.message,
      helmBuildResult.message,
      `HA Image Publish result:\n${haPublishResult.message}`,
      `Dependency Summary Image Publish result:\n${depSummaryPublishResult.message}`,
      `Dns Audit Image Publish result:\n${dnsAuditPublishResult.message}`,
      `Caddy S3Proxy Image Publish result:\n${caddyS3ProxyPublishResult.message}`,
      `OpenClaw Image Publish result:\n${openclawPublishResult.message}`,
      `Helm Chart Publish result:\n${helmPublishResult.message}`,
      `Release-please result:\n${releasePleaseResult.message}`,
      tofuPlanResult.message,
    ].join("\n\n");
    // Fail if any critical step failed
    if (
      renovateTestResult.status === "failed" ||
      helmTestResult.status === "failed" ||
      cdk8sTestResult.status === "failed" ||
      caddyfileValidateResult.status === "failed" ||
      cdk8sLintResult.status === "failed" ||
      haLintResult.status === "failed" ||
      cdk8sTypeCheckResult.status === "failed" ||
      haTypeCheckResult.status === "failed" ||
      syncResult.status === "failed" ||
      cdk8sBuildResult.status === "failed" ||
      haBuildResult.status === "failed" ||
      helmBuildResult.status === "failed" ||
      (env === Stage.Prod &&
        (haPublishResult.status === "failed" ||
          depSummaryPublishResult.status === "failed" ||
          dnsAuditPublishResult.status === "failed" ||
          caddyS3ProxyPublishResult.status === "failed" ||
          openclawPublishResult.status === "failed" ||
          helmPublishResult.status === "failed"))
    ) {
      throw new Error(summary);
    }
    return summary;
  }

  /**
   * Builds the Home Assistant (HA) app.
   * @param source The source directory for the HA app.
   * @returns The built HA app directory.
   */
  @func()
  buildHa(
    @argument({
      ignore: ["node_modules", "dist", "build", ".cache", "*.log", ".env*", "!.env.example", ".dagger"],
      defaultPath: ".",
    })
    source: Directory,
  ): Directory {
    return buildHa(source);
  }

  /**
   * Tests Renovate regex patterns in versions.ts files.
   * @param source The source directory containing versions.ts files and renovate.json.
   * @returns The test results output.
   */
  @func()
  async testRenovateRegex(
    @argument({
      ignore: ["node_modules", "dist", "build", ".cache", "*.log", ".env*", "!.env.example"],
      defaultPath: ".",
    })
    source: Directory,
  ): Promise<string> {
    const container = getMiseRuntimeContainer()
      .withWorkdir("/workspace")
      // Copy package.json and bun.lock for dependency installation
      .withFile("package.json", source.file("package.json"))
      .withFile("bun.lock", source.file("bun.lock"))
      // Copy patches directory for bun patch support
      .withDirectory("patches", source.directory("patches"))
      // Copy workspace directories for monorepo support (bun needs directories, not just package.json)
      .withDirectory("src/ha", source.directory("src/ha"), { exclude: ["node_modules"] })
      .withDirectory("src/cdk8s", source.directory("src/cdk8s"), { exclude: ["node_modules"] })
      .withDirectory("src/helm-types", source.directory("src/helm-types"), { exclude: ["node_modules"] })
      .withDirectory("src/deps-email", source.directory("src/deps-email"), { exclude: ["node_modules"] })
      // Copy .dagger/package.json (Dagger excludes .dagger by default, but we can copy specific files)
      .withFile(".dagger/package.json", source.file(".dagger/package.json"))
      // Install dependencies (includes zod from workspace packages)
      .withMountedCache("/root/.bun/install/cache", dag.cacheVolume("bun-cache-default"))
      .withExec(["bun", "install", "--frozen-lockfile"])
      // Now copy the files needed for the test
      .withFile("renovate.json", source.file("renovate.json"))
      .withFile("src/cdk8s/src/versions.ts", source.file("src/cdk8s/src/versions.ts"))
      .withFile(".dagger/src/versions.ts", source.file(".dagger/src/versions.ts"))
      .withFile(".dagger/test/test-renovate-regex.ts", source.file(".dagger/test/test-renovate-regex.ts"));

    // Use execOrThrow which works around the URLSearchParams bug by using ReturnType.Any
    return execOrThrow(container, ["bun", "run", ".dagger/test/test-renovate-regex.ts"]);
  }

  /**
   * Tests Helm chart structure, linting, and template rendering.
   * @param source The source directory containing the Helm chart and CDK8s code.
   * @returns The test results output.
   */
  @func()
  async testHelm(
    @argument({
      ignore: ["node_modules", "dist", "build", ".cache", "*.log", ".env*", "!.env.example", ".dagger"],
      defaultPath: ".",
    })
    source: Directory,
  ): Promise<string> {
    const testVersion = "0.1.0-test";

    // Build all charts with test version
    const helmDist = buildAllCharts(source, testVersion);

    // Test the built chart using TypeScript script
    // Copy Helm binary from official alpine/helm image (avoids network download issues)
    const helmBinary = dag.container().from(`alpine/helm:${versions["alpine/helm"]}`).file("/usr/bin/helm");

    const container = getMiseRuntimeContainer()
      .withMountedDirectory("/workspace", helmDist)
      .withWorkdir("/workspace")
      .withFile("/workspace/test-helm.ts", source.file("scripts/test-helm.ts"))
      .withFile("/usr/local/bin/helm", helmBinary)
      .withExec(["chmod", "+x", "/usr/local/bin/helm"])
      .withExec(["helm", "version"]);

    // Use execOrThrow which works around the URLSearchParams bug by using ReturnType.Any
    return execOrThrow(container, ["bun", "run", "./test-helm.ts"]);
  }

  /**
   * Runs TypeScript type checking for the Home Assistant (HA) app.
   * @param source The source directory for the HA app.
   * @param hassBaseUrl The Home Assistant base URL (as a Dagger Secret). Optional if src/ha/src/hass/ exists.
   * @param hassToken The Home Assistant long-lived access token (as a Dagger Secret). Optional if src/ha/src/hass/ exists.
   * @returns The stdout from the type check run.
   */
  @func()
  async typeCheckHa(
    @argument({
      ignore: ["node_modules", "dist", "build", ".cache", "*.log", ".env*", "!.env.example", ".dagger"],
      defaultPath: ".",
    })
    source: Directory,
    hassBaseUrl?: Secret,
    hassToken?: Secret,
  ) {
    return typeCheckHa(source, hassBaseUrl, hassToken);
  }

  /**
   * Runs linter for the Home Assistant (HA) app.
   * @param source The source directory for the HA app.
   * @param hassBaseUrl The Home Assistant base URL (as a Dagger Secret). Optional if src/ha/src/hass/ exists.
   * @param hassToken The Home Assistant long-lived access token (as a Dagger Secret). Optional if src/ha/src/hass/ exists.
   * @returns The stdout from the lint run.
   */
  @func()
  async lintHa(
    @argument({
      ignore: ["node_modules", "dist", "build", ".cache", "*.log", ".env*", "!.env.example", ".dagger"],
      defaultPath: ".",
    })
    source: Directory,
    hassBaseUrl?: Secret,
    hassToken?: Secret,
  ) {
    return lintHa(source, hassBaseUrl, hassToken);
  }

  /**
   * Runs linter for the CDK8s project.
   * @param source The repository root directory.
   * @returns The stdout from the lint run.
   */
  @func()
  async lintCdk8s(
    @argument({
      ignore: ["node_modules", "dist", "build", ".cache", "*.log", ".env*", "!.env.example", ".dagger"],
      defaultPath: ".",
    })
    source: Directory,
  ) {
    return lintCdk8s(source);
  }

  /**
   * Runs TypeScript type checking for the CDK8s project.
   * @param source The repository root directory.
   * @returns The stdout from the type check run.
   */
  @func()
  async typeCheckCdk8s(
    @argument({
      ignore: ["node_modules", "dist", "build", ".cache", "*.log", ".env*", "!.env.example", ".dagger"],
      defaultPath: ".",
    })
    source: Directory,
  ) {
    return typeCheckCdk8s(source);
  }

  /**
   * Builds Kubernetes manifests using CDK8s.
   * @param source The repository root directory.
   * @param outputDir The output directory for the generated manifests.
   * @returns The output directory containing the generated manifests.
   */
  @func()
  buildK8sManifests(
    @argument({
      ignore: ["node_modules", "dist", "build", ".cache", "*.log", ".env*", "!.env.example", ".dagger"],
      defaultPath: ".",
    })
    source: Directory,
  ): Directory {
    return buildK8sManifests(source);
  }

  /**
   * Tests the CDK8s source code (including GPU resource validation).
   * @param source The repository root directory.
   * @returns The output of the test.
   */
  @func()
  async testCdk8s(
    @argument({
      ignore: ["node_modules", "dist", "build", ".cache", "*.log", ".env*", "!.env.example", ".dagger"],
      defaultPath: ".",
    })
    source: Directory,
  ) {
    return testCdk8s(source);
  }

  /**
   * Triggers a sync operation on the ArgoCD application using the provided token.
   * @param argocdToken The ArgoCD API token for authentication (as a Dagger Secret).
   * @returns A concise message about the sync result.
   */
  @func()
  async sync(argocdToken: Secret) {
    const result = await argocdSync(argocdToken);
    return `ArgoCD Sync: ${result.status.toUpperCase()}\n${result.message}`;
  }

  /**
   * Applies Kubernetes manifests from the specified directory using kubectl.
   * @param source The source directory containing Kubernetes manifests.
   * @param manifestsPath The path within the source directory to the manifests (default: "manifests").
   * @returns The stdout from the kubectl apply command.
   */
  @func()
  async applyK8sConfig(
    @argument({
      ignore: ["node_modules", "dist", "build", ".cache", "*.log", ".env*", "!.env.example", ".dagger"],
      defaultPath: "manifests",
    })
    source: Directory,
    manifestsPath = "manifests",
  ) {
    return applyK8sConfig(source, manifestsPath);
  }

  /**
   * Builds manifests with CDK8s and applies them to the cluster using kubectl.
   * @param source The source directory for the CDK8s project.
   * @returns The stdout from the kubectl apply command.
   */
  @func()
  async buildAndApplyCdk8s(
    @argument({
      ignore: ["node_modules", "dist", "build", ".cache", "*.log", ".env*", "!.env.example", ".dagger"],
      defaultPath: ".",
    })
    source: Directory,
  ) {
    return buildAndApplyCdk8s(source);
  }

  /**
   * Builds the HA image and exports it to a tar file for testing.
   * @param source The source directory for the HA app.
   * @returns The exported tar file
   */
  @func()
  buildAndExportHaImage(
    @argument({
      ignore: ["node_modules", "dist", "build", ".cache", "*.log", ".env*", "!.env.example", ".dagger"],
      defaultPath: ".",
    })
    source: Directory,
  ): File {
    return buildAndExportHaImage(source);
  }

  /**
   * Builds the HA image and optionally pushes it to GHCR, returning a StepResult.
   *
   * - In 'prod', the image is built and pushed to GHCR.
   * - In 'dev', the image is built but not pushed (dry-run).
   *
   * @param source The source directory.
   * @param imageName The image name (including tag), e.g. ghcr.io/shepherdjerred/homelab:latest
   * @param ghcrUsername The GHCR username
   * @param ghcrPassword The GHCR password (as a Dagger Secret)
   * @param env The environment to run in: 'prod' to build and push, 'dev' to only build (default: 'dev').
   * @returns A StepResult object with status and message.
   */
  @func()
  async publishHaImage(
    @argument({
      ignore: ["node_modules", "dist", "build", ".cache", "*.log", ".env*", "!.env.example", ".dagger"],
      defaultPath: ".",
    })
    source: Directory,
    imageName: string,
    ghcrUsername: string,
    ghcrPassword: Secret,
    @argument() env: Stage = Stage.Dev,
  ): Promise<string> {
    return JSON.stringify(
      await buildAndPushHaImage(source, imageName, ghcrUsername, ghcrPassword, env !== Stage.Prod),
      null,
      2,
    );
  }

  /**
   * Builds all Helm charts, updates version/appVersion, and exports artifacts.
   * @param repoRoot The repository root directory.
   * @param version The raw build number (e.g. "123") - will be formatted as "1.0.0-123".
   * @returns The dist directory with packaged charts.
   */
  @func()
  helmBuild(
    @argument({
      ignore: ["node_modules", "dist", "build", ".cache", "*.log", ".env*", "!.env.example", ".dagger"],
      defaultPath: ".",
    })
    repoRoot: Directory,
    @argument() version: string,
  ): Directory {
    return buildAllCharts(repoRoot, `1.0.0-${version}`);
  }

  /**
   * Publishes all packaged Helm charts to a ChartMuseum repo and returns a StepResult.
   * @param repoRoot The repository root directory.
   * @param version The raw build number (e.g. "123") - will be formatted as "1.0.0-123".
   * @param repo The ChartMuseum repo URL.
   * @param chartMuseumUsername The ChartMuseum username.
   * @param chartMuseumPassword The ChartMuseum password (secret).
   * @param env The environment to run in: 'prod' to publish, 'dev' to skip (default: 'dev').
   * @returns A StepResult object with status and message.
   */
  @func()
  async helmPublish(
    @argument({ defaultPath: "." }) repoRoot: Directory,
    @argument() version: string,
    @argument() repo = "https://chartmuseum.tailnet-1a49.ts.net",
    chartMuseumUsername: string,
    chartMuseumPassword: Secret,
    @argument() env: Stage = Stage.Dev,
  ): Promise<StepResult> {
    if (env !== Stage.Prod) {
      return { status: "skipped", message: "[SKIPPED] Not prod" };
    }
    try {
      const fullVersion = `1.0.0-${version}`;
      const allChartsDist = buildAllCharts(repoRoot, fullVersion);
      const results = await publishAllCharts(
        allChartsDist,
        fullVersion,
        repo,
        chartMuseumUsername,
        chartMuseumPassword,
      );
      const message = Object.entries(results)
        .map(([chart, result]) => `${chart}: ${result}`)
        .join("\n");
      return { status: "passed", message };
    } catch (e: unknown) {
      return {
        status: "failed",
        message: `Helm Chart Publish: FAILED\n${formatDaggerError(e)}`,
      };
    }
  }

  /**
   * Publishes a pre-built Helm chart to a ChartMuseum repo and returns a StepResult.
   * This function works with the output of helmBuild (a dist directory).
   * @param builtDist The built Helm chart dist directory (from helmBuild).
   * @param version The full semver version (e.g. "1.0.0-123") - used as-is, no formatting applied.
   * @param repo The ChartMuseum repo URL.
   * @param chartMuseumUsername The ChartMuseum username.
   * @param chartMuseumPassword The ChartMuseum password (secret).
   * @param env The environment to run in: 'prod' to publish, 'dev' to skip (default: 'dev').
   * @returns A StepResult object with status and message.
   */
  @func()
  async helmPublishBuilt(
    builtDist: Directory,
    @argument() version: string,
    @argument() repo = "https://chartmuseum.tailnet-1a49.ts.net",
    chartMuseumUsername: string,
    chartMuseumPassword: Secret,
    @argument() env: Stage = Stage.Dev,
  ): Promise<StepResult> {
    if (env !== Stage.Prod) {
      return { status: "skipped", message: "[SKIPPED] Not prod" };
    }
    try {
      const results: string[] = [];

      for (const chartName of HELM_CHARTS) {
        const chartFile = `${chartName}-${version}.tgz`;
        // Use -w to append HTTP status code, write to file, then read it back
        // This avoids calling .stdout() which triggers a Dagger SDK bug
        const container = dag
          .container()
          .from(`alpine/helm:${versions["alpine/helm"]}`)
          .withMountedDirectory("/workspace", builtDist.directory(chartName))
          .withWorkdir("/workspace")
          .withEnvVariable("CHARTMUSEUM_USERNAME", chartMuseumUsername)
          .withSecretVariable("CHARTMUSEUM_PASSWORD", chartMuseumPassword)
          .withExec([
            "sh",
            "-c",
            `curl -s -w '\\n%{http_code}' -u $CHARTMUSEUM_USERNAME:$CHARTMUSEUM_PASSWORD --data-binary @${chartFile} ${repo}/api/charts > /tmp/result.txt 2>&1`,
          ]);

        const result = await container.file("/tmp/result.txt").contents();
        const lines = result.trim().split("\n");
        const httpCode = lines.pop() ?? "";
        const body = lines.join("\n");

        if (httpCode === "201" || httpCode === "200") {
          results.push(`${chartName}: published successfully`);
        } else if (httpCode === "409") {
          results.push(`${chartName}: already exists (409)`);
        } else {
          return {
            status: "failed",
            message: `Helm Chart Publish: FAILED for ${chartName}\nHTTP ${httpCode}: ${body}`,
          };
        }
      }

      return { status: "passed", message: results.join("\n") };
    } catch (err: unknown) {
      const errorMessage = formatDaggerError(err);
      return {
        status: "failed",
        message: `Helm Chart Publish: FAILED\n${errorMessage}`,
      };
    }
  }
}
