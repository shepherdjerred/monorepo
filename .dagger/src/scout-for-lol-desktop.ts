import type { Directory, Container, Secret, File } from "@dagger.io/dagger";
import { dag } from "@dagger.io/dagger";
import { getGitHubContainer } from "./lib-github.ts";
import { logWithTimestamp } from "./lib-timing.ts";
import versions from "./lib-versions.ts";

const BUN_VERSION = versions.bun;

// ============================================================
// Desktop helpers
// ============================================================

type DesktopTarget = "linux" | "windows-gnu";

function getRustTauriContainer(): Container {
  return dag
    .container()
    .from("rust:latest")
    .withWorkdir("/workspace")
    .withMountedCache("/var/cache/apt", dag.cacheVolume("apt-cache-rust"))
    .withMountedCache("/var/lib/apt/lists", dag.cacheVolume("apt-lists-rust"))
    .withExec(["apt", "update"])
    .withExec([
      "apt",
      "install",
      "-y",
      "libwebkit2gtk-4.1-dev",
      "libgtk-3-dev",
      "libayatana-appindicator3-dev",
      "librsvg2-dev",
      "patchelf",
      "cmake",
      "pkg-config",
      "curl",
      "ca-certificates",
      "gnupg",
      "clang",
      "mold",
      "libasound2-dev",
    ])
    .withExec([
      "sh",
      "-c",
      "curl -L https://github.com/mozilla/sccache/releases/download/v0.8.1/sccache-v0.8.1-x86_64-unknown-linux-musl.tar.gz | tar xz && mv sccache-v0.8.1-x86_64-unknown-linux-musl/sccache /usr/local/bin/ && rm -rf sccache-v0.8.1-x86_64-unknown-linux-musl",
    ])
    .withExec(["cargo", "install", "cargo-chef", "--locked"])
    .withMountedCache("/root/.cache/sccache", dag.cacheVolume("sccache"))
    .withEnvVariable("RUSTC_WRAPPER", "sccache")
    .withEnvVariable("SCCACHE_DIR", "/root/.cache/sccache")
    .withMountedCache(
      "/usr/local/cargo/registry",
      dag.cacheVolume("cargo-registry"),
    )
    .withMountedCache("/usr/local/cargo/git", dag.cacheVolume("cargo-git"))
    .withEnvVariable("CARGO_INCREMENTAL", "0")
    .withEnvVariable("CARGO_BUILD_JOBS", "4")
    .withEnvVariable("CARGO_NET_GIT_FETCH_WITH_CLI", "false")
    .withEnvVariable("CARGO_REGISTRIES_CRATES_IO_PROTOCOL", "sparse")
    .withEnvVariable("CARGO_TARGET_X86_64_UNKNOWN_LINUX_GNU_LINKER", "clang")
    .withEnvVariable("RUSTFLAGS", "-C link-arg=-fuse-ld=mold")
    .withExec(["cargo", "install", "tauri-cli", "--locked"]);
}

function installBunInRustContainer(container: Container): Container {
  return container
    .withExec([
      "sh",
      "-c",
      `curl -fsSL https://bun.sh/install | bash -s "bun-v${BUN_VERSION}"`,
    ])
    .withEnvVariable("PATH", "/root/.bun/bin:$PATH", { expand: true });
}

/**
 * Add desktop dependency files and install them (PHASE 1).
 */
function addDesktopDepFiles(
  container: Container,
  workspaceSource: Directory,
): Container {
  return container
    .withWorkdir("/workspace")
    .withFile("/workspace/package.json", workspaceSource.file("package.json"))
    .withFile("/workspace/bun.lock", workspaceSource.file("bun.lock"))
    .withDirectory(
      "/workspace/packages/scout-for-lol/patches",
      workspaceSource.directory("patches"),
    )
    .withFile(
      "/workspace/packages/backend/package.json",
      workspaceSource.file("packages/backend/package.json"),
    )
    .withFile(
      "/workspace/packages/data/package.json",
      workspaceSource.file("packages/data/package.json"),
    )
    .withFile(
      "/workspace/packages/report/package.json",
      workspaceSource.file("packages/report/package.json"),
    )
    .withFile(
      "/workspace/packages/frontend/package.json",
      workspaceSource.file("packages/frontend/package.json"),
    )
    .withFile(
      "/workspace/packages/desktop/package.json",
      workspaceSource.file("packages/desktop/package.json"),
    )
    .withFile(
      "/workspace/packages/ui/package.json",
      workspaceSource.file("packages/ui/package.json"),
    )
    .withExec(["bun", "install", "--frozen-lockfile"]);
}

/**
 * Add desktop source files (PHASE 2).
 */
function addDesktopSourceFiles(
  container: Container,
  workspaceSource: Directory,
): Container {
  return container
    .withFile("/workspace/tsconfig.json", workspaceSource.file("tsconfig.json"))
    .withFile(
      "/workspace/tsconfig.base.json",
      workspaceSource.file("tsconfig.base.json"),
    )
    .withFile(
      "/workspace/eslint.config.ts",
      workspaceSource.file("eslint.config.ts"),
    )
    .withFile("/workspace/.jscpd.json", workspaceSource.file(".jscpd.json"))
    .withDirectory("/workspace/scripts", workspaceSource.directory("scripts"))
    .withDirectory(
      "/workspace/packages/backend",
      workspaceSource.directory("packages/backend"),
    )
    .withDirectory(
      "/workspace/packages/data",
      workspaceSource.directory("packages/data"),
    )
    .withDirectory(
      "/workspace/packages/report",
      workspaceSource.directory("packages/report"),
    )
    .withDirectory(
      "/workspace/packages/frontend",
      workspaceSource.directory("packages/frontend"),
    )
    .withDirectory(
      "/workspace/packages/desktop",
      workspaceSource.directory("packages/desktop"),
    )
    .withDirectory(
      "/workspace/packages/ui",
      workspaceSource.directory("packages/ui"),
    );
}

export function installDesktopDeps(
  workspaceSource: Directory,
  target: DesktopTarget = "linux",
): Container {
  let container = getRustTauriContainer();
  container = installBunInRustContainer(container);
  container = container.withMountedCache(
    "/root/.bun/install/cache",
    dag.cacheVolume("bun-cache"),
  );

  if (target === "windows-gnu") {
    container = container
      .withExec(["apt", "install", "-y", "mingw-w64", "nsis", "zip"])
      .withExec(["rustup", "target", "add", "x86_64-pc-windows-gnu"])
      .withExec([
        "rustup",
        "target",
        "add",
        "x86_64-pc-windows-gnu",
        "--toolchain",
        "stable",
      ]);
  }

  // PHASE 1: Dependency files only
  container = addDesktopDepFiles(container, workspaceSource);

  // PHASE 2: Config files and source code
  return addDesktopSourceFiles(container, workspaceSource);
}

export function buildDesktopFrontend(workspaceSource: Directory): Directory {
  return installDesktopDeps(workspaceSource)
    .withWorkdir("/workspace/packages/desktop")
    .withExec(["bunx", "vite", "build"])
    .directory("/workspace/packages/desktop/dist");
}

export async function checkDesktopParallel(
  workspaceSource: Directory,
  frontendDist?: Directory,
  eslintConfigSource?: Directory,
  tsconfigBase?: File,
): Promise<void> {
  let baseContainer = installDesktopDeps(workspaceSource);

  // Mount pre-built eslint-config for lint (dist/ already populated)
  if (eslintConfigSource) {
    baseContainer = baseContainer.withDirectory(
      "/eslint-config",
      eslintConfigSource,
    );
    if (tsconfigBase) {
      baseContainer = baseContainer.withFile(
        "/tsconfig.base.json",
        tsconfigBase,
      );
    }
    baseContainer = baseContainer
      // Fix jiti/CJS resolver: rewrite relative import that traverses to filesystem root
      .withExec([
        "sed",
        "-i",
        `s|"../eslint-config/local.ts"|"/eslint-config/local.ts"|`,
        "/workspace/eslint.config.ts",
      ]);
  }

  const frontend = frontendDist ?? buildDesktopFrontend(workspaceSource);

  const containerWithFrontend = baseContainer
    .withDirectory("/workspace/packages/desktop/dist", frontend)
    .withMountedCache(
      "/workspace/packages/desktop/src-tauri/target",
      dag.cacheVolume("rust-target-linux"),
    );

  await Promise.all([
    // TypeScript checks (don't need Rust)
    baseContainer
      .withWorkdir("/workspace/packages/desktop")
      .withExec(["bun", "run", "typecheck"])
      .withExec(["bun", "run", "lint"])
      .sync(),
    // Rust checks (need frontend built for Tauri)
    containerWithFrontend
      .withWorkdir("/workspace/packages/desktop/src-tauri")
      .withExec(["cargo", "fmt", "--", "--check"])
      .withExec([
        "cargo",
        "clippy",
        "--all-targets",
        "--all-features",
        "--",
        "-D",
        "warnings",
      ])
      .withExec(["cargo", "test", "--verbose"])
      .sync(),
  ]);
}

export function buildDesktopWindowsGnu(
  workspaceSource: Directory,
  version: string,
  frontendDist?: Directory,
): Container {
  let container = installDesktopDeps(workspaceSource, "windows-gnu")
    .withEnvVariable("VERSION", version)
    .withEnvVariable(
      "CARGO_TARGET_DIR",
      "/workspace/packages/desktop/src-tauri/target",
    )
    .withEnvVariable("RUSTUP_HOME", "/usr/local/rustup")
    .withEnvVariable("CARGO_HOME", "/usr/local/cargo")
    .withEnvVariable(
      "PATH",
      "/usr/local/cargo/bin:/usr/local/rustup/bin:$PATH",
      { expand: true },
    )
    .withMountedCache(
      "/root/.cache/sccache",
      dag.cacheVolume("sccache-windows"),
    )
    .withEnvVariable("RUSTC_WRAPPER", "sccache")
    .withEnvVariable("SCCACHE_DIR", "/root/.cache/sccache")
    .withMountedCache(
      "/workspace/packages/desktop/src-tauri/target",
      dag.cacheVolume("cargo-target-windows-gnu"),
    )
    .withWorkdir("/workspace/packages/desktop");

  container = frontendDist
    ? container.withDirectory("/workspace/packages/desktop/dist", frontendDist)
    : container.withExec(["bunx", "vite", "build"]);

  return container
    .withWorkdir("/workspace/packages/desktop/src-tauri")
    .withExec([
      "cargo",
      "build",
      "--release",
      "--target",
      "x86_64-pc-windows-gnu",
    ])
    .withExec([
      "sh",
      "-c",
      "mkdir -p /artifacts && cp target/x86_64-pc-windows-gnu/release/scout-for-lol-desktop.exe /artifacts/",
    ]);
}

// ============================================================
// GitHub release helpers
// ============================================================

export type PublishDesktopArtifactsOptions = {
  windowsContainer: Container;
  version: string;
  gitSha: string;
  ghToken: Secret;
  repo?: string;
};

export async function publishDesktopArtifactsWindowsOnly(
  options: PublishDesktopArtifactsOptions,
): Promise<string> {
  const {
    windowsContainer,
    version,
    gitSha,
    ghToken,
    repo = "shepherdjerred/scout-for-lol",
  } = options;
  logWithTimestamp(
    `Publishing Windows desktop artifacts to GitHub Releases for version ${version}`,
  );

  const windowsArtifactsDir = windowsContainer.directory("/artifacts");

  const container = getGitHubContainer()
    .withSecretVariable("GH_TOKEN", ghToken)
    .withWorkdir("/artifacts")
    .withDirectory("/artifacts/windows", windowsArtifactsDir)
    .withExec([
      "sh",
      "-c",
      "echo 'Windows artifacts:' && find windows -type f",
    ]);

  // Verify GitHub authentication
  const authCheckContainer = container.withExec([
    "sh",
    "-c",
    'gh auth status 2>&1; echo "AUTH_EXIT_CODE=$?"',
  ]);
  const authOutput = await authCheckContainer.stdout();
  if (!authOutput.includes("AUTH_EXIT_CODE=0")) {
    throw new Error(`GitHub authentication failed: ${authOutput}`);
  }

  // Create or find release
  const releaseContainer = await ensureRelease(
    container,
    version,
    gitSha,
    repo,
  );

  // Upload Windows artifacts
  const uploadContainer = releaseContainer.withExec([
    "sh",
    "-c",
    String.raw`find windows -type f \( -name "*.exe" -o -name "*.msi" \) -exec gh release upload "v${version}" {} --repo="${repo}" --clobber \; 2>&1 || (echo 'Windows upload failed' && exit 1)`,
  ]);
  await uploadContainer.sync();

  return `Windows desktop artifacts published to GitHub Releases: v${version}`;
}

/**
 * Ensure a GitHub release exists, creating it if necessary.
 */
async function ensureRelease(
  container: Container,
  version: string,
  gitSha: string,
  repo: string,
): Promise<Container> {
  const checkReleaseContainer = container.withExec([
    "sh",
    "-c",
    `if gh release view "v${version}" --repo="${repo}" > /dev/null 2>&1; then echo "RELEASE_EXISTS"; else echo "RELEASE_NOT_FOUND"; fi`,
  ]);
  const checkOutput = await checkReleaseContainer.stdout();
  const releaseExists = checkOutput.includes("RELEASE_EXISTS");

  if (!releaseExists) {
    const createContainer = checkReleaseContainer.withExec([
      "gh",
      "release",
      "create",
      `v${version}`,
      `--repo=${repo}`,
      `--title=v${version}`,
      `--notes=Release ${version} (${gitSha.slice(0, 7)})`,
      "--latest",
    ]);
    await createContainer.sync();
    return createContainer;
  }

  return checkReleaseContainer;
}
