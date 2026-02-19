import type { Directory, Container, Secret } from "@dagger.io/dagger";
import { publishToGhcrMultiple } from "./lib-ghcr.ts";
import {
  DEFAULT_ARCHITECTURES,
  DEFAULT_SDK_VERSION,
  DEFAULT_KERNEL_VERSION,
  DEFAULT_TARGET_SDK_VERSION,
  DEFAULT_CORES,
  installBaseDeps,
  buildXar,
  buildLibdispatch,
  buildLibtapi,
  buildCctools,
  buildClangWrappers,
  buildGccWrappers,
  getSdk,
  buildZig,
  buildGcc,
} from "./macos-cross-compiler-helpers.ts";

const GHCR_REGISTRY = "ghcr.io/shepherdjerred/macos-cross-compiler";

/**
 * Options for building the cross-compiler image
 */
type BuildImageOptions = {
  source: Directory;
  architectures?: string;
  sdkVersion?: string;
  kernelVersion?: string;
  targetSdkVersion?: string;
  cores?: number;
};

/**
 * Build the full macOS cross-compiler image.
 *
 * This orchestrates the entire cross-compiler build: base dependencies,
 * library builds (xar, libdispatch, libtapi), SDK setup, Zig, cctools,
 * wrapper scripts, GCC, and Rust targets for each architecture.
 */
function buildImage(options: BuildImageOptions): Container {
  const {
    source,
    architectures = DEFAULT_ARCHITECTURES,
    sdkVersion = DEFAULT_SDK_VERSION,
    kernelVersion = DEFAULT_KERNEL_VERSION,
    targetSdkVersion = DEFAULT_TARGET_SDK_VERSION,
    cores = DEFAULT_CORES,
  } = options;

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
  container = setupSdkInContainer({ container, sdkVersion, targetSdkVersion, zig, sdk });

  // Build for each architecture
  const archList = architectures.split(",").map((arch) => arch.trim());
  const wrapperOptions = { container, sdkVersion, kernelVersion, targetSdkVersion, cores };

  for (const architecture of archList) {
    container = buildForArchitecture({
      container,
      source,
      architecture,
      sdkVersion,
      kernelVersion,
      targetSdkVersion,
      cores,
      xar,
      libtapi,
      libdispatch,
      wrapperOptions,
    });
  }

  // Final library setup
  container = finalizeLibraries(container, xar, libtapi, libdispatch);

  return container;
}

/**
 * Options for setting up the macOS SDK in a container
 */
type SetupSdkOptions = {
  container: Container;
  sdkVersion: string;
  targetSdkVersion: string;
  zig: Directory;
  sdk: Directory;
};

/**
 * Set up the macOS SDK and Rust/Zig in the container.
 */
function setupSdkInContainer(options: SetupSdkOptions): Container {
  const { container, sdkVersion, targetSdkVersion, zig, sdk } = options;
  return container
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
}

/**
 * Options for building a single architecture
 */
type BuildForArchitectureOptions = {
  container: Container;
  source: Directory;
  architecture: string;
  sdkVersion: string;
  kernelVersion: string;
  targetSdkVersion: string;
  cores: number;
  xar: Directory;
  libtapi: Directory;
  libdispatch: Directory;
  wrapperOptions: { container: Container; sdkVersion: string; kernelVersion: string; targetSdkVersion: string; cores: number };
};

/**
 * Build toolchain for a single architecture and add to container.
 */
function buildForArchitecture(options: BuildForArchitectureOptions): Container {
  const { container, source, architecture, kernelVersion, targetSdkVersion, cores, xar, libtapi, libdispatch, wrapperOptions } = options;

  const cctools = buildCctools({
    container,
    architecture,
    kernelVersion,
    targetSdkVersion,
    cores,
    xar,
    libtapi,
    libdispatch,
  });

  const clangWrappers = buildClangWrappers(wrapperOptions);
  const gccWrappers = buildGccWrappers(wrapperOptions);

  const gcc = buildGcc({
    container,
    architecture,
    sdkVersion: wrapperOptions.sdkVersion,
    kernelVersion,
    targetSdkVersion,
    cores,
    clangWrappers,
    cctools,
    sdk: container.directory("/osxcross/SDK/MacOSX" + wrapperOptions.sdkVersion + ".sdk"),
    xar,
    libtapi,
    libdispatch,
  });

  return container
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
    ])
    .withExec([
      "rustup",
      "target",
      "add",
      architecture + "-apple-darwin",
    ]);
}

/**
 * Finalize library setup by copying libraries to /usr/local/lib.
 */
function finalizeLibraries(
  container: Container,
  xar: Directory,
  libtapi: Directory,
  libdispatch: Directory,
): Container {
  return container
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
}

/**
 * Options for testing the cross-compiler image
 */
type TestImageOptions = {
  source: Directory;
  image: Container;
  architectures?: string;
  kernelVersion?: string;
};

/**
 * Test the cross-compiler by building sample programs for each architecture.
 */
async function testImage(options: TestImageOptions): Promise<string> {
  const {
    source,
    image,
    architectures = DEFAULT_ARCHITECTURES,
    kernelVersion = DEFAULT_KERNEL_VERSION,
  } = options;

  const testContainer = image
    .withDirectory("samples", source.directory("samples"))
    .withExec(["mkdir", "-p", "out"]);

  const archList = architectures.split(",").map((arch) => arch.trim());

  for (const architecture of archList) {
    await testArchitecture(testContainer, architecture, kernelVersion);
  }

  return "Cross-compiler tests passed for all architectures";
}

/**
 * Test a single architecture by compiling samples and verifying output.
 */
async function testArchitecture(
  testContainer: Container,
  architecture: string,
  kernelVersion: string,
): Promise<void> {
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

  const image = buildImage({ source: crossCompilerSource });
  await testImage({ source: crossCompilerSource, image });

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

  const image = buildImage({ source: crossCompilerSource });

  // Push with both latest and version tags in parallel
  const refs = await publishToGhcrMultiple({
    container: image,
    imageRefs: [`${GHCR_REGISTRY}:latest`, `${GHCR_REGISTRY}:${sdkVersion}`],
    username: ghcrUsername,
    password: ghcrPassword,
  });

  return `macOS cross-compiler image published to ${refs.join(" and ")}`;
}
