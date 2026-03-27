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
  Secret,
  object,
  func,
} from "@dagger.io/dagger";

const BUN_IMAGE = "oven/bun:debian";
const RUST_IMAGE = "rust:1.88-bookworm";
const GO_IMAGE = "golang:1.25-bookworm";
const PLAYWRIGHT_IMAGE = "mcr.microsoft.com/playwright:v1.58.2-noble";

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
   * Bun container with dependencies installed. Excludes node_modules from
   * source to avoid macOS/Linux binary mismatches (e.g. esbuild).
   */
  bunBase(source: Directory, pkg: string): Container {
    return (
      dag
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
        ])
        .withMountedCache(
          "/root/.bun/install/cache",
          dag.cacheVolume(BUN_CACHE),
        )
        .withWorkdir("/workspace")
        .withDirectory("/workspace", source, {
          exclude: [
            "**/node_modules",
            "**/.eslintcache",
            "**/dist",
            "**/target",
            ".git",
          ],
        })
        .withExec(["bun", "install", "--frozen-lockfile"])
        // Build workspace deps that publish types/exports via dist/
        .withWorkdir("/workspace/packages/eslint-config")
        .withExec(["bun", "run", "build"])
        .withWorkdir("/workspace/packages/astro-opengraph-images")
        .withExec(["bun", "run", "build"])
        .withWorkdir("/workspace/packages/webring")
        .withExec(["bun", "run", "build"])
        .withWorkdir(`/workspace/packages/${pkg}`)
    );
  }

  /**
   * Rust container with cargo caches and system deps (clang, openssl).
   */
  rustBase(source: Directory): Container {
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
      .withMountedCache("/workspace/target", dag.cacheVolume(CARGO_TARGET))
      .withWorkdir("/workspace")
      .withDirectory("/workspace", source.directory("packages/clauderon"), {
        exclude: ["target", "node_modules"],
      });
  }

  /**
   * Go container with module caches mounted.
   */
  goBase(source: Directory): Container {
    return dag
      .container()
      .from(GO_IMAGE)
      .withMountedCache("/go/pkg/mod", dag.cacheVolume(GO_MOD))
      .withMountedCache("/root/.cache/go-build", dag.cacheVolume(GO_BUILD))
      .withWorkdir("/workspace")
      .withDirectory(
        "/workspace",
        source.directory("packages/terraform-provider-asuswrt"),
      );
  }

  // ---------------------------------------------------------------------------
  // Standard TS operations (lint, typecheck, test)
  // ---------------------------------------------------------------------------

  /** Run the lint script on a package */
  @func()
  async lint(source: Directory, pkg: string): Promise<string> {
    return this.bunBase(source, pkg)
      .withMountedCache(
        `/workspace/packages/${pkg}/.eslintcache`,
        dag.cacheVolume(ESLINT_CACHE),
      )
      .withExec(["bun", "run", "lint"])
      .stdout();
  }

  /** Run the typecheck script on a package */
  @func()
  async typecheck(source: Directory, pkg: string): Promise<string> {
    return this.bunBase(source, pkg)
      .withExec(["bun", "run", "typecheck"])
      .stdout();
  }

  /** Run the test script on a package */
  @func()
  async test(source: Directory, pkg: string): Promise<string> {
    return this.bunBase(source, pkg).withExec(["bun", "run", "test"]).stdout();
  }

  // ---------------------------------------------------------------------------
  // Prisma generation (run once, reuse across lint/typecheck/test)
  // ---------------------------------------------------------------------------

  /** Run bun run generate for a package and return the workspace with generated files */
  @func()
  generate(source: Directory, pkg: string): Directory {
    return this.bunBase(source, pkg)
      .withWorkdir(`/workspace/packages/${pkg}`)
      .withExec(["bun", "run", "generate"])
      .directory("/workspace");
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

  /** Run typecheck with pre-generated workspace */
  @func()
  async typecheckWithGenerated(
    generated: Directory,
    pkg: string,
  ): Promise<string> {
    return dag
      .container()
      .from(BUN_IMAGE)
      .withWorkdir(`/workspace/packages/${pkg}`)
      .withDirectory("/workspace", generated)
      .withExec(["bun", "run", "typecheck"])
      .stdout();
  }

  /** Run test with pre-generated workspace */
  @func()
  async testWithGenerated(generated: Directory, pkg: string): Promise<string> {
    return dag
      .container()
      .from(BUN_IMAGE)
      .withWorkdir(`/workspace/packages/${pkg}`)
      .withDirectory("/workspace", generated)
      .withExec(["bun", "run", "test"])
      .stdout();
  }

  // ---------------------------------------------------------------------------
  // HA type generation (requires live Home Assistant instance)
  // ---------------------------------------------------------------------------

  /** Generate Home Assistant entity types by introspecting a live HA instance */
  @func()
  haGenerate(
    source: Directory,
    hassToken: Secret,
    hassBaseUrl: string = "https://homeassistant.sjer.red",
  ): Directory {
    return this.bunBase(source, "homelab/src/ha")
      .withSecretVariable("HASS_TOKEN", hassToken)
      .withEnvVariable("HASS_BASE_URL", hassBaseUrl)
      .withExec(["bun", "run", "generate-types"])
      .directory("/workspace");
  }

  // ---------------------------------------------------------------------------
  // Astro operations
  // ---------------------------------------------------------------------------

  /** Run astro check on a package */
  @func()
  async astroCheck(source: Directory, pkg: string): Promise<string> {
    return this.bunBase(source, pkg)
      .withExec(["bunx", "astro", "check"])
      .stdout();
  }

  /** Run astro build and return the output directory */
  @func()
  astroBuild(source: Directory, pkg: string): Directory {
    return this.bunBase(source, pkg)
      .withExec(["bunx", "astro", "build"])
      .directory(`/workspace/packages/${pkg}/dist`);
  }

  // ---------------------------------------------------------------------------
  // Vite/React operations
  // ---------------------------------------------------------------------------

  /** Run vite build and return the output directory */
  @func()
  viteBuild(source: Directory, pkg: string): Directory {
    return this.bunBase(source, pkg)
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
    source: Directory,
    pkg: string,
    neededPackages: string[] = [],
    version: string = "dev",
    gitSha: string = "unknown",
  ): Container {
    const excludes = ["node_modules", "dist", ".eslintcache"];

    // Build a minimal workspace: root package.json + target + needed packages
    let container = dag
      .container()
      .from(BUN_IMAGE)
      .withMountedCache("/root/.bun/install/cache", dag.cacheVolume(BUN_CACHE))
      .withWorkdir("/workspace")
      .withFile("/workspace/package.json", source.file("package.json"))
      .withDirectory("/workspace/patches", source.directory("patches"))
      .withFile("/workspace/bun.lock", source.file("bun.lock"))
      .withDirectory(
        `/workspace/packages/${pkg}`,
        source.directory(`packages/${pkg}`),
        { exclude: excludes },
      );

    for (const dep of neededPackages) {
      container = container.withDirectory(
        `/workspace/packages/${dep}`,
        source.directory(`packages/${dep}`),
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
  @func()
  async pushImage(
    source: Directory,
    pkg: string,
    tag: string,
    registryUsername: string,
    registryPassword: Secret,
    neededPackages: string[] = [],
    version: string = "dev",
    gitSha: string = "unknown",
  ): Promise<string> {
    const image = this.buildImage(source, pkg, neededPackages, version, gitSha);
    return image
      .withRegistryAuth("ghcr.io", registryUsername, registryPassword)
      .publish(tag);
  }

  // ---------------------------------------------------------------------------
  // Rust operations (clauderon)
  // ---------------------------------------------------------------------------

  /** Run cargo fmt --check */
  @func()
  async rustFmt(source: Directory): Promise<string> {
    return this.rustBase(source)
      .withExec(["rustup", "component", "add", "rustfmt"])
      .withExec(["cargo", "fmt", "--check"])
      .stdout();
  }

  /** Run cargo clippy */
  @func()
  async rustClippy(source: Directory): Promise<string> {
    return this.rustBase(source)
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
  async rustTest(source: Directory): Promise<string> {
    return this.rustBase(source)
      .withExec(["cargo", "test", "--all-features"])
      .stdout();
  }

  /** Build the Rust project */
  @func()
  rustBuild(
    source: Directory,
    target: string = "x86_64-unknown-linux-gnu",
  ): Container {
    return this.rustBase(source)
      .withExec(["rustup", "target", "add", target])
      .withExec(["cargo", "build", "--release", "--target", target]);
  }

  // ---------------------------------------------------------------------------
  // Go operations (terraform-provider-asuswrt)
  // ---------------------------------------------------------------------------

  /** Run go build */
  @func()
  async goBuild(source: Directory): Promise<string> {
    return this.goBase(source).withExec(["go", "build", "./..."]).stdout();
  }

  /** Run go test */
  @func()
  async goTest(source: Directory): Promise<string> {
    return this.goBase(source).withExec(["go", "test", "./...", "-v"]).stdout();
  }

  /** Run golangci-lint (v2) */
  @func()
  async goLint(source: Directory): Promise<string> {
    return this.goBase(source)
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
  homelabSynth(source: Directory): Directory {
    return this.bunBase(source, "homelab/src/cdk8s")
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
      .from("ghcr.io/realm/swiftlint:latest")
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
  async playwrightTest(source: Directory, pkg: string): Promise<string> {
    return (
      dag
        .container()
        .from(PLAYWRIGHT_IMAGE)
        // Install bun on the Playwright image (needs unzip)
        .withExec(["apt-get", "update", "-qq"])
        .withExec([
          "apt-get",
          "install",
          "-y",
          "-qq",
          "--no-install-recommends",
          "unzip",
        ])
        .withExec(["bash", "-c", "curl -fsSL https://bun.sh/install | bash"])
        .withEnvVariable(
          "PATH",
          "/root/.bun/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
        )
        .withEnvVariable("CI", "true")
        .withMountedCache(
          "/root/.bun/install/cache",
          dag.cacheVolume(BUN_CACHE),
        )
        .withWorkdir("/workspace")
        .withDirectory("/workspace", source, {
          exclude: [
            "**/node_modules",
            "**/.eslintcache",
            "**/dist",
            "**/target",
            ".git",
          ],
        })
        .withExec(["bun", "install", "--frozen-lockfile"])
        // Build workspace deps needed by sjer.red
        .withWorkdir("/workspace/packages/eslint-config")
        .withExec(["bun", "run", "build"])
        .withWorkdir("/workspace/packages/astro-opengraph-images")
        .withExec(["bun", "run", "build"])
        .withWorkdir("/workspace/packages/webring")
        .withExec(["bun", "run", "build"])
        .withWorkdir(`/workspace/packages/${pkg}`)
        // Build the site first — playwright tests run against astro preview which needs dist/
        .withExec(["bunx", "astro", "build"])
        .withExec(["bun", "run", "test"])
        .stdout()
    );
  }

  /** Generate/update Playwright snapshot baselines. Returns the snapshots directory. */
  @func()
  playwrightUpdate(source: Directory, pkg: string): Directory {
    return dag
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
      .withExec(["bash", "-c", "curl -fsSL https://bun.sh/install | bash"])
      .withEnvVariable(
        "PATH",
        "/root/.bun/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
      )
      .withEnvVariable("CI", "true")
      .withMountedCache("/root/.bun/install/cache", dag.cacheVolume(BUN_CACHE))
      .withWorkdir("/workspace")
      .withDirectory("/workspace", source, {
        exclude: [
          "**/node_modules",
          "**/.eslintcache",
          "**/dist",
          "**/target",
          ".git",
        ],
      })
      .withExec(["bun", "install", "--frozen-lockfile"])
      .withWorkdir("/workspace/packages/eslint-config")
      .withExec(["bun", "run", "build"])
      .withWorkdir("/workspace/packages/astro-opengraph-images")
      .withExec(["bun", "run", "build"])
      .withWorkdir("/workspace/packages/webring")
      .withExec(["bun", "run", "build"])
      .withWorkdir(`/workspace/packages/${pkg}`)
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
        exclude: ["**/node_modules", "**/dist", "**/target"],
      })
      .withExec(["bun", "install", "--frozen-lockfile"])
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
        exclude: ["**/archive/**", "**/node_modules/**"],
      })
      .withExec([
        "sh",
        "-c",
        "find /workspace -name '*.sh' -print0 | xargs -0 shellcheck",
      ])
      .stdout();
  }

  // ---------------------------------------------------------------------------
  // Full CI validation
  // ---------------------------------------------------------------------------

  /** Run lint/typecheck/test for all TS packages in parallel. Returns results summary. */
  @func()
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
      "cooklang-for-obsidian",
      "cooklang-rich-preview",
      "birmel",
      "starlight-karma-bot",
      "sentinel",
      "tasknotes-server",
      "tasknotes-types",
      "better-skill-capped",
      "hn-enhancer",
      "monarch",
      "discord-plays-pokemon",
      "tasks-for-obsidian",
      "toolkit",
      "status-page/api",
      "status-page/web",
    ];

    const base = this.bunBase(source, "webring"); // any pkg, just to get the base

    const results: string[] = [];

    // Run all TS packages in parallel
    const tsResults = await Promise.allSettled(
      tsPackages.flatMap((pkg) => {
        const container = base.withWorkdir(`/workspace/packages/${pkg}`);
        return [
          container
            .withExec(["bun", "run", "lint"])
            .sync()
            .then(() => `${pkg}: lint=PASS`)
            .catch(
              (e: Error) => `${pkg}: lint=FAIL (${e.message.slice(0, 80)})`,
            ),
          container
            .withExec(["bun", "run", "typecheck"])
            .sync()
            .then(() => `${pkg}: typecheck=PASS`)
            .catch(
              (e: Error) =>
                `${pkg}: typecheck=FAIL (${e.message.slice(0, 80)})`,
            ),
          container
            .withExec(["bun", "run", "test"])
            .sync()
            .then(() => `${pkg}: test=PASS`)
            .catch(
              (e: Error) => `${pkg}: test=FAIL (${e.message.slice(0, 80)})`,
            ),
        ];
      }),
    );

    for (const r of tsResults) {
      results.push(r.status === "fulfilled" ? r.value : `UNKNOWN: ${r.reason}`);
    }

    // Rust checks
    const rustBase = this.rustBase(source);
    const rustResults = await Promise.allSettled([
      rustBase
        .withExec(["rustup", "component", "add", "rustfmt"])
        .withExec(["cargo", "fmt", "--check"])
        .sync()
        .then(() => "clauderon: fmt=PASS")
        .catch((e: Error) => `clauderon: fmt=FAIL (${e.message.slice(0, 80)})`),
      rustBase
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
        .sync()
        .then(() => "clauderon: clippy=PASS")
        .catch(
          (e: Error) => `clauderon: clippy=FAIL (${e.message.slice(0, 80)})`,
        ),
      rustBase
        .withExec(["cargo", "test", "--all-features"])
        .sync()
        .then(() => "clauderon: test=PASS")
        .catch(
          (e: Error) => `clauderon: test=FAIL (${e.message.slice(0, 80)})`,
        ),
    ]);
    for (const r of rustResults) {
      results.push(r.status === "fulfilled" ? r.value : `UNKNOWN: ${r.reason}`);
    }

    // Go checks
    const goB = this.goBase(source);
    const goResults = await Promise.allSettled([
      goB
        .withExec(["go", "build", "./..."])
        .sync()
        .then(() => "go: build=PASS")
        .catch((e: Error) => `go: build=FAIL (${e.message.slice(0, 80)})`),
      goB
        .withExec(["go", "test", "./...", "-v"])
        .sync()
        .then(() => "go: test=PASS")
        .catch((e: Error) => `go: test=FAIL (${e.message.slice(0, 80)})`),
      goB
        .withExec([
          "go",
          "install",
          "github.com/golangci/golangci-lint/v2/cmd/golangci-lint@latest",
        ])
        .withExec(["golangci-lint", "run", "./..."])
        .sync()
        .then(() => "go: lint=PASS")
        .catch((e: Error) => `go: lint=FAIL (${e.message.slice(0, 80)})`),
    ]);
    for (const r of goResults) {
      results.push(r.status === "fulfilled" ? r.value : `UNKNOWN: ${r.reason}`);
    }

    // scout-for-lol: generate then lint/typecheck/test
    const scoutGenerated = this.bunBase(source, "scout-for-lol")
      .withExec(["bun", "run", "generate"])
      .directory("/workspace");
    const scoutContainer = dag
      .container()
      .from(BUN_IMAGE)
      .withDirectory("/workspace", scoutGenerated)
      .withWorkdir("/workspace/packages/scout-for-lol");
    const scoutResults = await Promise.allSettled([
      scoutContainer
        .withExec(["bun", "run", "lint"])
        .sync()
        .then(() => "scout-for-lol: lint=PASS")
        .catch(
          (e: Error) => `scout-for-lol: lint=FAIL (${e.message.slice(0, 80)})`,
        ),
      scoutContainer
        .withExec(["bun", "run", "typecheck"])
        .sync()
        .then(() => "scout-for-lol: typecheck=PASS")
        .catch(
          (e: Error) =>
            `scout-for-lol: typecheck=FAIL (${e.message.slice(0, 80)})`,
        ),
      scoutContainer
        .withExec(["bun", "run", "test"])
        .sync()
        .then(() => "scout-for-lol: test=PASS")
        .catch(
          (e: Error) => `scout-for-lol: test=FAIL (${e.message.slice(0, 80)})`,
        ),
    ]);
    for (const r of scoutResults) {
      results.push(r.status === "fulfilled" ? r.value : `UNKNOWN: ${r.reason}`);
    }

    // homelab/ha: generate types then lint/typecheck (requires HASS_TOKEN)
    if (hassToken != null) {
      const haGenerated = this.bunBase(source, "homelab/src/ha")
        .withSecretVariable("HASS_TOKEN", hassToken)
        .withEnvVariable("HASS_BASE_URL", "https://homeassistant.sjer.red")
        .withExec(["bun", "run", "generate-types"])
        .directory("/workspace");
      const haContainer = dag
        .container()
        .from(BUN_IMAGE)
        .withDirectory("/workspace", haGenerated)
        .withWorkdir("/workspace/packages/homelab/src/ha");
      const haResults = await Promise.allSettled([
        haContainer
          .withExec(["bun", "run", "lint"])
          .sync()
          .then(() => "homelab/ha: lint=PASS")
          .catch(
            (e: Error) => `homelab/ha: lint=FAIL (${e.message.slice(0, 80)})`,
          ),
        haContainer
          .withExec(["bun", "run", "typecheck"])
          .sync()
          .then(() => "homelab/ha: typecheck=PASS")
          .catch(
            (e: Error) =>
              `homelab/ha: typecheck=FAIL (${e.message.slice(0, 80)})`,
          ),
      ]);
      for (const r of haResults) {
        results.push(
          r.status === "fulfilled" ? r.value : `UNKNOWN: ${r.reason}`,
        );
      }
    } else {
      results.push("homelab/ha: SKIPPED (no hassToken)");
    }

    return results.join("\n");
  }
}
