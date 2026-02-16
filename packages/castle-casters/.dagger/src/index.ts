import { func, argument, Directory, object, dag } from "@dagger.io/dagger";
import { runNamedParallel } from "@shepherdjerred/dagger-utils/utils";
import {
  buildProject,
  runTests,
  getJarArtifact,
  checkCodeQuality,
  generateCoverageReport,
  resolveDependencies,
} from "./maven";
import { logWithTimestamp, withTiming } from "./base";

@object()
export class CastleCasters {
  /**
   * Run all checks (build, test, code quality)
   * @param source The source directory
   * @returns A message indicating completion
   */
  @func()
  async check(
    @argument({
      ignore: [
        "target",
        "logs",
        "*.log",
        ".env*",
        "!.env.example",
        ".dagger",
        "node_modules",
        "dist",
        "build",
        ".cache",
      ],
      defaultPath: ".",
    })
    source: Directory
  ): Promise<string> {
    logWithTimestamp("🔍 Starting comprehensive check process");

    // Run checks in parallel with detailed error reporting
    const results = await withTiming("parallel checks", async () => {
      logWithTimestamp(
        "🔄 Running build, test, and quality checks in parallel..."
      );
      return runNamedParallel([
        { name: "build", operation: () => buildProject(source) },
        { name: "test", operation: () => runTests(source) },
        { name: "quality", operation: () => checkCodeQuality(source) },
      ]);
    });

    // Check for failures and report all of them
    const failures = results.filter((r) => !r.success);
    if (failures.length > 0) {
      const failureMessages = failures
        .map((f) => `${f.name}: ${f.error instanceof Error ? f.error.message : String(f.error)}`)
        .join("\n");
      throw new Error(`Check failed:\n${failureMessages}`);
    }

    logWithTimestamp("✅ All checks completed successfully!");
    return "All checks passed: build, test, and code quality verification completed successfully.";
  }

  /**
   * Build the project
   * @param source The source directory
   * @returns A message indicating completion
   */
  @func()
  async build(
    @argument({
      ignore: [
        "target",
        "logs",
        "*.log",
        ".env*",
        "!.env.example",
        ".dagger",
        "node_modules",
        "dist",
        "build",
        ".cache",
      ],
      defaultPath: ".",
    })
    source: Directory
  ): Promise<string> {
    logWithTimestamp("🔨 Starting build process");

    await withTiming("project build", async () => {
      await buildProject(source);
    });

    logWithTimestamp("✅ Build completed successfully!");
    return "Build completed successfully.";
  }

  /**
   * Run tests
   * @param source The source directory
   * @returns A message indicating completion
   */
  @func()
  async test(
    @argument({
      ignore: [
        "target",
        "logs",
        "*.log",
        ".env*",
        "!.env.example",
        ".dagger",
        "node_modules",
        "dist",
        "build",
        ".cache",
      ],
      defaultPath: ".",
    })
    source: Directory
  ): Promise<string> {
    logWithTimestamp("🧪 Starting test execution");

    await withTiming("test execution", async () => {
      await runTests(source);
    });

    logWithTimestamp("✅ Tests completed successfully!");
    return "Tests completed successfully.";
  }

  /**
   * Get the built JAR artifact
   * @param source The source directory
   * @returns The target directory containing the JAR
   */
  @func()
  async artifact(
    @argument({
      ignore: [
        "target",
        "logs",
        "*.log",
        ".env*",
        "!.env.example",
        ".dagger",
        "node_modules",
        "dist",
        "build",
        ".cache",
      ],
      defaultPath: ".",
    })
    source: Directory
  ): Promise<Directory> {
    logWithTimestamp("📦 Building and extracting artifact");

    const buildContainer = await withTiming("build for artifact", async () => {
      return buildProject(source);
    });

    const artifact = await withTiming("artifact extraction", async () => {
      return getJarArtifact(buildContainer);
    });

    logWithTimestamp("✅ Artifact extraction completed!");
    return artifact;
  }

  /**
   * Run the complete CI pipeline
   * @param source The source directory
   * @param version The version to build
   * @param gitSha The git SHA
   * @param env The environment (dev or prod)
   * @returns A message indicating completion
   */
  @func()
  async ci(
    @argument({
      ignore: [
        "target",
        "logs",
        "*.log",
        ".env*",
        "!.env.example",
        ".dagger",
        "node_modules",
        "dist",
        "build",
        ".cache",
      ],
      defaultPath: ".",
    })
    source: Directory,
    @argument() version: string,
    @argument() gitSha: string,
    env: string = "dev"
  ): Promise<string> {
    logWithTimestamp(
      `🚀 Starting CI pipeline for version ${version} (${gitSha})`
    );

    // Run all CI steps in parallel with detailed error reporting
    const results = await withTiming("CI pipeline execution", async () => {
      logWithTimestamp("🔄 Running CI pipeline steps...");
      return runNamedParallel([
        { name: "build", operation: () => buildProject(source) },
        { name: "test", operation: () => runTests(source) },
        { name: "quality", operation: () => checkCodeQuality(source) },
      ]);
    });

    // Check for failures and report all of them
    const failures = results.filter((r) => !r.success);
    if (failures.length > 0) {
      const failureMessages = failures
        .map((f) => `${f.name}: ${f.error instanceof Error ? f.error.message : String(f.error)}`)
        .join("\n");
      throw new Error(`CI pipeline failed:\n${failureMessages}`);
    }

    // If production environment, run additional steps
    if (env === "prod") {
      logWithTimestamp(
        "🏭 Production environment detected - running additional checks"
      );
      await withTiming("production coverage report", async () => {
        await generateCoverageReport(source);
      });
    }

    logWithTimestamp("✅ CI pipeline completed successfully!");
    return `CI pipeline completed successfully for version ${version} (${gitSha}) in ${env} environment.`;
  }

  /**
   * Resolve Maven dependencies
   * @param source The source directory
   * @returns A message indicating completion
   */
  @func()
  async deps(
    @argument({
      ignore: [
        "target",
        "logs",
        "*.log",
        ".env*",
        "!.env.example",
        ".dagger",
        "node_modules",
        "dist",
        "build",
        ".cache",
      ],
      defaultPath: ".",
    })
    source: Directory
  ): Promise<string> {
    logWithTimestamp("📦 Resolving Maven dependencies");

    await withTiming("dependency resolution", async () => {
      await resolveDependencies(source);
    });

    logWithTimestamp("✅ Dependencies resolved successfully!");
    return "Maven dependencies resolved successfully.";
  }

  /**
   * Generate coverage report
   * @param source The source directory
   * @returns The coverage report directory
   */
  @func()
  async coverage(
    @argument({
      ignore: [
        "target",
        "logs",
        "*.log",
        ".env*",
        "!.env.example",
        ".dagger",
        "node_modules",
        "dist",
        "build",
        ".cache",
      ],
      defaultPath: ".",
    })
    source: Directory
  ): Promise<Directory> {
    logWithTimestamp("📊 Generating coverage report");

    const coverageContainer = await withTiming("coverage generation", async () => {
      return generateCoverageReport(source);
    });

    const reportDir = await withTiming("coverage report extraction", async () => {
      return coverageContainer.directory("target/site/jacoco");
    });

    logWithTimestamp("✅ Coverage report generated successfully!");
    return reportDir;
  }

  /**
   * Run CI and return all artifacts in a single directory.
   * This consolidates ci, artifact, and coverage into one call.
   * @param source The source directory
   * @param version The version to build
   * @param gitSha The git SHA
   * @param env The environment (dev or prod)
   * @returns Directory containing all CI artifacts (JAR and coverage report for prod)
   */
  @func()
  async ciWithArtifacts(
    @argument({
      ignore: [
        "target",
        "logs",
        "*.log",
        ".env*",
        "!.env.example",
        ".dagger",
        "node_modules",
        "dist",
        "build",
        ".cache",
      ],
      defaultPath: ".",
    })
    source: Directory,
    @argument() version: string,
    @argument() gitSha: string,
    env: string = "dev"
  ): Promise<Directory> {
    const isProd = env === "prod";
    logWithTimestamp(
      `🚀 Starting CI pipeline with artifacts for version ${version} (${gitSha}) in ${env} environment`
    );

    // Run all CI steps in parallel
    const results = await withTiming("CI pipeline execution", async () => {
      logWithTimestamp("🔄 Running CI pipeline steps...");
      return runNamedParallel([
        { name: "build", operation: () => buildProject(source) },
        { name: "test", operation: () => runTests(source) },
        { name: "quality", operation: () => checkCodeQuality(source) },
      ]);
    });

    // Check for failures and report all of them
    const failures = results.filter((r) => !r.success);
    if (failures.length > 0) {
      const failureMessages = failures
        .map((f) => `${f.name}: ${f.error instanceof Error ? f.error.message : String(f.error)}`)
        .join("\n");
      throw new Error(`CI pipeline failed:\n${failureMessages}`);
    }

    // Get the build container from results to extract JAR
    const buildResult = results.find((r) => r.name === "build");
    if (!buildResult?.success || !buildResult.value) {
      throw new Error("Build result not found");
    }
    const buildContainer = buildResult.value as Awaited<ReturnType<typeof buildProject>>;

    // Extract JAR artifact
    const jarDir = await withTiming("artifact extraction", async () => {
      return getJarArtifact(buildContainer);
    });

    // For prod, also generate coverage report
    if (isProd) {
      logWithTimestamp("🏭 Production environment - generating coverage report");
      const coverageContainer = await withTiming("coverage generation", async () => {
        return generateCoverageReport(source);
      });

      const coverageDir = await withTiming("coverage extraction", async () => {
        return coverageContainer.directory("target/site/jacoco");
      });

      // Create a combined artifacts directory
      const artifactsDir = dag
        .directory()
        .withDirectory("jar", jarDir)
        .withDirectory("coverage", coverageDir);

      logWithTimestamp("✅ CI pipeline with artifacts completed successfully!");
      return artifactsDir;
    }

    // For dev, just return JAR in artifacts directory
    const artifactsDir = dag.directory().withDirectory("jar", jarDir);

    logWithTimestamp("✅ CI pipeline with artifacts completed successfully!");
    return artifactsDir;
  }
}
