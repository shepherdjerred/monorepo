import type { Directory, Container } from "@dagger.io/dagger";
import { dag } from "@dagger.io/dagger";
import versions from "./lib-versions.ts";

const BUN_VERSION = versions.bun;

export function getBunContainer(): Container {
  return dag
    .container()
    .from(`oven/bun:${BUN_VERSION}`)
    .withWorkdir("/workspace");
}

/**
 * Install workspace dependencies with optimal caching.
 */
export function installWorkspaceDeps(
  workspaceSource: Directory,
  installOpenssl = false,
): Container {
  let container = getBunContainer();

  if (installOpenssl) {
    container = container
      .withMountedCache("/var/cache/apt", dag.cacheVolume("apt-cache"))
      .withMountedCache("/var/lib/apt/lists", dag.cacheVolume("apt-lists"))
      .withExec(["apt", "update"])
      .withExec(["apt", "install", "-y", "openssl"]);
  }

  container = container.withMountedCache(
    "/root/.bun/install/cache",
    dag.cacheVolume("bun-install-cache"),
  );
  container = container.withMountedCache(
    "/workspace/.eslintcache",
    dag.cacheVolume("eslint-cache"),
  );
  container = container.withMountedCache(
    "/workspace/.tsbuildinfo",
    dag.cacheVolume("tsbuildinfo-cache"),
  );

  // PHASE 1: Dependency files only (for bun install caching)
  container = container
    .withWorkdir("/workspace")
    .withFile("/workspace/package.json", workspaceSource.file("package.json"))
    .withFile("/workspace/bun.lock", workspaceSource.file("bun.lock"))
    .withDirectory("/workspace/packages/scout-for-lol/patches", workspaceSource.directory("patches"))
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

  // PHASE 2: Config files and source code
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
    .withDirectory("/workspace/types", workspaceSource.directory("types"))
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

/**
 * Generate Prisma client once and return the generated directory.
 */
export function generatePrismaClient(workspaceSource: Directory): Directory {
  return installWorkspaceDeps(workspaceSource, true)
    .withWorkdir("/workspace/packages/backend")
    .withExec(["bun", "run", "generate"])
    .directory("/workspace/packages/backend/generated");
}

/**
 * Get a fully prepared workspace container with deps installed and Prisma generated.
 */
export function getPreparedWorkspace(
  workspaceSource: Directory,
  prismaGenerated?: Directory,
): Container {
  const base = installWorkspaceDeps(workspaceSource, true);
  if (prismaGenerated) {
    return base.withDirectory(
      "/workspace/packages/backend/generated",
      prismaGenerated,
    );
  }
  return base
    .withWorkdir("/workspace/packages/backend")
    .withExec(["bun", "run", "generate"])
    .withWorkdir("/workspace");
}

/**
 * Get a mounted workspace -- faster for read-only CI checks.
 */
export function getMountedWorkspace(
  workspaceSource: Directory,
  installOpenssl = false,
): Container {
  let container = getBunContainer();

  if (installOpenssl) {
    container = container
      .withMountedCache("/var/cache/apt", dag.cacheVolume("apt-cache"))
      .withMountedCache("/var/lib/apt/lists", dag.cacheVolume("apt-lists"))
      .withExec(["apt", "update"])
      .withExec(["apt", "install", "-y", "openssl"]);
  }

  container = container.withMountedCache(
    "/root/.bun/install/cache",
    dag.cacheVolume("bun-install-cache"),
  );
  container = container.withMountedCache(
    "/workspace/.eslintcache",
    dag.cacheVolume("eslint-cache"),
  );
  container = container.withMountedCache(
    "/workspace/.tsbuildinfo",
    dag.cacheVolume("tsbuildinfo-cache"),
  );

  container = container
    .withWorkdir("/workspace")
    .withMountedFile(
      "/workspace/package.json",
      workspaceSource.file("package.json"),
    )
    .withMountedFile("/workspace/bun.lock", workspaceSource.file("bun.lock"))
    .withMountedDirectory(
      "/workspace/packages/scout-for-lol/patches",
      workspaceSource.directory("patches"),
    )
    .withMountedFile(
      "/workspace/packages/backend/package.json",
      workspaceSource.file("packages/backend/package.json"),
    )
    .withMountedFile(
      "/workspace/packages/data/package.json",
      workspaceSource.file("packages/data/package.json"),
    )
    .withMountedFile(
      "/workspace/packages/report/package.json",
      workspaceSource.file("packages/report/package.json"),
    )
    .withMountedFile(
      "/workspace/packages/frontend/package.json",
      workspaceSource.file("packages/frontend/package.json"),
    )
    .withMountedFile(
      "/workspace/packages/desktop/package.json",
      workspaceSource.file("packages/desktop/package.json"),
    )
    .withMountedFile(
      "/workspace/packages/ui/package.json",
      workspaceSource.file("packages/ui/package.json"),
    )
    .withExec(["bun", "install", "--frozen-lockfile"]);

  return container
    .withMountedFile(
      "/workspace/tsconfig.json",
      workspaceSource.file("tsconfig.json"),
    )
    .withMountedFile(
      "/workspace/tsconfig.base.json",
      workspaceSource.file("tsconfig.base.json"),
    )
    .withMountedFile(
      "/workspace/eslint.config.ts",
      workspaceSource.file("eslint.config.ts"),
    )
    .withMountedFile(
      "/workspace/.jscpd.json",
      workspaceSource.file(".jscpd.json"),
    )
    .withMountedDirectory(
      "/workspace/types",
      workspaceSource.directory("types"),
    )
    .withMountedDirectory(
      "/workspace/scripts",
      workspaceSource.directory("scripts"),
    )
    .withMountedDirectory(
      "/workspace/packages/backend",
      workspaceSource.directory("packages/backend"),
    )
    .withMountedDirectory(
      "/workspace/packages/data",
      workspaceSource.directory("packages/data"),
    )
    .withMountedDirectory(
      "/workspace/packages/report",
      workspaceSource.directory("packages/report"),
    )
    .withMountedDirectory(
      "/workspace/packages/frontend",
      workspaceSource.directory("packages/frontend"),
    )
    .withMountedDirectory(
      "/workspace/packages/desktop",
      workspaceSource.directory("packages/desktop"),
    )
    .withMountedDirectory(
      "/workspace/packages/ui",
      workspaceSource.directory("packages/ui"),
    );
}

/**
 * Get a prepared mounted workspace with Prisma generated.
 */
export function getPreparedMountedWorkspace(
  workspaceSource: Directory,
  prismaGenerated?: Directory,
): Container {
  const base = getMountedWorkspace(workspaceSource, true);
  if (prismaGenerated) {
    return base.withMountedDirectory(
      "/workspace/packages/backend/generated",
      prismaGenerated,
    );
  }
  return base
    .withWorkdir("/workspace/packages/backend")
    .withExec(["bun", "run", "generate"])
    .withWorkdir("/workspace");
}

// ============================================================
// Desktop workspace helpers
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
    .withExec(["sh", "-c", `curl -fsSL https://bun.sh/install | bash -s "bun-v${BUN_VERSION}"`])
    .withEnvVariable("PATH", "/root/.bun/bin:$PATH", { expand: true });
}

/**
 * Install desktop dependencies for Tauri builds.
 */
export function installDesktopDeps(
  workspaceSource: Directory,
  target: DesktopTarget = "linux",
): Container {
  let container = getRustTauriContainer();
  container = installBunInRustContainer(container);
  container = container.withMountedCache(
    "/root/.bun/install/cache",
    dag.cacheVolume("bun-install-cache"),
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

  container = container
    .withWorkdir("/workspace")
    .withFile("/workspace/package.json", workspaceSource.file("package.json"))
    .withFile("/workspace/bun.lock", workspaceSource.file("bun.lock"))
    .withDirectory("/workspace/packages/scout-for-lol/patches", workspaceSource.directory("patches"))
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

/**
 * Build the desktop frontend.
 */
export function buildDesktopFrontend(workspaceSource: Directory): Directory {
  return installDesktopDeps(workspaceSource)
    .withWorkdir("/workspace/packages/desktop")
    .withExec(["bunx", "vite", "build"])
    .directory("/workspace/packages/desktop/dist");
}
