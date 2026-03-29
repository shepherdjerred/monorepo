/**
 * Monorepo CI module — hermetic lint, typecheck, test, build, and publish.
 *
 * The `pkg` argument specifies which package subdirectory to operate on.
 * Each function runs the corresponding npm script from the package's package.json.
 */
import {
  dag,
  Container,
  Directory,
  File,
  Secret,
  object,
  func,
} from "@dagger.io/dagger";

import {
  qualityRatchetHelper,
  complianceCheckHelper,
  knipCheckHelper,
  gitleaksCheckHelper,
  suppressionCheckHelper,
} from "./quality";

import { trivyScanHelper, semgrepScanHelper } from "./security";

import { mavenBuildHelper, mavenTestHelper } from "./java";

import { latexBuildHelper } from "./latex";

import { BUILD_TIME_DEPS, WORKSPACE_DEPS } from "./deps";

import {
  helmPackageHelper,
  tofuApplyHelper,
  publishNpmHelper,
  deploySiteHelper,
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

// renovate: datasource=docker depName=oven/bun
const BUN_IMAGE = "oven/bun:1.2.17-debian";
// renovate: datasource=docker depName=rust
const RUST_IMAGE = "rust:1.89.0-bookworm";
// renovate: datasource=docker depName=golang
const GO_IMAGE = "golang:1.25.4-bookworm";
// renovate: datasource=docker depName=mcr.microsoft.com/playwright
const PLAYWRIGHT_IMAGE = "mcr.microsoft.com/playwright:v1.58.2-noble";
// renovate: datasource=docker depName=ghcr.io/realm/swiftlint
const SWIFTLINT_IMAGE = "ghcr.io/realm/swiftlint:0.58.2";

// Pinned Bun version for containers that install Bun manually (e.g. Playwright)
// renovate: datasource=npm depName=bun
const BUN_VERSION = "1.2.17";

/** Directories excluded when mounting source into containers. */
const SOURCE_EXCLUDES = [
  "**/node_modules",
  "**/.eslintcache",
  "**/dist",
  "**/target",
  ".git",
  "**/.vscode",
  "**/.idea",
  "**/coverage",
  "**/build",
  "**/.next",
  "**/.tsbuildinfo",
  "**/__pycache__",
  "**/.DS_Store",
  "**/archive",
];

// Stable cache volume names — never include version numbers
const BUN_CACHE = "bun-install-cache";
const ESLINT_CACHE = "eslint-cache";
const CARGO_REGISTRY = "cargo-registry";
const CARGO_TARGET = "cargo-target";
const GO_MOD = "go-mod";
const GO_BUILD = "go-build";

@object()
export class Monorepo {
  // ---------------------------------------------------------------------------
  // Base containers
  // ---------------------------------------------------------------------------

  /**
   * Bun container with dependencies installed from individual directory params.
   * Each directory is passed separately for optimal Dagger caching.
   */
  bunBase(
    pkgDir: Directory,
    pkg: string,
    depNames: string[] = [],
    depDirs: Directory[] = [],
    tsconfig: File | null = null,
    extraAptPackages: string[] = [],
  ): Container {
    let container = dag
      .container()
      .from(BUN_IMAGE)
      .withExec(["apt-get", "update", "-qq"])
      .withExec([
        "apt-get",
        "install",
        "-y",
        "-qq",
        "--no-install-recommends",
        "zstd",
        "python3",
        "python3-setuptools",
        "make",
        "g++",
        ...extraAptPackages,
      ])
      .withMountedCache("/root/.bun/install/cache", dag.cacheVolume(BUN_CACHE))
      .withWorkdir(`/workspace/packages/${pkg}`)
      .withDirectory(`/workspace/packages/${pkg}`, pkgDir, {
        exclude: SOURCE_EXCLUDES,
      });

    // Mount deps at correct relative paths for file: protocol resolution
    for (let i = 0; i < depNames.length; i++) {
      container = container.withDirectory(
        `/workspace/packages/${depNames[i]}`,
        depDirs[i],
        { exclude: SOURCE_EXCLUDES },
      );
    }

    if (tsconfig != null) {
      container = container.withFile("/workspace/tsconfig.base.json", tsconfig);
    }

    // Install and build deps first so dist/ exists before target's install resolves file: refs
    for (const dep of BUILD_TIME_DEPS) {
      if (depNames.includes(dep)) {
        container = container
          .withWorkdir(`/workspace/packages/${dep}`)
          .withExec(["bun", "install", "--frozen-lockfile"])
          .withExec(["bun", "run", "build"]);
      }
    }

    // Per-package lockfile — frozen install (after deps are built so file: refs find dist/)
    container = container
      .withWorkdir(`/workspace/packages/${pkg}`)
      .withExec(["bun", "install", "--frozen-lockfile"]);

    return container;
  }

  /**
   * Rust container with cargo caches and system deps (clang, openssl).
   */
  rustBase(pkgDir: Directory): Container {
    return dag
      .container()
      .from(RUST_IMAGE)
      .withExec(["apt-get", "update", "-qq"])
      .withExec([
        "apt-get",
        "install",
        "-y",
        "-qq",
        "clang",
        "libclang-dev",
        "pkg-config",
        "libssl-dev",
        "mold",
      ])
      .withMountedCache(
        "/usr/local/cargo/registry",
        dag.cacheVolume(CARGO_REGISTRY),
      )
      .withMountedCache("/usr/local/cargo/git", dag.cacheVolume("cargo-git"))
      .withMountedCache("/workspace/target", dag.cacheVolume(CARGO_TARGET))
      .withWorkdir("/workspace")
      .withDirectory("/workspace", pkgDir, {
        exclude: ["target", "node_modules", ".git"],
      });
  }

  /**
   * Go container with module caches mounted.
   */
  goBase(pkgDir: Directory): Container {
    return dag
      .container()
      .from(GO_IMAGE)
      .withMountedCache("/go/pkg/mod", dag.cacheVolume(GO_MOD))
      .withMountedCache("/root/.cache/go-build", dag.cacheVolume(GO_BUILD))
      .withWorkdir("/workspace")
      .withDirectory("/workspace", pkgDir, { exclude: [".git"] });
  }

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
    return this.bunBase(pkgDir, pkg, depNames, depDirs, tsconfig)
      .withMountedCache(
        `/workspace/packages/${pkg}/.eslintcache`,
        dag.cacheVolume(ESLINT_CACHE),
      )
      .withExec(["bun", "run", "lint"])
      .stdout();
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
    return this.bunBase(pkgDir, pkg, depNames, depDirs, tsconfig)
      .withExec(["bun", "run", "typecheck"])
      .stdout();
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
    return this.bunBase(pkgDir, pkg, depNames, depDirs, tsconfig)
      .withExec(["bun", "run", "test"])
      .stdout();
  }

  // ---------------------------------------------------------------------------
  // Prisma generation (run once, reuse across lint/typecheck/test)
  // ---------------------------------------------------------------------------

  /** Run bun run generate for a package and return the workspace with generated files */
  @func()
  generate(
    pkgDir: Directory,
    pkg: string,
    depNames: string[] = [],
    depDirs: Directory[] = [],
    tsconfig: File | null = null,
    extraAptPackages: string[] = [],
  ): Directory {
    return (
      this.bunBase(pkgDir, pkg, depNames, depDirs, tsconfig, extraAptPackages)
        .withWorkdir(`/workspace/packages/${pkg}`)
        // Install Node.js 22 for Prisma (its preinstall checks node version;
        // without a real Node.js, prisma binary is never created during bun install)
        .withExec([
          "bash",
          "-c",
          "curl -fsSL https://nodejs.org/dist/v22.16.0/node-v22.16.0-linux-x64.tar.xz | tar -xJ --strip-components=1 -C /opt/node && export PATH=/opt/node/bin:$PATH && bun install --frozen-lockfile && bun run generate",
        ])
        .directory("/workspace")
    );
  }

  /** Run lint with pre-generated workspace (e.g. after Prisma generate) */
  @func()
  async lintWithGenerated(generated: Directory, pkg: string): Promise<string> {
    return dag
      .container()
      .from(BUN_IMAGE)
      .withWorkdir(`/workspace/packages/${pkg}`)
      .withDirectory("/workspace", generated)
      .withMountedCache(
        `/workspace/packages/${pkg}/.eslintcache`,
        dag.cacheVolume(ESLINT_CACHE),
      )
      .withExec(["bun", "run", "lint"])
      .stdout();
  }

  /**
   * Base container with system deps for running generated workspaces.
   * Mirrors the apt-get packages from bunBase so tests/typechecks have
   * the same system tools (python3, make, g++) available.
   */
  private generatedBase(generated: Directory, pkg: string): Container {
    return dag
      .container()
      .from(BUN_IMAGE)
      .withExec(["apt-get", "update", "-qq"])
      .withExec([
        "apt-get",
        "install",
        "-y",
        "-qq",
        "--no-install-recommends",
        "python3",
        "make",
        "g++",
      ])
      .withWorkdir(`/workspace/packages/${pkg}`)
      .withDirectory("/workspace", generated);
  }

  /** Run typecheck with pre-generated workspace */
  @func()
  async typecheckWithGenerated(
    generated: Directory,
    pkg: string,
  ): Promise<string> {
    return this.generatedBase(generated, pkg)
      .withExec(["bun", "run", "typecheck"])
      .stdout();
  }

  /** Run test with pre-generated workspace */
  @func()
  async testWithGenerated(generated: Directory, pkg: string): Promise<string> {
    return this.generatedBase(generated, pkg)
      .withExec(["bun", "run", "test"])
      .stdout();
  }

  // ---------------------------------------------------------------------------
  // Combined generate + action (avoids nested CLI calls / SSH serialization)
  // ---------------------------------------------------------------------------

  /** Generate then lint in a single pipeline */
  @func()
  async generateAndLint(
    pkgDir: Directory,
    pkg: string,
    depNames: string[] = [],
    depDirs: Directory[] = [],
    tsconfig: File | null = null,
    extraAptPackages: string[] = [],
  ): Promise<string> {
    const generated = this.generate(
      pkgDir,
      pkg,
      depNames,
      depDirs,
      tsconfig,
      extraAptPackages,
    );
    return this.lintWithGenerated(generated, pkg);
  }

  /** Generate then typecheck in a single pipeline */
  @func()
  async generateAndTypecheck(
    pkgDir: Directory,
    pkg: string,
    depNames: string[] = [],
    depDirs: Directory[] = [],
    tsconfig: File | null = null,
    extraAptPackages: string[] = [],
  ): Promise<string> {
    const generated = this.generate(
      pkgDir,
      pkg,
      depNames,
      depDirs,
      tsconfig,
      extraAptPackages,
    );
    return this.typecheckWithGenerated(generated, pkg);
  }

  /** Generate then test in a single pipeline */
  @func()
  async generateAndTest(
    pkgDir: Directory,
    pkg: string,
    depNames: string[] = [],
    depDirs: Directory[] = [],
    tsconfig: File | null = null,
    extraAptPackages: string[] = [],
  ): Promise<string> {
    const generated = this.generate(
      pkgDir,
      pkg,
      depNames,
      depDirs,
      tsconfig,
      extraAptPackages,
    );
    return this.testWithGenerated(generated, pkg);
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
    let container = this.bunBase(
      pkgDir,
      "homelab/src/ha",
      depNames,
      depDirs,
      tsconfig,
      ["nodejs", "npm"],
    );

    // HA tsconfig extends ../../tsconfig.base.json (homelab level);
    // pkgDir only contains src/ha, so mount the parent tsconfig too.
    if (homelabTsconfig != null) {
      container = container.withFile(
        "/workspace/packages/homelab/tsconfig.base.json",
        homelabTsconfig,
      );
    }

    return container
      .withSecretVariable("HASS_TOKEN", hassToken)
      .withEnvVariable("HASS_BASE_URL", hassBaseUrl)
      .withExec(["bun", "run", "generate-types"])
      .directory("/workspace");
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
    const generated = this.haGenerate(
      pkgDir,
      hassToken,
      depNames,
      depDirs,
      tsconfig,
      homelabTsconfig,
    );
    return dag
      .container()
      .from(BUN_IMAGE)
      .withWorkdir("/workspace/packages/homelab/src/ha")
      .withDirectory("/workspace", generated)
      .withMountedCache(
        "/workspace/packages/homelab/src/ha/.eslintcache",
        dag.cacheVolume(ESLINT_CACHE),
      )
      .withExec(["bun", "run", "lint"])
      .stdout();
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
    const generated = this.haGenerate(
      pkgDir,
      hassToken,
      depNames,
      depDirs,
      tsconfig,
      homelabTsconfig,
    );
    return dag
      .container()
      .from(BUN_IMAGE)
      .withWorkdir("/workspace/packages/homelab/src/ha")
      .withDirectory("/workspace", generated)
      .withExec(["bun", "run", "typecheck"])
      .stdout();
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
    return this.bunBase(pkgDir, pkg, depNames, depDirs, tsconfig)
      .withExec(["bunx", "astro", "check"])
      .stdout();
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
    return this.bunBase(pkgDir, pkg, depNames, depDirs, tsconfig)
      .withExec(["bunx", "playwright", "install", "--with-deps", "chromium"])
      .withExec(["bunx", "astro", "build"])
      .directory(`/workspace/packages/${pkg}/dist`);
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
    return this.bunBase(pkgDir, pkg, depNames, depDirs, tsconfig)
      .withExec(["bunx", "vite", "build"])
      .directory(`/workspace/packages/${pkg}/dist`);
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
    const excludes = ["node_modules", "dist", ".eslintcache"];

    // Build a minimal workspace: target + needed packages
    let container = dag
      .container()
      .from(BUN_IMAGE)
      .withMountedCache("/root/.bun/install/cache", dag.cacheVolume(BUN_CACHE))
      .withWorkdir("/workspace")
      .withDirectory(`/workspace/packages/${pkg}`, pkgDir, {
        exclude: excludes,
      });

    for (let i = 0; i < depNames.length; i++) {
      container = container.withDirectory(
        `/workspace/packages/${depNames[i]}`,
        depDirs[i],
        { exclude: excludes },
      );
    }

    // Install deps then set up the final image
    return container
      .withExec(["bun", "install"])
      .withWorkdir(`/workspace/packages/${pkg}`)
      .withLabel(
        "org.opencontainers.image.source",
        "https://github.com/shepherdjerred/monorepo",
      )
      .withLabel("org.opencontainers.image.version", version)
      .withLabel("org.opencontainers.image.revision", gitSha)
      .withEnvVariable("VERSION", version)
      .withEnvVariable("GIT_SHA", gitSha)
      .withExposedPort(8000)
      .withEntrypoint(["bun", "run", "src/index.ts"]);
  }

  /** Push a built image to a registry */
  @func({ cache: "never" })
  async pushImage(
    pkgDir: Directory,
    pkg: string,
    tag: string,
    registryUsername: string,
    registryPassword: Secret,
    depNames: string[] = [],
    depDirs: Directory[] = [],
    version: string = "dev",
    gitSha: string = "unknown",
  ): Promise<string> {
    const image = this.buildImage(
      pkgDir,
      pkg,
      depNames,
      depDirs,
      version,
      gitSha,
    );
    return image
      .withRegistryAuth("ghcr.io", registryUsername, registryPassword)
      .publish(tag);
  }

  // ---------------------------------------------------------------------------
  // Rust operations (clauderon)
  // ---------------------------------------------------------------------------

  /** Run cargo fmt --check */
  @func()
  async rustFmt(pkgDir: Directory): Promise<string> {
    return this.rustBase(pkgDir)
      .withExec(["rustup", "component", "add", "rustfmt"])
      .withExec(["cargo", "fmt", "--check"])
      .stdout();
  }

  /** Run cargo clippy */
  @func()
  async rustClippy(pkgDir: Directory): Promise<string> {
    return this.rustBase(pkgDir)
      .withExec(["rustup", "component", "add", "clippy"])
      .withExec([
        "cargo",
        "clippy",
        "--all-targets",
        "--all-features",
        "--",
        "-D",
        "warnings",
      ])
      .stdout();
  }

  /** Run cargo test */
  @func()
  async rustTest(pkgDir: Directory): Promise<string> {
    return this.rustBase(pkgDir)
      .withExec(["cargo", "test", "--all-features"])
      .stdout();
  }

  /** Build the Rust project */
  @func()
  rustBuild(
    pkgDir: Directory,
    target: string = "x86_64-unknown-linux-gnu",
  ): Container {
    return this.rustBase(pkgDir)
      .withExec(["rustup", "target", "add", target])
      .withExec(["cargo", "build", "--release", "--target", target]);
  }

  // ---------------------------------------------------------------------------
  // Go operations (terraform-provider-asuswrt)
  // ---------------------------------------------------------------------------

  /** Run go build */
  @func()
  async goBuild(pkgDir: Directory): Promise<string> {
    return this.goBase(pkgDir).withExec(["go", "build", "./..."]).stdout();
  }

  /** Run go test */
  @func()
  async goTest(pkgDir: Directory): Promise<string> {
    return this.goBase(pkgDir).withExec(["go", "test", "./...", "-v"]).stdout();
  }

  /** Run golangci-lint (v2) */
  @func()
  async goLint(pkgDir: Directory): Promise<string> {
    return this.goBase(pkgDir)
      .withExec([
        "go",
        "install",
        "github.com/golangci/golangci-lint/v2/cmd/golangci-lint@latest",
      ])
      .withExec(["golangci-lint", "run", "./..."])
      .stdout();
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
    return this.bunBase(
      pkgDir,
      "homelab/src/cdk8s",
      depNames,
      depDirs,
      tsconfig,
    )
      .withExec(["bun", "run", "build"])
      .directory("/workspace/packages/homelab/src/cdk8s/dist");
  }

  // ---------------------------------------------------------------------------
  // Swift operations (lint only — build/test require macOS)
  // ---------------------------------------------------------------------------

  /** Run swiftlint on a Swift package */
  @func()
  async swiftLint(source: Directory, pkg: string): Promise<string> {
    return dag
      .container()
      .from(SWIFTLINT_IMAGE)
      .withWorkdir("/workspace")
      .withDirectory("/workspace", source.directory(`packages/${pkg}`), {
        exclude: [".build/**", "**/.build/**"],
      })
      .withExec(["swiftlint", "--strict"])
      .stdout();
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
    let container = dag
      .container()
      .from(PLAYWRIGHT_IMAGE)
      // Install pinned bun on the Playwright image (needs unzip)
      .withExec(["apt-get", "update", "-qq"])
      .withExec([
        "apt-get",
        "install",
        "-y",
        "-qq",
        "--no-install-recommends",
        "unzip",
      ])
      .withExec([
        "bash",
        "-c",
        `curl -fsSL https://bun.sh/install | bash -s -- bun-v${BUN_VERSION}`,
      ])
      .withEnvVariable(
        "PATH",
        "/root/.bun/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
      )
      .withEnvVariable("CI", "true")
      .withMountedCache("/root/.bun/install/cache", dag.cacheVolume(BUN_CACHE))
      .withWorkdir(`/workspace/packages/${pkg}`)
      .withDirectory(`/workspace/packages/${pkg}`, pkgDir, {
        exclude: SOURCE_EXCLUDES,
      });

    // Mount deps at correct relative paths
    for (let i = 0; i < depNames.length; i++) {
      container = container.withDirectory(
        `/workspace/packages/${depNames[i]}`,
        depDirs[i],
        { exclude: SOURCE_EXCLUDES },
      );
    }

    if (tsconfig != null) {
      container = container.withFile("/workspace/tsconfig.base.json", tsconfig);
    }

    // Install and build deps first so dist/ exists before target's install resolves file: refs
    for (const dep of BUILD_TIME_DEPS) {
      if (depNames.includes(dep)) {
        container = container
          .withWorkdir(`/workspace/packages/${dep}`)
          .withExec(["bun", "install", "--frozen-lockfile"])
          .withExec(["bun", "run", "build"]);
      }
    }

    container = container
      .withWorkdir(`/workspace/packages/${pkg}`)
      .withExec(["bun", "install", "--frozen-lockfile"]);

    return (
      container
        // Build the site first — playwright tests run against astro preview which needs dist/
        .withExec(["bunx", "astro", "build"])
        .withExec(["bun", "run", "test"])
        .stdout()
    );
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
    let container = dag
      .container()
      .from(PLAYWRIGHT_IMAGE)
      .withExec(["apt-get", "update", "-qq"])
      .withExec([
        "apt-get",
        "install",
        "-y",
        "-qq",
        "--no-install-recommends",
        "unzip",
      ])
      .withExec([
        "bash",
        "-c",
        `curl -fsSL https://bun.sh/install | bash -s -- bun-v${BUN_VERSION}`,
      ])
      .withEnvVariable(
        "PATH",
        "/root/.bun/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
      )
      .withEnvVariable("CI", "true")
      .withMountedCache("/root/.bun/install/cache", dag.cacheVolume(BUN_CACHE))
      .withWorkdir(`/workspace/packages/${pkg}`)
      .withDirectory(`/workspace/packages/${pkg}`, pkgDir, {
        exclude: SOURCE_EXCLUDES,
      });

    // Mount deps at correct relative paths
    for (let i = 0; i < depNames.length; i++) {
      container = container.withDirectory(
        `/workspace/packages/${depNames[i]}`,
        depDirs[i],
        { exclude: SOURCE_EXCLUDES },
      );
    }

    if (tsconfig != null) {
      container = container.withFile("/workspace/tsconfig.base.json", tsconfig);
    }

    // Install and build deps first so dist/ exists before target's install resolves file: refs
    for (const dep of BUILD_TIME_DEPS) {
      if (depNames.includes(dep)) {
        container = container
          .withWorkdir(`/workspace/packages/${dep}`)
          .withExec(["bun", "install", "--frozen-lockfile"])
          .withExec(["bun", "run", "build"]);
      }
    }

    container = container
      .withWorkdir(`/workspace/packages/${pkg}`)
      .withExec(["bun", "install", "--frozen-lockfile"]);

    return container
      .withExec(["bunx", "astro", "build"])
      .withExec(["bunx", "playwright", "test", "--update-snapshots"])
      .directory(`/workspace/packages/${pkg}/test`);
  }

  // ---------------------------------------------------------------------------
  // Quality gates
  // ---------------------------------------------------------------------------

  /** Run prettier check across the repo */
  @func()
  async prettier(source: Directory): Promise<string> {
    return dag
      .container()
      .from(BUN_IMAGE)
      .withMountedCache("/root/.bun/install/cache", dag.cacheVolume(BUN_CACHE))
      .withWorkdir("/workspace")
      .withDirectory("/workspace", source, {
        exclude: SOURCE_EXCLUDES,
      })
      .withExec(["bunx", "prettier", "--check", "."])
      .stdout();
  }

  /** Run shellcheck on all shell scripts */
  @func()
  async shellcheck(source: Directory): Promise<string> {
    return dag
      .container()
      .from("koalaman/shellcheck-alpine:stable")
      .withWorkdir("/workspace")
      .withDirectory("/workspace", source, {
        include: ["**/*.sh"],
        exclude: [
          "**/archive/**",
          "**/node_modules/**",
          "**/Pods/**",
          "**/target/**",
        ],
      })
      .withExec([
        "sh",
        "-c",
        "find /workspace -name '*.sh' -print0 | xargs -0 shellcheck --severity=warning",
      ])
      .stdout();
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
    const tsPackages = [
      "webring",
      "bun-decompile",
      "eslint-config",
      "resume",
      "astro-opengraph-images",
      "cooklang-rich-preview",
      "birmel",
      "starlight-karma-bot",
      "tasknotes-server",
      "tasknotes-types",
      "better-skill-capped",
      "hn-enhancer",
      "monarch",
      "discord-plays-pokemon",
      "tasks-for-obsidian",
      "toolkit",
      "sjer.red",
      "homelab",
    ];

    const tsconfig = source.file("tsconfig.base.json");

    // Helper: extract pkgDir and dep dirs from full source for a package
    const dirsFor = (pkg: string) => {
      const pkgDir = source.directory(`packages/${pkg}`);
      const deps = WORKSPACE_DEPS[pkg] ?? [];
      const depDirs = deps.map((d: string) =>
        source.directory(`packages/${d}`),
      );
      return { pkgDir, depNames: deps, depDirs };
    };

    interface CheckResult {
      label: string;
      status: "PASS" | "FAIL";
      error?: string;
    }

    const allChecks: Promise<CheckResult>[] = [];

    // Helper to run a check and capture the full error on failure
    const check = (label: string, container: Container): Promise<CheckResult> =>
      container
        .stdout()
        .then((): CheckResult => ({ label, status: "PASS" }))
        .catch(
          (e: Error): CheckResult => ({
            label,
            status: "FAIL",
            error: e.message,
          }),
        );

    // Run all TS packages in parallel
    for (const pkg of tsPackages) {
      const { pkgDir, depNames, depDirs } = dirsFor(pkg);
      const base = this.bunBase(pkgDir, pkg, depNames, depDirs, tsconfig);
      allChecks.push(
        check(
          `${pkg}: lint`,
          base
            .withMountedCache(
              `/workspace/packages/${pkg}/.eslintcache`,
              dag.cacheVolume(ESLINT_CACHE),
            )
            .withExec(["bun", "run", "lint"]),
        ),
      );
      allChecks.push(
        check(`${pkg}: typecheck`, base.withExec(["bun", "run", "typecheck"])),
      );
      allChecks.push(
        check(`${pkg}: test`, base.withExec(["bun", "run", "test"])),
      );
    }

    // Rust checks
    const rustB = this.rustBase(source);
    allChecks.push(
      check(
        "clauderon: fmt",
        rustB
          .withExec(["rustup", "component", "add", "rustfmt"])
          .withExec(["cargo", "fmt", "--check"]),
      ),
    );
    allChecks.push(
      check(
        "clauderon: clippy",
        rustB
          .withExec(["rustup", "component", "add", "clippy"])
          .withExec([
            "cargo",
            "clippy",
            "--all-targets",
            "--all-features",
            "--",
            "-D",
            "warnings",
          ]),
      ),
    );
    allChecks.push(
      check(
        "clauderon: test",
        rustB.withExec(["cargo", "test", "--all-features"]),
      ),
    );

    // Go checks
    const goB = this.goBase(source);
    allChecks.push(check("go: build", goB.withExec(["go", "build", "./..."])));
    allChecks.push(
      check("go: test", goB.withExec(["go", "test", "./...", "-v"])),
    );
    allChecks.push(
      check(
        "go: lint",
        goB
          .withExec([
            "go",
            "install",
            "github.com/golangci/golangci-lint/v2/cmd/golangci-lint@latest",
          ])
          .withExec(["golangci-lint", "run", "./..."]),
      ),
    );

    // scout-for-lol: generate then lint/typecheck/test
    const scoutInfo = dirsFor("scout-for-lol");
    const scoutGenerated = this.bunBase(
      scoutInfo.pkgDir,
      "scout-for-lol",
      scoutInfo.depNames,
      scoutInfo.depDirs,
      tsconfig,
    )
      .withExec(["bun", "run", "generate"])
      .directory("/workspace");
    const scoutContainer = dag
      .container()
      .from(BUN_IMAGE)
      .withDirectory("/workspace", scoutGenerated)
      .withWorkdir("/workspace/packages/scout-for-lol");
    allChecks.push(
      check(
        "scout-for-lol: lint",
        scoutContainer.withExec(["bun", "run", "lint"]),
      ),
    );
    allChecks.push(
      check(
        "scout-for-lol: typecheck",
        scoutContainer.withExec(["bun", "run", "typecheck"]),
      ),
    );
    allChecks.push(
      check(
        "scout-for-lol: test",
        scoutContainer.withExec(["bun", "run", "test"]),
      ),
    );

    // homelab/ha: generate types then lint/typecheck (requires HASS_TOKEN)
    if (hassToken != null) {
      const haInfo = dirsFor("homelab/src/ha");
      const haGenerated = this.bunBase(
        haInfo.pkgDir,
        "homelab/src/ha",
        haInfo.depNames,
        haInfo.depDirs,
        tsconfig,
      )
        .withSecretVariable("HASS_TOKEN", hassToken)
        .withEnvVariable("HASS_BASE_URL", "https://homeassistant.sjer.red")
        .withExec(["bun", "run", "generate-types"])
        .directory("/workspace");
      const haContainer = dag
        .container()
        .from(BUN_IMAGE)
        .withDirectory("/workspace", haGenerated)
        .withWorkdir("/workspace/packages/homelab/src/ha");
      allChecks.push(
        check("homelab/ha: lint", haContainer.withExec(["bun", "run", "lint"])),
      );
      allChecks.push(
        check(
          "homelab/ha: typecheck",
          haContainer.withExec(["bun", "run", "typecheck"]),
        ),
      );
    }

    // Wait for all checks to complete
    const results = await Promise.all(allChecks);

    // Build summary
    const lines: string[] = [];
    const failures: CheckResult[] = [];
    for (const r of results) {
      if (r.status === "FAIL") {
        lines.push(`FAIL  ${r.label}`);
        failures.push(r);
      } else {
        lines.push(`PASS  ${r.label}`);
      }
    }

    if (hassToken == null) {
      lines.push("SKIP  homelab/ha (no hassToken)");
    }

    const summary = lines.join("\n");

    if (failures.length > 0) {
      const details = failures
        .map((f) => `--- ${f.label} ---\n${f.error}`)
        .join("\n\n");
      throw new Error(
        `${failures.length} check(s) failed:\n\n${summary}\n\n${details}`,
      );
    }

    return summary;
  }

  // ---------------------------------------------------------------------------
  // Quality gates (repo-wide)
  // ---------------------------------------------------------------------------

  /** Run the quality ratchet check across the repo */
  @func()
  async qualityRatchet(source: Directory): Promise<string> {
    return qualityRatchetHelper(source).stdout();
  }

  /** Run the compliance check across the repo */
  @func()
  async complianceCheck(source: Directory): Promise<string> {
    return complianceCheckHelper(source).stdout();
  }

  /** Run knip to detect unused exports and dependencies */
  @func()
  async knipCheck(source: Directory): Promise<string> {
    return knipCheckHelper(source).stdout();
  }

  /** Run gitleaks to detect secrets in the source tree */
  @func()
  async gitleaksCheck(source: Directory): Promise<string> {
    return gitleaksCheckHelper(source).stdout();
  }

  /** Run the suppression check across the repo */
  @func()
  async suppressionCheck(source: Directory): Promise<string> {
    return suppressionCheckHelper(source).stdout();
  }

  // ---------------------------------------------------------------------------
  // Security scanning
  // ---------------------------------------------------------------------------

  /** Run trivy to scan for high and critical vulnerabilities */
  @func()
  async trivyScan(source: Directory): Promise<string> {
    return trivyScanHelper(source).stdout();
  }

  /** Run semgrep to scan for code quality and security issues */
  @func()
  async semgrepScan(source: Directory): Promise<string> {
    return semgrepScanHelper(source).stdout();
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

  // ---------------------------------------------------------------------------
  // LaTeX operations
  // ---------------------------------------------------------------------------

  /** Build the LaTeX resume with xelatex */
  @func()
  async latexBuild(pkgDir: Directory): Promise<string> {
    return latexBuildHelper(pkgDir).stdout();
  }

  // ---------------------------------------------------------------------------
  // Release/deploy operations (all cache: "never")
  // ---------------------------------------------------------------------------

  /** Package and push a single Helm chart to ChartMuseum */
  @func({ cache: "never" })
  async helmPackage(
    source: Directory,
    chartName: string,
    version: string,
    chartMuseumUsername: string,
    chartMuseumPassword: Secret,
  ): Promise<string> {
    return helmPackageHelper(
      source,
      chartName,
      version,
      chartMuseumUsername,
      chartMuseumPassword,
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
  ): Promise<string> {
    return tofuApplyHelper(
      source,
      stack,
      awsAccessKeyId,
      awsSecretAccessKey,
      ghToken,
      cloudflareAccountId,
    ).stdout();
  }

  /** Publish an npm package via bun publish */
  @func({ cache: "never" })
  async publishNpm(
    pkgDir: Directory,
    pkg: string,
    npmToken: Secret,
    depNames: string[] = [],
    depDirs: Directory[] = [],
  ): Promise<string> {
    return publishNpmHelper(pkgDir, pkg, npmToken, depNames, depDirs).stdout();
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
    ).stdout();
  }

  /** Trigger an ArgoCD sync for an application */
  @func({ cache: "never" })
  async argoCdSync(
    appName: string,
    argoCdToken: Secret,
    serverUrl: string = "https://argocd.sjer.red",
  ): Promise<string> {
    return argoCdSyncHelper(appName, argoCdToken, serverUrl).stdout();
  }

  /** Wait for an ArgoCD application to become healthy */
  @func({ cache: "never" })
  async argoCdHealthWait(
    appName: string,
    argoCdToken: Secret,
    timeoutSeconds: number = 300,
    serverUrl: string = "https://argocd.sjer.red",
  ): Promise<string> {
    return argoCdHealthWaitHelper(
      appName,
      argoCdToken,
      timeoutSeconds,
      serverUrl,
    ).stdout();
  }

  /** Build cooklang-for-obsidian artifacts */
  @func({ cache: "never" })
  async cooklangBuild(
    pkgDir: Directory,
    depNames: string[] = [],
    depDirs: Directory[] = [],
  ): Promise<string> {
    return cooklangBuildHelper(pkgDir, depNames, depDirs).stdout();
  }

  /** Push cooklang artifacts to GitHub repository */
  @func({ cache: "never" })
  async cooklangPush(
    source: Directory,
    version: string,
    ghToken: Secret,
  ): Promise<string> {
    return cooklangPushHelper(source, version, ghToken).stdout();
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
  ): Promise<string> {
    return clauderonUploadHelper(binaries, version, ghToken).stdout();
  }

  /** Update versions.ts with new image digests and create auto-merge PR */
  @func({ cache: "never" })
  async versionCommitBack(
    digests: string,
    version: string,
    ghToken: Secret,
  ): Promise<string> {
    return versionCommitBackHelper(digests, version, ghToken).stdout();
  }

  /** Run release-please to create release PRs and GitHub releases */
  @func({ cache: "never" })
  async releasePlease(source: Directory, ghToken: Secret): Promise<string> {
    return releasePleaseHelper(source, ghToken).stdout();
  }

  /** Create a GitHub release for cooklang-rich-preview */
  @func({ cache: "never" })
  async cooklangCreateRelease(
    artifacts: Directory,
    version: string,
    ghToken: Secret,
  ): Promise<string> {
    return cooklangCreateReleaseHelper(artifacts, version, ghToken).stdout();
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
}
