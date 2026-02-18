import type { Directory, Container, Secret } from "@dagger.io/dagger";
import {
  getSystemContainer,
  publishToGhcrMultiple,
} from "./lib/containers/index.ts";

// Default configuration
const DEFAULT_ARCHITECTURES = "aarch64,x86_64";
const DEFAULT_SDK_VERSION = "15.0";
const DEFAULT_KERNEL_VERSION = "24";
const DEFAULT_TARGET_SDK_VERSION = "11.0.0";
const DEFAULT_CORES = 16;

const XAR_COMMIT = "5fa4675419cfec60ac19a9c7f7c2d0e7c831a497";
const LIBDISPATCH_COMMIT = "fdf3fc85a9557635668c78801d79f10161d83f12";
const LIBTAPI_VERSION = "1300.6.5";
const CCTOOLS_VERSION = "1010.6";
const LINKER_VERSION = "951.9";
const OSXCROSS_COMMIT = "29fe6dd35522073c9df5800f8cd1feb4b9a993a8";
const ZIG_VERSION = "0.13.0";

const GHCR_REGISTRY = "ghcr.io/shepherdjerred/macos-cross-compiler";

/**
 * Install base dependencies.
 * Uses getSystemContainer for apt caching optimization.
 */
function installBaseDeps(): Container {
  return getSystemContainer().withExec([
    "apt-get",
    "install",
    "-y",
    "build-essential",
    "cmake",
    "clang",
    "git",
  ]);
}

/**
 * Build xar library
 */
function buildXar(
  container: Container,
  targetSdkVersion: string,
  cores: number,
): Directory {
  const xarContainer = container
    .withExec([
      "apt",
      "install",
      "-y",
      "libxml2-dev",
      "libssl-dev",
      "zlib1g-dev",
      "autoconf",
      "automake",
      "libtool",
    ])
    .withExec([
      "git",
      "clone",
      "https://github.com/tpoechtrager/xar",
      "/tmp/xar-repo",
    ])
    .withWorkdir("/tmp/xar-repo")
    .withExec(["git", "checkout", XAR_COMMIT])
    .withWorkdir("/tmp/xar-repo/xar")
    .withExec(["./autogen.sh", "--noconfigure"])
    .withEnvVariable("MACOSX_DEPLOYMENT_TARGET", targetSdkVersion)
    .withExec(["./configure", "--prefix=/xar"])
    .withExec(["make", "-j" + cores.toString()])
    .withExec(["make", "install"]);

  return xarContainer.directory("/xar");
}

/**
 * Build libdispatch library
 */
function buildLibdispatch(
  container: Container,
  targetSdkVersion: string,
  cores: number,
): Directory {
  const libdispatchContainer = container
    .withExec(["apt", "install", "-y", "clang"])
    .withExec([
      "git",
      "clone",
      "https://github.com/tpoechtrager/apple-libdispatch",
      "/tmp/libdispatch-src",
    ])
    .withWorkdir("/tmp/libdispatch-src")
    .withExec(["git", "checkout", LIBDISPATCH_COMMIT])
    .withEnvVariable("MACOSX_DEPLOYMENT_TARGET", targetSdkVersion)
    .withEnvVariable("TARGETDIR", "/libdispatch")
    .withEnvVariable("CC", "clang")
    .withEnvVariable("CXX", "clang++")
    .withExec(["mkdir", "-p", "build"])
    .withWorkdir("build")
    .withExec([
      "cmake",
      "..",
      "-DCMAKE_BUILD_TYPE=RELEASE",
      "-DCMAKE_INSTALL_PREFIX=/libdispatch",
      "-DCMAKE_C_COMPILER=clang",
      "-DCMAKE_CXX_COMPILER=clang++",
    ])
    .withExec(["make", "install", "-j" + cores.toString()]);

  return libdispatchContainer.directory("/libdispatch");
}

/**
 * Build libtapi library
 */
function buildLibtapi(
  container: Container,
  targetSdkVersion: string,
): Directory {
  const libtapiContainer = container
    .withExec(["apt", "install", "-y", "python3"])
    .withExec([
      "git",
      "clone",
      "--branch",
      LIBTAPI_VERSION,
      "https://github.com/tpoechtrager/apple-libtapi",
      "/tmp/libtapi-src",
    ])
    .withWorkdir("/tmp/libtapi-src")
    .withEnvVariable("MACOSX_DEPLOYMENT_TARGET", targetSdkVersion)
    .withEnvVariable("INSTALLPREFIX", "/libtapi")
    .withExec(["./build.sh"])
    .withExec(["./install.sh"]);

  return libtapiContainer.directory("/libtapi");
}

/**
 * Build cctools for a specific architecture
 */
function buildCctools(
  container: Container,
  architecture: string,
  kernelVersion: string,
  targetSdkVersion: string,
  cores: number,
  xar: Directory,
  libtapi: Directory,
  libdispatch: Directory,
): Directory {
  // autoconf does not recognize aarch64 -- use arm instead
  const triple =
    architecture === "aarch64"
      ? `arm-apple-darwin${kernelVersion}`
      : `${architecture}-apple-darwin${kernelVersion}`;

  const cctoolsContainer = container
    .withExec([
      "apt",
      "install",
      "-y",
      "llvm-dev",
      "uuid-dev",
      "rename",
      "zlib1g-dev",
      "libssl-dev",
    ])
    .withExec([
      "git",
      "clone",
      "--branch",
      `${CCTOOLS_VERSION}-ld64-${LINKER_VERSION}`,
      "https://github.com/tpoechtrager/cctools-port",
      "/tmp/cctools-src",
    ])
    .withWorkdir("/tmp/cctools-src")
    .withDirectory("/xar", xar)
    .withDirectory("/libtapi", libtapi)
    .withDirectory("/libdispatch", libdispatch)
    .withWorkdir("/tmp/cctools-src/cctools")
    .withEnvVariable("MACOSX_DEPLOYMENT_TARGET", targetSdkVersion)
    .withExec([
      "./configure",
      "--prefix=/cctools",
      "--with-libtapi=/libtapi",
      "--with-libxar=/xar",
      "--with-libdispatch=/libdispatch",
      "--with-libblocksruntime=/libdispatch",
      "--target=" + triple,
    ]);

  // Fix aarch64 target naming
  let buildContainer = cctoolsContainer;
  if (architecture === "aarch64") {
    buildContainer = buildContainer.withExec([
      "bash",
      "-c",
      `find . -name Makefile -print0 | xargs -0 sed -i 's/arm-apple-darwin${kernelVersion}/arm64-apple-darwin${kernelVersion}/g'`,
    ]);
  }

  let finalContainer = buildContainer
    .withExec(["make", "-j" + cores.toString()])
    .withExec(["make", "install"]);

  // Link aarch64 artifacts
  if (architecture === "aarch64") {
    finalContainer = finalContainer.withExec([
      "bash",
      "-c",
      "cd /cctools/bin && for file in *arm64*; do ln -s $file ${file/arm64/aarch64}; done",
    ]);
  }

  return finalContainer.directory("/cctools");
}

/**
 * Build wrapper for clang
 */
function buildClangWrappers(
  container: Container,
  sdkVersion: string,
  kernelVersion: string,
  targetSdkVersion: string,
  cores: number,
): Directory {
  const wrapperContainer = container
    .withExec([
      "git",
      "clone",
      "https://github.com/tpoechtrager/osxcross",
      "/tmp/osxcross-src",
    ])
    .withWorkdir("/tmp/osxcross-src")
    .withExec(["git", "checkout", OSXCROSS_COMMIT])
    .withWorkdir("/tmp/osxcross-src/wrapper")
    .withEnvVariable("VERSION", "1.5")
    .withEnvVariable("SDK_VERSION", sdkVersion)
    .withEnvVariable("TARGET", "darwin" + kernelVersion)
    .withEnvVariable("LINKER_VERSION", LINKER_VERSION)
    .withEnvVariable("X86_64H_SUPPORTED", "0")
    .withEnvVariable("I386_SUPPORTED", "0")
    .withEnvVariable("ARM_SUPPORTED", "1")
    .withEnvVariable("MACOSX_DEPLOYMENT_TARGET", targetSdkVersion)
    .withExec(["make", "wrapper", "-j" + cores.toString()]);

  const compilers = ["clang", "clang++"];
  let finalContainer = wrapperContainer.withEnvVariable(
    "TARGET_DIR",
    "/osxcross",
  );

  for (const compiler of compilers) {
    finalContainer = finalContainer
      .withEnvVariable("TARGETCOMPILER", compiler)
      .withExec(["./build_wrapper.sh"]);
  }

  return finalContainer.directory("/osxcross");
}

/**
 * Build wrapper for GCC
 */
function buildGccWrappers(
  container: Container,
  sdkVersion: string,
  kernelVersion: string,
  targetSdkVersion: string,
  cores: number,
): Directory {
  const wrapperContainer = container
    .withExec([
      "git",
      "clone",
      "https://github.com/tpoechtrager/osxcross",
      "/tmp/osxcross-gcc-src",
    ])
    .withWorkdir("/tmp/osxcross-gcc-src")
    .withExec(["git", "checkout", OSXCROSS_COMMIT])
    .withWorkdir("/tmp/osxcross-gcc-src/wrapper")
    .withEnvVariable("VERSION", "1.5")
    .withEnvVariable("SDK_VERSION", sdkVersion)
    .withEnvVariable("TARGET", "darwin" + kernelVersion)
    .withEnvVariable("LINKER_VERSION", LINKER_VERSION)
    .withEnvVariable("X86_64H_SUPPORTED", "0")
    .withEnvVariable("I386_SUPPORTED", "0")
    .withEnvVariable("ARM_SUPPORTED", "1")
    .withEnvVariable("MACOSX_DEPLOYMENT_TARGET", targetSdkVersion)
    .withExec(["make", "wrapper", "-j" + cores.toString()]);

  const compilers = ["gcc", "g++", "gfortran"];
  let finalContainer = wrapperContainer.withEnvVariable(
    "TARGET_DIR",
    "/osxcross",
  );

  for (const compiler of compilers) {
    finalContainer = finalContainer
      .withEnvVariable("TARGETCOMPILER", compiler)
      .withExec(["./build_wrapper.sh"]);
  }

  return finalContainer.directory("/osxcross");
}

/**
 * Get or download macOS SDK
 */
function getSdk(container: Container, version: string): Directory {
  const sdkContainer = container
    .withExec(["apt", "update"])
    .withExec(["apt", "install", "-y", "wget"])
    .withExec([
      "wget",
      `https://github.com/joseluisq/macosx-sdks/releases/download/${version}/MacOSX${version}.sdk.tar.xz`,
    ])
    .withExec(["tar", "-xf", `MacOSX${version}.sdk.tar.xz`])
    .withExec(["bash", "-c", `mv MacOSX*.sdk MacOSX${version}.sdk || true`]);

  return sdkContainer.directory(`MacOSX${version}.sdk`);
}

/**
 * Build Zig compiler
 */
function buildZig(container: Container, targetArch = "x86_64"): Directory {
  let archSuffix: string;
  if (targetArch === "aarch64" || targetArch === "arm64") {
    archSuffix = "aarch64";
  } else if (targetArch === "x86_64" || targetArch === "amd64") {
    archSuffix = "x86_64";
  } else {
    throw new Error(`Unsupported architecture: ${targetArch}`);
  }

  const zigContainer = container
    .withExec(["apt", "install", "-y", "wget", "xz-utils"])
    .withExec([
      "wget",
      "-O",
      "zig.tar.xz",
      `https://ziglang.org/download/${ZIG_VERSION}/zig-linux-${archSuffix}-${ZIG_VERSION}.tar.xz`,
    ])
    .withExec(["tar", "-xf", "zig.tar.xz"])
    .withExec(["rm", "zig.tar.xz"])
    .withExec(["bash", "-c", "mv zig* zig"]);

  return zigContainer.directory("zig");
}

/**
 * Build GCC compiler for cross-compilation
 */
function buildGcc(
  container: Container,
  architecture: string,
  sdkVersion: string,
  kernelVersion: string,
  targetSdkVersion: string,
  cores: number,
  clangWrappers: Directory,
  cctools: Directory,
  sdk: Directory,
  xar: Directory,
  libtapi: Directory,
  libdispatch: Directory,
): Directory {
  const triple = `${architecture}-apple-darwin${kernelVersion}`;

  const gccContainer = container
    .withExec([
      "apt",
      "install",
      "-y",
      "gcc",
      "g++",
      "zlib1g-dev",
      "libmpc-dev",
      "libmpfr-dev",
      "libgmp-dev",
      "flex",
      "file",
    ])
    .withExec([
      "apt-get",
      "install",
      "-y",
      "--force-yes",
      "llvm-dev",
      "libxml2-dev",
      "uuid-dev",
      "libssl-dev",
      "bash",
      "patch",
      "make",
      "tar",
      "xz-utils",
      "bzip2",
      "gzip",
      "sed",
      "cpio",
      "libbz2-dev",
      "zlib1g-dev",
    ])
    .withExec([
      "git",
      "clone",
      "--branch=gcc-14-2-darwin",
      "https://github.com/iains/gcc-14-branch",
      "/tmp/gcc-src",
    ])
    .withDirectory("/osxcross", clangWrappers)
    .withDirectory("/cctools", cctools)
    .withDirectory("/sdk", sdk)
    // Mount each library to a temp location then copy to merge into /sdk/usr
    .withDirectory("/tmp/xar", xar)
    .withDirectory("/tmp/libtapi", libtapi)
    .withDirectory("/tmp/libdispatch", libdispatch)
    .withExec(["bash", "-c", "cp -r /tmp/xar/* /sdk/usr/ || true"])
    .withExec(["bash", "-c", "cp -r /tmp/libtapi/* /sdk/usr/ || true"])
    .withExec(["bash", "-c", "cp -r /tmp/libdispatch/* /sdk/usr/ || true"])
    // Copy libraries to /usr/local/lib for runtime linking
    .withExec(["bash", "-c", "cp -r /tmp/xar/lib/* /usr/local/lib/ || true"])
    .withExec([
      "bash",
      "-c",
      "cp -r /tmp/libtapi/lib/* /usr/local/lib/ || true",
    ])
    .withExec([
      "bash",
      "-c",
      "cp -r /tmp/libdispatch/lib/* /usr/local/lib/ || true",
    ])
    .withExec(["ldconfig"])
    .withExec(["mkdir", "-p", "/osxcross/SDK"])
    .withExec(["ln", "-s", "/sdk", `/osxcross/SDK/MacOSX${sdkVersion}.sdk`])
    .withEnvVariable("PATH", "$PATH:/osxcross/bin:/cctools/bin", {
      expand: true,
    })
    .withEnvVariable("MACOSX_DEPLOYMENT_TARGET", targetSdkVersion)
    .withExec(["mkdir", "-p", "/tmp/gcc-build"])
    .withWorkdir("/tmp/gcc-build")
    .withExec([
      "/tmp/gcc-src/configure",
      "--target=" + triple,
      "--with-sysroot=/sdk",
      "--disable-nls",
      "--enable-languages=c,c++,fortran,objc,obj-c++",
      "--without-headers",
      "--enable-lto",
      "--enable-checking=release",
      "--disable-libstdcxx-pch",
      "--prefix=/gcc",
      "--with-system-zlib",
      "--disable-multilib",
      "--with-ld=/cctools/bin/" + triple + "-ld",
      "--with-as=/cctools/bin/" + triple + "-as",
    ])
    .withExec(["make", "-j" + cores.toString()])
    .withExec(["make", "install"]);

  return gccContainer.directory("/gcc");
}

/**
 * Build the full macOS cross-compiler image.
 *
 * This orchestrates the entire cross-compiler build: base dependencies,
 * library builds (xar, libdispatch, libtapi), SDK setup, Zig, cctools,
 * wrapper scripts, GCC, and Rust targets for each architecture.
 *
 * @param source - The macos-cross-compiler package source directory
 * @param architectures - Comma-separated target architectures (default: "aarch64,x86_64")
 * @param sdkVersion - macOS SDK version (default: "15.0")
 * @param kernelVersion - Darwin kernel version (default: "24")
 * @param targetSdkVersion - Target SDK version for deployment (default: "11.0.0")
 * @param cores - Number of CPU cores for compilation (default: 16)
 * @returns The fully built cross-compiler container
 */
function buildImage(
  source: Directory,
  architectures: string = DEFAULT_ARCHITECTURES,
  sdkVersion: string = DEFAULT_SDK_VERSION,
  kernelVersion: string = DEFAULT_KERNEL_VERSION,
  targetSdkVersion: string = DEFAULT_TARGET_SDK_VERSION,
  cores: number = DEFAULT_CORES,
): Container {
  // Install base dependencies
  let container = installBaseDeps();

  // Build components in dependency order
  const xar = buildXar(container, targetSdkVersion, cores);
  const libdispatch = buildLibdispatch(container, targetSdkVersion, cores);
  const libtapi = buildLibtapi(container, targetSdkVersion);

  // Get or download SDK
  const sdk = getSdk(container, sdkVersion);

  // Build Zig compiler
  const zig = buildZig(container);

  // Set up SDK in container
  container = container
    .withDirectory("/osxcross/SDK/MacOSX" + sdkVersion + ".sdk", sdk)
    .withExec([
      "ln",
      "-s",
      "/osxcross/SDK/MacOSX" + sdkVersion + ".sdk/",
      "/sdk",
    ])
    .withExec(["apt", "update"])
    .withExec([
      "apt",
      "install",
      "-y",
      "clang",
      "file",
      "libmpc-dev",
      "libmpfr-dev",
      "curl",
    ])
    .withExec([
      "bash",
      "-c",
      "curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y",
    ])
    .withEnvVariable(
      "PATH",
      "/root/.cargo/bin:/usr/local/bin:/gcc/bin:/cctools/bin:/osxcross/bin:$PATH",
      { expand: true },
    )
    .withEnvVariable("MACOSX_DEPLOYMENT_TARGET", targetSdkVersion)
    .withDirectory("/usr/local/bin", zig);

  // Build for each architecture
  const archList = architectures.split(",").map((arch) => arch.trim());

  for (const architecture of archList) {
    // Build cctools for this architecture
    const cctools = buildCctools(
      container,
      architecture,
      kernelVersion,
      targetSdkVersion,
      cores,
      xar,
      libtapi,
      libdispatch,
    );

    // Build wrappers
    const clangWrappers = buildClangWrappers(
      container,
      sdkVersion,
      kernelVersion,
      targetSdkVersion,
      cores,
    );

    const gccWrappers = buildGccWrappers(
      container,
      sdkVersion,
      kernelVersion,
      targetSdkVersion,
      cores,
    );

    // Build GCC for this architecture
    const gcc = buildGcc(
      container,
      architecture,
      sdkVersion,
      kernelVersion,
      targetSdkVersion,
      cores,
      clangWrappers,
      cctools,
      sdk,
      xar,
      libtapi,
      libdispatch,
    );

    // Add binaries to final container
    container = container
      .withDirectory("/cctools", cctools)
      .withDirectory("/osxcross", clangWrappers)
      .withDirectory("/osxcross", gccWrappers)
      .withDirectory("/gcc", gcc)
      .withFile(
        "/usr/local/bin/zig-cc-" + architecture + "-macos",
        source.file("zig/zig-cc-" + architecture + "-macos"),
      )
      .withExec([
        "chmod",
        "+x",
        "/usr/local/bin/zig-cc-" + architecture + "-macos",
      ]);

    // Install Rust targets
    container = container.withExec([
      "rustup",
      "target",
      "add",
      architecture + "-apple-darwin",
    ]);
  }

  // Final library setup - use cp to merge directories instead of withDirectory which replaces
  container = container
    .withDirectory("/tmp/xar-lib", xar.directory("lib"))
    .withDirectory("/tmp/libtapi-lib", libtapi.directory("lib"))
    .withDirectory("/tmp/libdispatch-lib", libdispatch.directory("lib"))
    .withExec(["bash", "-c", "cp -r /tmp/xar-lib/* /usr/local/lib/ || true"])
    .withExec([
      "bash",
      "-c",
      "cp -r /tmp/libtapi-lib/* /usr/local/lib/ || true",
    ])
    .withExec([
      "bash",
      "-c",
      "cp -r /tmp/libdispatch-lib/* /usr/local/lib/ || true",
    ])
    .withExec(["ldconfig"])
    .withWorkdir("/workspace");

  return container;
}

/**
 * Test the cross-compiler by building sample programs for each architecture.
 *
 * @param source - The macos-cross-compiler package source directory
 * @param image - The built cross-compiler container
 * @param architectures - Comma-separated target architectures
 * @param kernelVersion - Darwin kernel version
 * @returns Success message
 */
async function testImage(
  source: Directory,
  image: Container,
  architectures: string = DEFAULT_ARCHITECTURES,
  kernelVersion: string = DEFAULT_KERNEL_VERSION,
): Promise<string> {
  const testContainer = image
    .withDirectory("samples", source.directory("samples"))
    .withExec(["mkdir", "-p", "out"]);

  const archList = architectures.split(",").map((arch) => arch.trim());

  for (const architecture of archList) {
    const triple = `${architecture}-apple-darwin${kernelVersion}`;

    const archContainer = testContainer
      .withEnvVariable("triple", triple)
      .withExec([
        triple + "-clang",
        "--target=" + triple,
        "samples/hello.c",
        "-o",
        "out/hello-clang",
      ])
      .withExec([
        triple + "-clang++",
        "--target=" + triple,
        "samples/hello.cpp",
        "-o",
        "out/hello-clang++",
      ])
      .withExec([triple + "-gcc", "samples/hello.c", "-o", "out/hello-gcc"])
      .withExec([triple + "-g++", "samples/hello.cpp", "-o", "out/hello-g++"])
      .withExec([
        triple + "-gfortran",
        "samples/hello.f90",
        "-o",
        "out/hello-gfortran",
      ])
      .withExec([
        "zig",
        "cc",
        "-target",
        `${architecture}-macos`,
        "--sysroot=/sdk",
        "-I/sdk/usr/include",
        "-L/sdk/usr/lib",
        "-F/sdk/System/Library/Frameworks",
        "-framework",
        "CoreFoundation",
        "-o",
        "out/hello-zig-c",
        "samples/hello.c",
      ])
      .withEnvVariable("CC", `zig-cc-${architecture}-macos`)
      .withWorkdir("samples/rust")
      .withExec(["cargo", "build", "--target", `${architecture}-apple-darwin`])
      .withExec([
        "mv",
        `target/${architecture}-apple-darwin/debug/hello`,
        "../../out/hello-rust",
      ])
      .withWorkdir("/workspace");

    // Verify architecture of produced binaries
    const archPattern =
      architecture === "aarch64"
        ? "Mach-O 64-bit arm64 executable"
        : `Mach-O 64-bit ${architecture} executable`;

    await archContainer
      .withExec(["file", "out/hello-clang"])
      .withExec([
        "bash",
        "-c",
        `file out/hello-clang | grep -q "${archPattern}"`,
      ])
      .withExec([
        "bash",
        "-c",
        `file out/hello-clang++ | grep -q "${archPattern}"`,
      ])
      .withExec(["bash", "-c", `file out/hello-gcc | grep -q "${archPattern}"`])
      .withExec(["bash", "-c", `file out/hello-g++ | grep -q "${archPattern}"`])
      .withExec([
        "bash",
        "-c",
        `file out/hello-gfortran | grep -q "${archPattern}"`,
      ])
      .withExec([
        "bash",
        "-c",
        `file out/hello-zig-c | grep -q "${archPattern}"`,
      ])
      .withExec([
        "bash",
        "-c",
        `file out/hello-rust | grep -q "${archPattern}"`,
      ])
      .sync();
  }

  return "Cross-compiler tests passed for all architectures";
}

/**
 * Build and test the macOS cross-compiler image.
 *
 * This is the check function meant to be called from the monorepo CI.
 * Note: This build takes a VERY long time due to compiling GCC, LLVM components,
 * and other toolchain elements from source. It is meant to be NON-BLOCKING in CI.
 *
 * Extracts the `packages/macos-cross-compiler` subdirectory from the monorepo source,
 * builds the full cross-compiler image, and runs compilation tests.
 *
 * @param source - The full monorepo source directory
 * @returns A message indicating completion
 */
export async function checkMacosCrossCompiler(
  source: Directory,
): Promise<string> {
  const crossCompilerSource = source.directory("packages/macos-cross-compiler");

  const image = buildImage(crossCompilerSource);
  await testImage(crossCompilerSource, image);

  return "macOS cross-compiler check passed: image built and tests verified successfully.";
}

/**
 * Build and publish the macOS cross-compiler image to GHCR.
 *
 * Extracts the `packages/macos-cross-compiler` subdirectory from the monorepo source,
 * builds the full cross-compiler image, and publishes it to GitHub Container Registry
 * with both a version tag and a "latest" tag.
 *
 * @param source - The full monorepo source directory
 * @param sdkVersion - macOS SDK version used for tagging (default: "15.0")
 * @param ghcrUsername - GitHub Container Registry username
 * @param ghcrPassword - GitHub Container Registry password/token
 * @returns A message indicating completion with published image references
 */
export async function deployMacosCrossCompiler(
  source: Directory,
  sdkVersion: string = DEFAULT_SDK_VERSION,
  ghcrUsername: string,
  ghcrPassword: Secret,
): Promise<string> {
  const crossCompilerSource = source.directory("packages/macos-cross-compiler");

  const image = buildImage(crossCompilerSource);

  // Push with both latest and version tags in parallel
  const refs = await publishToGhcrMultiple({
    container: image,
    imageRefs: [`${GHCR_REGISTRY}:latest`, `${GHCR_REGISTRY}:${sdkVersion}`],
    username: ghcrUsername,
    password: ghcrPassword,
  });

  return `macOS cross-compiler image published to ${refs.join(" and ")}`;
}
